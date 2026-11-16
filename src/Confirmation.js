/**
 * Confirmación por token de un solo uso (D-26 a D-28) y registro de progreso
 * (D-29, D-46).
 *
 * `prepareConfirmation_` valida, arma la vista que ve el operador y guarda en
 * `CacheService.getUserCache()` un snapshot compacto bajo un token aleatorio:
 * digests SHA-256 de la plantilla y de cada fila confirmada, configuración,
 * campaña y vencimiento, nunca valores de las filas (D-27). El cliente solo
 * recibe el token y la vista. `takeConfirmation_` (con el lock tomado) lo
 * verifica y lo consume antes de cualquier escritura o envío.
 *
 * `publishProgress_` publica el progreso del envío en la misma caché, sin
 * destinatarios y con las direcciones redactadas; nunca lanza.
 */

// Formato de un token: UUID (`Utilities.getUuid()`). Cualquier otra cosa se
// rechaza sin tocar la caché.
const CONFIRMATION_TOKEN_PATTERN_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Digest SHA-256 en hexadecimal en minúsculas (`deps.crypto.sha256Hex`).
const CONFIRMATION_DIGEST_PATTERN_ = /^[0-9a-f]{64}$/;

// Toda palabra que contenga `@` (una dirección de correo o un fragmento
// recortado de una, como `beta@` o `@dominio`), que el progreso en caché
// reemplaza por `[dirección]` (D-46).
const PROGRESS_EMAIL_PATTERN_ = /[^\s<>()",;:]*@[^\s<>()",;:]*/g;

const CONFIRMATION_TEXT_ = {
  UNKNOWN_KIND: 'Tipo de confirmación desconocido; no se preparó nada',
  NOTHING_TO_SEND: 'No hay correos para enviar',
  BAD_ROW: 'Indicá un número de fila entero, 2 o mayor',
  TOO_LARGE: 'La confirmación es demasiado grande para guardarla; usá un filtro para enviar por tandas',
  STORE_FAILED: 'No se pudo guardar la confirmación; no se enviará nada',
  INVALID: 'La confirmación venció o no es válida; volvé a revisar',
  WRONG_KIND: 'La confirmación no corresponde a esta operación; volvé a revisar',
  WRONG_USER: 'La confirmación pertenece a otra cuenta; volvé a revisar',
  EXPIRED: 'La confirmación venció; volvé a revisar y confirmar',
  CONSUME_FAILED: 'No se pudo consumir la confirmación; no se enviará nada',
  ADDRESS: '[dirección]',
};

const CONFIRMATION_KINDS_ = ['send', 'test'];

function isValidToken_(token) {
  return typeof token === 'string' && CONFIRMATION_TOKEN_PATTERN_.test(token);
}

function confirmationRejected_(errors) {
  return { ok: false, errors: errors.map(viewText_), token: '', view: null };
}

// Número de fila de la prueba tal como llega del `<input>`: un entero o un
// texto de solo dígitos (tras recortar). Devuelve `null` para cualquier otra
// cosa (texto no numérico, decimal, `null`).
function parseTestRowNumber_(rowNumber) {
  if (typeof rowNumber === 'number') {
    return Number.isInteger(rowNumber) ? rowNumber : null;
  }
  if (typeof rowNumber === 'string') {
    const text = rowNumber.trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  }
  return null;
}

// Fila a probar (D-40, AC-48): tiene que estar en `report.valid`. Si no, el
// motivo exacto, releyendo la pestaña como la prueba V1 para distinguir una
// fila vacía o fuera de rango. Devuelve `{ row }` o `{ error }`.
function selectTestRow_(deps, config, report, rowNumber) {
  const parsed = parseTestRowNumber_(rowNumber);
  if (parsed === null || parsed < 2) {
    return { error: CONFIRMATION_TEXT_.BAD_ROW };
  }
  let sheet;
  try {
    sheet = deps.sheets.readSheet(config.sheetId);
  } catch (e) {
    return { error: 'La pestaña configurada ya no existe; volvé a configurar la campaña' };
  }
  const lastRow = sheet.values.length;
  if (parsed > lastRow) {
    return { error: 'La fila elegida no existe: indicá un número de fila entre 2 y ' + Math.max(lastRow, 2) };
  }
  const byNumber = function (row) {
    return row.rowNumber === parsed;
  };
  const valid = report.valid.filter(byNumber)[0];
  if (valid) {
    return { row: valid };
  }
  const excluded = report.excluded.filter(byNumber)[0];
  if (excluded) {
    return { error: 'La fila ' + parsed + ' no se puede probar (' + excluded.reason + ')' };
  }
  const invalid = report.invalid.filter(byNumber)[0];
  if (invalid) {
    return { error: 'La fila ' + parsed + ' no es válida: ' + invalid.reasons.join('; ') };
  }
  if (isBlankRow_(sheet.values[parsed - 1])) {
    return { error: 'La fila ' + parsed + ' está vacía' };
  }
  return { error: 'La fila ' + parsed + ' cambió durante la validación; volvé a revisar' };
}

function confirmationWarning_(kind, count, to, rowNumber) {
  if (kind === 'test') {
    return (
      'Se enviará 1 correo a tu cuenta (' + to + ') con el asunto precedido por ' + TEST_SUBJECT_PREFIX.trim() +
      '. La fila ' + rowNumber + ' quedará con ' + HEADERS.RESULT + ' = ' + STATUS.SENT +
      ' y no se enviará al destinatario real hasta que borres ese resultado.'
    );
  }
  return 'Se enviarán ' + count + ' correos reales. Esta acción no se puede deshacer.';
}

/**
 * Prepara una confirmación (`kind` `'send'` o `'test'`; en `test`, la fila a
 * probar). Valida la campaña, guarda el snapshot en `MM_CONF_<token>` con TTL
 * de `CONFIRM_TTL_MS` y devuelve `{ ok, errors, token, view }` con la
 * `ConfirmationView` (D-26, D-27, D-39, D-41, D-47, D-48). Nunca escribe la
 * hoja, nunca envía ni toma el lock; al rechazar no toca la caché.
 */
function prepareConfirmation_(deps, kind, rowNumber) {
  if (CONFIRMATION_KINDS_.indexOf(kind) === -1) {
    return confirmationRejected_([CONFIRMATION_TEXT_.UNKNOWN_KIND]);
  }

  const config = deps.props.getConfig();
  const report = buildPreflight_(deps, config);
  if (report.globalErrors.length > 0) {
    return confirmationRejected_(report.globalErrors);
  }

  // Ninguna fila pendiente puede desaparecer silenciosamente de la revisión
  // por tener un error de validación. La prueba individual sigue permitida.
  if (kind === 'send' && report.invalid.length > 0) {
    const numbers = report.invalid.slice(0, 10).map(function (row) {
      return row.rowNumber;
    });
    const more = report.invalid.length - numbers.length;
    const suffix = more > 0 ? ' (y ' + more + ' más)' : '';
    return confirmationRejected_([
      'Hay ' + report.invalid.length + (report.invalid.length === 1 ? ' fila con errores' : ' filas con errores') +
      ' (filas: ' + numbers.join(', ') + suffix + '). Corregí los datos o marcá Resultado = SKIP ' +
      'en esas filas y volvé a validar antes de enviar',
    ]);
  }

  let rows;
  if (kind === 'send') {
    rows = report.valid.slice().sort(byRowNumber_);
    if (rows.length === 0) {
      return confirmationRejected_([CONFIRMATION_TEXT_.NOTHING_TO_SEND]);
    }
    if (rows.length > LIMITS.MAX_CONFIRM_ROWS) {
      return confirmationRejected_([
        'Hay ' + rows.length + ' filas para enviar y el máximo por confirmación es ' + LIMITS.MAX_CONFIRM_ROWS +
          '. Usá un filtro para enviar por tandas',
      ]);
    }
  } else {
    const selected = selectTestRow_(deps, config, report, rowNumber);
    if (selected.error) {
      return confirmationRejected_([selected.error]);
    }
    rows = [selected.row];
  }

  const columns = report.headers.columns;
  const userEmail = String(deps.session.userEmail() || '');
  const testTo = kind === 'test' ? userEmail : '';
  const campaign = String(config.campaignName || '') || String(deps.ids.newCampaignId());
  const token = String(deps.ids.newToken());
  const createdAt = deps.clock.now();
  const expiresAt = createdAt + LIMITS.CONFIRM_TTL_MS;
  const overwriteRows = findOverwriteRows_(rows, columns);

  const snapshot = {
    v: 2,
    kind: kind,
    userEmail: userEmail,
    createdAt: createdAt,
    expiresAt: expiresAt,
    config: {
      sheetId: config.sheetId,
      draftId: String(config.draftId || ''),
      from: String(config.from || ''),
      replyTo: String(config.replyTo || ''),
      campaignName: String(config.campaignName || ''),
    },
    campaign: campaign,
    templateDigest: deps.crypto.sha256Hex(report.templateKey),
    rows: rows.map(function (row) {
      return [row.rowNumber, deps.crypto.sha256Hex(confirmedRowKey_(row)), deps.crypto.sha256Hex(metaKey_(row.values, columns))];
    }),
    overwriteRows: overwriteRows.map(function (row) {
      return { rowNumber: row.rowNumber, columns: row.columns.slice() };
    }),
    testTo: testTo,
  };
  const json = JSON.stringify(snapshot);
  if (utf8ByteLength_(json) > LIMITS.MAX_CACHE_VALUE_BYTES) {
    return confirmationRejected_([CONFIRMATION_TEXT_.TOO_LARGE]);
  }

  try {
    deps.cache.put(CACHE_PREFIX.CONFIRMATION + token, json, Math.ceil(LIMITS.CONFIRM_TTL_MS / 1000));
  } catch (e) {
    return confirmationRejected_([CONFIRMATION_TEXT_.STORE_FAILED]);
  }

  const review = buildRowReview_({ templateData: report.templateData, valid: rows }, LIMITS.MAX_CONFIRM_ROWS);
  const view = {
    kind: kind,
    campaign: viewText_(campaign),
    sheetName: viewText_(report.sheet && report.sheet.name),
    subject: viewText_(report.template && report.template.subject),
    from: viewText_(report.from),
    replyTo: viewText_(report.replyTo),
  };
  if (kind === 'test') {
    view.to = viewText_(testTo);
  }
  view.count = rows.length;
  view.commonAttachments = review.commonAttachments;
  view.rows = review.rows;
  view.invalidCount = report.invalid.length;
  view.excludedCount = report.excluded.length;
  view.overwriteRows = overwriteRows;
  view.consentRequired = overwriteRows.length > 0;
  view.consentText = formatOverwriteConsent_(overwriteRows);
  view.warning = viewText_(confirmationWarning_(kind, rows.length, testTo, rows[0].rowNumber));
  view.expiresAtIso = new Date(expiresAt).toISOString();

  return { ok: true, errors: [], token: token, view: view };
}

function isNonEmptyString_(value) {
  return typeof value === 'string' && value !== '';
}

function isFiniteNumber_(value) {
  return typeof value === 'number' && isFinite(value);
}

// Forma del snapshot según el contrato: cualquier campo faltante o con otra
// forma lo invalida (falla cerrado).
function isValidConfirmationSnapshot_(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return false;
  }
  const config = snapshot.config;
  if (
    snapshot.v !== 2 ||
    CONFIRMATION_KINDS_.indexOf(snapshot.kind) === -1 ||
    !isNonEmptyString_(snapshot.userEmail) ||
    !isFiniteNumber_(snapshot.createdAt) ||
    !isFiniteNumber_(snapshot.expiresAt) ||
    !config ||
    typeof config !== 'object' ||
    !isFiniteNumber_(config.sheetId) ||
    typeof config.draftId !== 'string' ||
    typeof config.from !== 'string' ||
    typeof config.replyTo !== 'string' ||
    typeof config.campaignName !== 'string' ||
    !isNonEmptyString_(snapshot.campaign) ||
    typeof snapshot.templateDigest !== 'string' ||
    !CONFIRMATION_DIGEST_PATTERN_.test(snapshot.templateDigest) ||
    typeof snapshot.testTo !== 'string' ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length === 0 ||
    !Array.isArray(snapshot.overwriteRows)
  ) {
    return false;
  }

  const rowNumbers = [];
  for (let i = 0; i < snapshot.rows.length; i++) {
    const row = snapshot.rows[i];
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      !Number.isInteger(row[0]) ||
      row[0] < 2 ||
      typeof row[1] !== 'string' ||
      !CONFIRMATION_DIGEST_PATTERN_.test(row[1]) ||
      typeof row[2] !== 'string' ||
      !CONFIRMATION_DIGEST_PATTERN_.test(row[2]) ||
      (i > 0 && row[0] <= snapshot.rows[i - 1][0])
    ) {
      return false;
    }
    rowNumbers.push(row[0]);
  }

  const managed = [HEADERS.DATE, HEADERS.CAMPAIGN, HEADERS.DETAIL];
  for (let j = 0; j < snapshot.overwriteRows.length; j++) {
    const entry = snapshot.overwriteRows[j];
    if (
      !entry ||
      typeof entry !== 'object' ||
      rowNumbers.indexOf(entry.rowNumber) === -1 ||
      !Array.isArray(entry.columns) ||
      entry.columns.length === 0 ||
      !entry.columns.every(function (name) {
        return managed.indexOf(name) !== -1;
      })
    ) {
      return false;
    }
  }

  if (snapshot.kind === 'test' && (snapshot.rows.length !== 1 || !isNonEmptyString_(snapshot.testTo))) {
    return false;
  }
  return true;
}

/**
 * Toma (verifica y consume) una confirmación. Se llama con el lock tomado.
 * Devuelve `{ ok, snapshot, error }`. Rechaza, en este orden: token con
 * formato inválido (sin tocar la caché), entrada inexistente, contenido
 * inválido, otro `kind`, otra cuenta y vencida. Toda entrada existente se
 * borra, también al rechazar (D-28); si el borrado de una confirmación válida
 * lanza, no se devuelve el snapshot y no se envía nada.
 */
function takeConfirmation_(deps, token, kind) {
  const rejected = function (error) {
    return { ok: false, snapshot: null, error: error };
  };
  if (!isValidToken_(token)) {
    return rejected(CONFIRMATION_TEXT_.INVALID);
  }
  const key = CACHE_PREFIX.CONFIRMATION + token;
  let raw;
  try {
    raw = deps.cache.get(key);
  } catch (e) {
    return rejected(CONFIRMATION_TEXT_.INVALID);
  }
  if (raw === null || raw === undefined) {
    return rejected(CONFIRMATION_TEXT_.INVALID);
  }

  const discard = function (error) {
    try {
      deps.cache.remove(key);
    } catch (e) {
      // La entrada rechazada vence sola con su TTL; igual no se envía nada.
    }
    return rejected(error);
  };

  let snapshot;
  try {
    snapshot = JSON.parse(String(raw));
  } catch (e) {
    return discard(CONFIRMATION_TEXT_.INVALID);
  }
  if (!isValidConfirmationSnapshot_(snapshot)) {
    return discard(CONFIRMATION_TEXT_.INVALID);
  }
  if (snapshot.kind !== kind) {
    return discard(CONFIRMATION_TEXT_.WRONG_KIND);
  }
  if (snapshot.userEmail !== String(deps.session.userEmail() || '')) {
    return discard(CONFIRMATION_TEXT_.WRONG_USER);
  }
  if (deps.clock.now() > snapshot.expiresAt) {
    return discard(CONFIRMATION_TEXT_.EXPIRED);
  }

  try {
    deps.cache.remove(key);
  } catch (e) {
    return rejected(CONFIRMATION_TEXT_.CONSUME_FAILED);
  }
  return { ok: true, snapshot: snapshot, error: '' };
}

/**
 * Descarta una confirmación sin enviar (botón `Cancelar`). Sin lock; un token
 * con formato inválido no toca la caché y uno desconocido o ya consumido no
 * hace nada. Siempre devuelve `{ ok: true }`.
 */
function cancelConfirmation_(deps, token) {
  if (isValidToken_(token)) {
    try {
      deps.cache.remove(CACHE_PREFIX.CONFIRMATION + token);
    } catch (e) {
      // La entrada vence sola con su TTL y solo se puede usar una vez.
    }
  }
  return { ok: true };
}

// Texto del progreso en caché (D-46, D-38): una línea, sin URLs, con toda
// palabra que contenga `@` reemplazada por `[dirección]` (también fragmentos
// que ya llegan recortados, como `beta@` o `@dominio`) y acotado a
// `MAX_DETAIL_CHARS` sin cortar palabras. La redacción va antes del recorte.
function progressText_(value) {
  const redacted = viewText_(value)
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(PROGRESS_EMAIL_PATTERN_, CONFIRMATION_TEXT_.ADDRESS);
  return truncateWholeWords_(redacted, LIMITS.MAX_DETAIL_CHARS);
}

function progressCount_(value) {
  return isFiniteNumber_(value) ? value : 0;
}

/**
 * Publica el progreso del envío en `MM_PROG_<token>` con TTL de
 * `PROGRESS_TTL_MS` (D-29). Nunca lanza: una falla al publicar no afecta el
 * envío. Las filas se publican como `{ rowNumber, result, detail }`, sin
 * `recipient` y con las direcciones redactadas (D-46). Si el JSON supera
 * `MAX_CACHE_VALUE_BYTES`, publica los contadores completos y solo las
 * últimas filas que entran, con `rowsTruncated: true`. Devuelve `true` si
 * publicó.
 */
function publishProgress_(deps, token, progress) {
  try {
    if (!isValidToken_(token) || !progress || typeof progress !== 'object') {
      return false;
    }
    const counts = progress.counts || {};
    const total = progressCount_(counts.total);
    const processed = progressCount_(counts.processed);
    const record = {
      state: viewText_(progress.state),
      kind: viewText_(progress.kind),
      campaign: viewText_(progress.campaign),
      counts: {
        total: total,
        processed: processed,
        sent: progressCount_(counts.sent),
        skipped: progressCount_(counts.skipped),
        review: progressCount_(counts.review),
        pending: isFiniteNumber_(counts.pending) ? counts.pending : total - processed,
      },
      rows: (Array.isArray(progress.rows) ? progress.rows : []).map(function (row) {
        return {
          rowNumber: row && isFiniteNumber_(row.rowNumber) ? row.rowNumber : 0,
          result: viewText_(row && row.result),
          detail: progressText_(row && row.detail),
        };
      }),
      rowsTruncated: false,
      stoppedReason: progressText_(progress.stoppedReason),
    };

    let json = JSON.stringify(record);
    if (utf8ByteLength_(json) > LIMITS.MAX_CACHE_VALUE_BYTES) {
      const all = record.rows;
      record.rows = [];
      record.rowsTruncated = true;
      let size = utf8ByteLength_(JSON.stringify(record));
      const kept = [];
      for (let i = all.length - 1; i >= 0; i--) {
        const rowSize = utf8ByteLength_(JSON.stringify(all[i])) + (kept.length > 0 ? 1 : 0);
        if (size + rowSize > LIMITS.MAX_CACHE_VALUE_BYTES) {
          break;
        }
        size += rowSize;
        kept.unshift(all[i]);
      }
      record.rows = kept;
      json = JSON.stringify(record);
    }

    deps.cache.put(CACHE_PREFIX.PROGRESS + token, json, Math.ceil(LIMITS.PROGRESS_TTL_MS / 1000));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Lee el progreso publicado para un token. Devuelve `{ found, progress }`;
 * un token con formato inválido devuelve `found: false` sin tocar la caché.
 */
function readProgress_(deps, token) {
  const missing = { found: false, progress: null };
  if (!isValidToken_(token)) {
    return missing;
  }
  try {
    const raw = deps.cache.get(CACHE_PREFIX.PROGRESS + token);
    if (raw === null || raw === undefined) {
      return missing;
    }
    return { found: true, progress: JSON.parse(String(raw)) };
  } catch (e) {
    return missing;
  }
}
