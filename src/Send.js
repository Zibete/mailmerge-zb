/**
 * Armado de mensajes y motor de envío. `executeConfirmed_` (V2) ejecuta una
 * confirmación por token preparada con `prepareConfirmation_` (envío real o
 * prueba, D-40), escribe las columnas gestionadas (D-37), publica el progreso
 * por fila (D-29) y devuelve una `SendResultView` (`buildSendResultView_`).
 *
 * La prueba y el envío real usan el mismo `buildMessage_` (AC-15).
 */

/**
 * Arma el mensaje completo de una fila: plantilla renderizada, imágenes
 * inline, adjuntos comunes del borrador y adjuntos de Drive de la fila
 * (descargados o exportados a PDF). Es el **único** camino de armado, usado
 * por la prueba y por el envío real (AC-15).
 *
 * `template` es `templateData` de `buildPreflight_`; `row` es
 * `{ rowNumber, values }`; `headersMap` es el resultado de `mapHeaders_`.
 * Devuelve `{ ok, message, errors }`. Cualquier fallo de Drive, de tamaño o
 * de plantilla es error de la fila: nunca se omite un adjunto en silencio.
 * `message.attachments` es `[{ name, mimeType, size, blob }]` (comunes
 * primero, luego los de la fila en el orden de la celda); el adaptador de
 * Gmail pasa los blobs a `sendEmail`.
 */
function buildMessage_(deps, template, row, headersMap, config) {
  const errors = [];
  const values = row.values || [];

  const rowCheck = renderRow_(template, values, headersMap);
  rowCheck.errors.forEach(function (error) {
    errors.push(error);
  });

  const inline = mapInlineImages_(template.htmlBody, template.inlineImages);
  inline.errors.forEach(function (error) {
    errors.push(error);
  });

  const attachments = (template.attachments || []).map(function (attachment) {
    return { name: attachment.name, mimeType: attachment.mimeType, size: attachment.size, blob: attachment.blob };
  });

  if (headersMap.columns.attachments !== MISSING_COLUMN) {
    const parsed = parseDriveLinks_(values[headersMap.columns.attachments]);
    parsed.errors.forEach(function (error) {
      errors.push(error);
    });
    parsed.ids.forEach(function (id, index) {
      const position = index + 1;
      let info;
      try {
        info = deps.drive.getFileInfo(id);
      } catch (e) {
        errors.push('No se pudo acceder al archivo adjunto n.º ' + position + ' (no existe o no tenés acceso)');
        return;
      }
      const classified = classifyDriveFile_(info);
      if (!classified.ok) {
        errors.push('Adjunto n.º ' + position + ': ' + classified.error);
        return;
      }
      let file;
      try {
        file = deps.drive.getAttachment(info);
      } catch (e) {
        errors.push('No se pudo obtener el archivo adjunto n.º ' + position + ' desde Drive');
        return;
      }
      if (!file || !file.blob) {
        errors.push('No se pudo obtener el archivo adjunto n.º ' + position + ' desde Drive');
        return;
      }
      attachments.push({ name: file.name, mimeType: file.mimeType, size: file.size, blob: file.blob });
    });
  }

  const sizeCheck = checkAttachmentSizes_(attachments, LIMITS.MAX_TOTAL_ATTACHMENT_BYTES);
  if (!sizeCheck.ok) {
    errors.push(sizeCheck.error);
  }

  if (errors.length > 0) {
    return { ok: false, message: null, errors: errors };
  }

  return {
    ok: true,
    message: {
      to: rowCheck.email,
      subject: rowCheck.rendered.subject,
      plainBody: rowCheck.rendered.plainBody,
      htmlBody: rowCheck.rendered.htmlBody,
      attachments: attachments,
      inlineImages: inline.inlineImages,
      from: config.from,
      replyTo: config.replyTo || '',
    },
    errors: [],
  };
}

// Fila sin ningún valor (la usa `selectTestRow_` de `Confirmation.js`).
function isBlankRow_(values) {
  return (values || []).every(function (value) {
    return value === null || value === undefined || String(value).trim() === '';
  });
}

// Textos del envío real. Ninguno incluye cuerpo, asunto renderizado ni URLs.
const SEND_TEXT_ = {
  LOCKED: 'Hay otra ejecución en curso; reintentá en unos minutos',
  CHANGED: 'Cambió después de la confirmación',
  FILTER_ACK: 'Antes de enviar, confirmá que revisaste los destinatarios y que las vistas de filtro no excluyen filas',
  ATTACHMENT_CHANGED: 'Los adjuntos de Drive cambiaron después de la confirmación; la fila no se envió',
  TEMPLATE_CHANGED:
    'La plantilla, los encabezados, el remitente o el Reply-To cambiaron después de la confirmación; ' +
    'no se envió nada. Volvé a validar y confirmar',
  GLOBAL_ERRORS: 'La validación al momento del envío encontró errores que afectan a toda la campaña; no se envió nada',
  TIME:
    'Se alcanzó el tiempo máximo de ejecución; las filas restantes siguen pendientes y se pueden enviar en otra ejecución',
  QUOTA: 'Se agotó la cuota diaria de envíos de Gmail; las filas restantes siguen pendientes',
  QUOTA_UNKNOWN: 'No se pudo consultar la cuota diaria de envíos de Gmail; no se enviaron más correos',
  ACCEPTED: 'Aceptado por Gmail',
  // Textos de la Fase B V2 (`executeConfirmed_`).
  UNKNOWN_KIND: 'Tipo de confirmación desconocido; no se envió nada',
  CONSENT: 'Falta el consentimiento para reemplazar Fecha, Campaña o Detalle; volvé a revisar y confirmar',
  CONFIG_CHANGED:
    'La configuración de la campaña cambió después de la confirmación; no se envió nada. Volvé a validar y confirmar',
  CLAIM: 'Envío iniciado; si Resultado sigue en ENVIANDO, revisá la carpeta Enviados',
  META_CHANGED: 'Fecha, Campaña o Detalle cambiaron después de la confirmación; la fila no se modificó',
  TEST_ACCOUNT: 'La cuenta que ejecuta no es la de la prueba; no se envió nada',
};

// `Detalle` de éxito de la prueba (D-40), con la cuenta saneada.
function testSentDetail_(account) {
  return (
    'PRUEBA enviada a tu cuenta (' + sanitizeHeaderValue_(account) + '); el destinatario real no recibió este ' +
    'correo. Para enviárselo, borrá ' + HEADERS.RESULT
  );
}

// Resultados por fila que no son estados de la hoja (solo en la sidebar).
const SEND_LOG_RESULT_ = { SKIPPED: 'OMITIDA', NOT_SENT: 'NO ENVIADA' };

// Relee una fila; una falla de lectura se trata como fila distinta (falla
// cerrado: nunca se envía ni se escribe sobre una fila que no se pudo releer).
function readRowSafe_(deps, sheetId, rowNumber, width) {
  try {
    return deps.sheets.readRow(sheetId, rowNumber, width);
  } catch (e) {
    return null;
  }
}

// La lectura de valores no informa si la fila fue ocultada durante la ejecución.
// Fallamos cerrado cuando no se puede comprobar la visibilidad.
function isRowVisibleSafe_(deps, sheetId, rowNumber) {
  try {
    return deps.sheets.isRowVisible(sheetId, rowNumber) === true;
  } catch (e) {
    return false;
  }
}

// Largo máximo del resumen de una excepción dentro de `Detalle`.
const ERROR_SUMMARY_CHARS_ = 200;

// Resumen de cualquier valor lanzado para `Detalle` y la sidebar (D-38,
// D-46): una sola línea, sin URLs y acotado sin cortar palabras (nunca deja
// media dirección). Nunca lanza, aunque el valor no sea un `Error`.
function summarizeError_(error) {
  let text;
  try {
    const raw = error && error.message !== undefined && error.message !== null ? error.message : error;
    text = typeof raw === 'string' ? raw : String(raw);
  } catch (e) {
    text = 'error sin descripción';
  }
  return truncateWholeWords_(viewText_(text).replace(/https?:\/\/\S+/gi, '[URL]'), ERROR_SUMMARY_CHARS_);
}

// Texto de `Detalle` y de los motivos por fila del motor V2 (D-38): una sola
// línea, sin URLs y con hasta `MAX_DETAIL_CHARS` caracteres, sin cortar
// palabras (D-46).
function sendDetailText_(text) {
  return truncateWholeWords_(viewText_(text).replace(/https?:\/\/\S+/gi, '[URL]'), LIMITS.MAX_DETAIL_CHARS);
}

// La configuración vigente es idéntica a la confirmada (D-43): pestaña,
// borrador, remitente, Reply-To y nombre de campaña.
function sameConfirmedConfig_(config, confirmed) {
  if (!config || !confirmed) {
    return false;
  }
  return (
    config.sheetId === confirmed.sheetId &&
    String(config.draftId || '') === confirmed.draftId &&
    String(config.from || '') === confirmed.from &&
    String(config.replyTo || '') === confirmed.replyTo &&
    String(config.campaignName || '') === confirmed.campaignName
  );
}

/**
 * Fase B V2: ejecuta una confirmación preparada con `prepareConfirmation_`
 * (D-26 a D-28) y devuelve su `SendResultView` (`buildSendResultView_`).
 *
 * 1. `startedAt` se toma al empezar (D-30); un token con formato inválido se
 *    rechaza sin lock ni caché.
 * 2. Lock del documento; si no está disponible, la confirmación queda sin
 *    consumir (D-45).
 * 3. Con el lock tomado: `takeConfirmation_` la verifica y la consume antes de
 *    cualquier escritura. Si tiene filas con `Fecha`, `Campaña` o `Detalle` a
 *    reemplazar, exige `overwriteConsent === true` (D-47).
 * 4. La configuración vigente tiene que ser la confirmada (D-43) y la
 *    validación al momento del envío no puede tener errores globales ni otra
 *    plantilla (D-15); en la prueba, la cuenta que ejecuta tiene que ser
 *    `snapshot.testTo` (D-40): si no, cancelación total. Después publica el
 *    progreso inicial (`EN_CURSO`, D-29).
 * 5. Por fila confirmada, en orden ascendente: corte por tiempo y por cuota;
 *    la fila tiene que seguir válida con el mismo digest, también en la
 *    relectura; la huella de metadatos de la relectura tiene que coincidir
 *    (D-48); mensaje completo; claim (`Fecha`, `Campaña`, `Detalle`,
 *    `Resultado = ENVIANDO`); Gmail; verificación de que la fila sigue en su
 *    lugar; éxito (`Detalle`, `Resultado = Email Sent`). Las escrituras siguen
 *    D-37: una fila omitida, un claim fallido o una fila desplazada no escriben
 *    nada, y cualquier resultado ambiguo detiene la ejecución (D-16). En la
 *    prueba, el mensaje va a `snapshot.testTo` con `TEST_SUBJECT_PREFIX` y el
 *    `Detalle` de éxito es el de D-40. Publica el progreso después de cada
 *    fila procesada.
 * 6. Al terminar (también por corte de tiempo o cuota o por una detención),
 *    publica el registro final `TERMINADO`. Un rechazo previo (token, lock,
 *    toma, consentimiento, configuración, plantilla o cuenta de la prueba) no
 *    publica nada. La publicación nunca afecta el envío y la `SendResultView`
 *    trae todas las filas aunque la copia publicada se recorte.
 *
 * `ok` es `true` si la ejecución pasó las verificaciones globales (aunque
 * después se haya detenido); `false` si no se envió nada por un rechazo previo.
 * Un `kind` distinto de `'send'` y `'test'` devuelve `ok: false` sin lock ni
 * caché.
 */
function executeConfirmed_(deps, token, kind, overwriteConsent, filterAcknowledged) {
  const startedAt = deps.clock.now();
  const result = {
    ok: false,
    state: 'EN_CURSO',
    kind: typeof kind === 'string' ? kind : '',
    campaign: '',
    counts: { total: 0, processed: 0, sent: 0, skipped: 0, review: 0, pending: 0 },
    rows: [],
    stoppedReason: '',
  };

  // Un rechazo previo (`ok: false`) no publica progreso; una ejecución que
  // pasó las verificaciones globales publica el registro final aunque se
  // haya detenido (D-29).
  function finish(reason) {
    if (reason) {
      result.stoppedReason = reason;
    }
    result.state = 'TERMINADO';
    if (result.ok) {
      publishProgress_(deps, token, result);
    }
    return buildSendResultView_(result);
  }

  if (kind !== 'send' && kind !== 'test') {
    return finish(SEND_TEXT_.UNKNOWN_KIND);
  }
  if (!isValidToken_(token)) {
    return finish(CONFIRMATION_TEXT_.INVALID);
  }

  let locked = false;
  try {
    locked = Boolean(deps.lock.tryLock(LIMITS.LOCK_WAIT_MS));
  } catch (e) {
    locked = false;
  }
  if (!locked) {
    return finish(SEND_TEXT_.LOCKED);
  }

  try {
    runConfirmedRows_(deps, token, kind, overwriteConsent, filterAcknowledged, startedAt, result);
  } finally {
    deps.lock.release();
  }
  return finish('');
}

// Cuerpo de `executeConfirmed_`, con el lock tomado. Completa `result` en el
// lugar.
function runConfirmedRows_(deps, token, kind, overwriteConsent, filterAcknowledged, startedAt, result) {
  const taken = takeConfirmation_(deps, token, kind);
  if (!taken.ok) {
    result.stoppedReason = taken.error;
    return;
  }
  const snapshot = taken.snapshot;
  result.campaign = snapshot.campaign;
  if (kind === 'send' && filterAcknowledged !== true) {
    result.stoppedReason = SEND_TEXT_.FILTER_ACK;
    return;
  }
  if (snapshot.overwriteRows.length > 0 && overwriteConsent !== true) {
    result.stoppedReason = SEND_TEXT_.CONSENT;
    return;
  }

  const config = deps.props.getConfig();
  if (!sameConfirmedConfig_(config, snapshot.config)) {
    result.stoppedReason = SEND_TEXT_.CONFIG_CHANGED;
    return;
  }
  const report = buildPreflight_(deps, config);
  if (report.globalErrors.length > 0) {
    result.stoppedReason =
      SEND_TEXT_.GLOBAL_ERRORS + ': ' + report.globalErrors.map(sanitizeHeaderValue_).join('; ');
    return;
  }
  if (deps.crypto.sha256Hex(report.templateKey) !== snapshot.templateDigest) {
    result.stoppedReason = SEND_TEXT_.TEMPLATE_CHANGED;
    return;
  }
  // Prueba (D-40, D-06): solo a la cuenta que ejecuta.
  const isTest = kind === 'test';
  if (isTest && String(deps.session.userEmail() || '') !== snapshot.testTo) {
    result.stoppedReason = SEND_TEXT_.TEST_ACCOUNT;
    return;
  }

  result.ok = true;
  const counts = result.counts;
  counts.total = snapshot.rows.length;
  counts.pending = counts.total;
  publishProgress_(deps, token, result);

  const sheetId = report.sheet.id;
  const columns = report.headers.columns;
  const current = {};
  report.valid.forEach(function (row) {
    current[row.rowNumber] = row;
  });
  let quota = report.quotaRemaining;

  // Destinatario de la fila para la `SendResultView`: en la prueba, la cuenta
  // propia; en el envío real, la dirección confirmada o `''` si la fila
  // cambió y no se conoce.
  function recipientOf(row) {
    if (isTest) {
      return snapshot.testTo;
    }
    return row ? row.email : '';
  }

  // Registra el resultado de una fila y publica el progreso (D-29): una vez
  // por fila procesada, incluidas las omitidas y la que detiene la ejecución.
  function record(rowNumber, recipient, rowResult, detail) {
    result.rows.push({
      rowNumber: rowNumber,
      recipient: String(recipient || ''),
      result: rowResult,
      detail: sendDetailText_(detail),
    });
    counts.processed++;
    if (rowResult === SEND_LOG_RESULT_.SKIPPED) {
      counts.skipped++;
    } else if (rowResult !== STATUS.SENT) {
      counts.review++;
    }
    counts.pending = counts.total - counts.processed;
    publishProgress_(deps, token, result);
  }

  function write(rowNumber, cells) {
    deps.sheets.writeCells(sheetId, rowNumber, cells);
  }

  for (let i = 0; i < snapshot.rows.length; i++) {
    const rowNumber = snapshot.rows[i][0];
    const digest = snapshot.rows[i][1];
    const metaDigest = snapshot.rows[i][2];

    // Corte por tiempo (D-30) o cuota (AC-22): el resto queda sin tocar.
    if (deps.clock.now() - startedAt > LIMITS.MAX_RUNTIME_MS) {
      result.stoppedReason = SEND_TEXT_.TIME;
      break;
    }
    if (typeof quota !== 'number' || !isFinite(quota)) {
      result.stoppedReason = SEND_TEXT_.QUOTA_UNKNOWN;
      break;
    }
    if (quota <= 0) {
      result.stoppedReason = SEND_TEXT_.QUOTA;
      break;
    }

    // La fila tiene que seguir válida y con el mismo digest (AC-23 a AC-25).
    const row = current[rowNumber];
    if (!row || deps.crypto.sha256Hex(confirmedRowKey_(row)) !== digest) {
      record(rowNumber, recipientOf(null), SEND_LOG_RESULT_.SKIPPED, SEND_TEXT_.CHANGED);
      continue;
    }

    // Relectura (ediciones durante el recorrido) y huella de metadatos
    // (D-48), antes de armar el mensaje y del claim; sin escrituras.
    const live = readRowSafe_(deps, sheetId, rowNumber, row.values.length);
    if (!live || rowKey_(live, columns) !== row.key || !isRowVisibleSafe_(deps, sheetId, rowNumber)) {
      record(rowNumber, recipientOf(row), SEND_LOG_RESULT_.SKIPPED, SEND_TEXT_.CHANGED);
      continue;
    }
    if (deps.crypto.sha256Hex(metaKey_(live, columns)) !== metaDigest) {
      record(rowNumber, recipientOf(row), SEND_LOG_RESULT_.SKIPPED, SEND_TEXT_.META_CHANGED);
      continue;
    }

    // Armado completo, adjuntos incluidos, antes del claim. En la prueba solo
    // cambian el destinatario (la cuenta propia) y el prefijo del asunto
    // (AC-15, D-40).
    const built = buildMessage_(deps, report.templateData, { rowNumber: rowNumber, values: row.values }, report.headers, config);
    if (!built.ok) {
      record(rowNumber, recipientOf(row), SEND_LOG_RESULT_.SKIPPED, built.errors.map(sanitizeHeaderValue_).join('; '));
      continue;
    }
    if (isTest) {
      built.message.to = snapshot.testTo;
      built.message.subject = TEST_SUBJECT_PREFIX + built.message.subject;
    }
    // Un adjunto puede tardar en descargarse; la fila pudo moverse mientras
    // se obtenían los blobs. Releemos antes de escribir nada, y volvemos a
    // comprobar la versión de Drive que aprobó la confirmación.
    const beforeClaim = readRowSafe_(deps, sheetId, rowNumber, row.values.length);
    if (!beforeClaim || rowKey_(beforeClaim, columns) !== row.key ||
        !isRowVisibleSafe_(deps, sheetId, rowNumber)) {
      record(rowNumber, recipientOf(row), SEND_LOG_RESULT_.SKIPPED, SEND_TEXT_.CHANGED);
      continue;
    }
    if (deps.crypto.sha256Hex(metaKey_(beforeClaim, columns)) !== metaDigest) {
      record(rowNumber, recipientOf(row), SEND_LOG_RESULT_.SKIPPED, SEND_TEXT_.META_CHANGED);
      continue;
    }
    const attachmentsNow = checkRowAttachments_(deps, beforeClaim, report.headers, report.templateData.attachments || []);
    if (attachmentsNow.errors.length > 0 || attachmentsNow.key !== row.attachmentKey) {
      record(rowNumber, recipientOf(row), SEND_LOG_RESULT_.SKIPPED, SEND_TEXT_.ATTACHMENT_CHANGED);
      continue;
    }

    const recipient = built.message.to;
    const successDetail = isTest ? sendDetailText_(testSentDetail_(snapshot.testTo)) : SEND_TEXT_.ACCEPTED;

    // Claim (D-37): `Resultado = ENVIANDO` último.
    try {
      write(rowNumber, [
        { column: columns.date, value: new Date(deps.clock.now()) },
        { column: columns.campaign, value: snapshot.campaign },
        { column: columns.detail, value: SEND_TEXT_.CLAIM },
        { column: columns.result, value: STATUS.SENDING },
      ]);
    } catch (e) {
      record(
        rowNumber,
        recipient,
        SEND_LOG_RESULT_.NOT_SENT,
        'No se pudo marcar ' + STATUS.SENDING + ' y no se envió el correo; revisá ' + HEADERS.RESULT +
          ' de la fila antes de reintentar'
      );
      result.stoppedReason = 'No se pudo escribir ' + HEADERS.RESULT + ' de la fila ' + rowNumber + '; el envío se detuvo';
      break;
    }

    // Sheets no da compare-and-set: si otra persona reordenó la hoja entre
    // la lectura y el claim, detener antes de Gmail. El claim puede quedar
    // en otra fila y requiere conciliación manual, nunca limpieza automática.
    const claimed = readRowSafe_(deps, sheetId, rowNumber, row.values.length);
    const expectedClaim = row.values.slice();
    expectedClaim[columns.result] = STATUS.SENDING;
    if (!claimed || rowKey_(claimed, columns) !== rowKey_(expectedClaim, columns) ||
        !isRowVisibleSafe_(deps, sheetId, rowNumber)) {
      record(rowNumber, recipient, STATUS.REVIEW,
        'La fila cambió durante el marcado ENVIANDO; no se llamó a Gmail. Revisá Resultado y conciliá antes de reintentar');
      result.stoppedReason = 'La identidad o visibilidad de la fila cambió durante el marcado; ejecución detenida';
      break;
    }

    // Gmail. Una excepción es ambigua: REVISAR y fin (D-16, AC-21).
    try {
      deps.gmail.send(built.message);
    } catch (e) {
      const reviewDetail = sendDetailText_(
        'Gmail lanzó una excepción (' + summarizeError_(e) + '); revisá la carpeta Enviados antes de cambiar ' +
          HEADERS.RESULT
      );
      let marked = true;
      try {
        write(rowNumber, [
          { column: columns.detail, value: reviewDetail },
          { column: columns.result, value: STATUS.REVIEW },
        ]);
      } catch (e2) {
        marked = false;
      }
      if (marked) {
        record(rowNumber, recipient, STATUS.REVIEW, reviewDetail);
      } else {
        record(
          rowNumber,
          recipient,
          STATUS.SENDING,
          'Gmail lanzó una excepción (' + summarizeError_(e) + ') y no se pudo escribir ' + STATUS.REVIEW +
            '; revisá la carpeta Enviados antes de cambiar ' + HEADERS.RESULT
        );
      }
      result.stoppedReason = 'Gmail no aceptó un envío; la ejecución se detuvo para no seguir intentando';
      break;
    }
    counts.sent++;
    quota--;

    // La fila sigue en su lugar: misma clave que la confirmada con
    // `Resultado = ENVIANDO` (las columnas informativas no cuentan, D-36).
    const expected = row.values.slice();
    expected[columns.result] = STATUS.SENDING;
    const after = readRowSafe_(deps, sheetId, rowNumber, row.values.length);
    if (!after || rowKey_(after, columns) !== rowKey_(expected, columns)) {
      record(
        rowNumber,
        recipient,
        STATUS.REVIEW,
        'La fila cambió de posición durante el envío; Gmail aceptó el correo, pero no se escribió ' + STATUS.SENT +
          '. Buscá la fila en ' + STATUS.SENDING + ' y reconciliala a mano'
      );
      result.stoppedReason = 'La hoja cambió de estructura durante el envío; la ejecución se detuvo';
      break;
    }

    // Éxito: `Detalle` y luego `Resultado = Email Sent`. Si la escritura
    // falla, la fila queda ENVIANDO (AC-20).
    try {
      write(rowNumber, [
        { column: columns.detail, value: successDetail },
        { column: columns.result, value: STATUS.SENT },
      ]);
    } catch (e) {
      record(
        rowNumber,
        recipient,
        STATUS.SENDING,
        'Gmail aceptó el correo, pero no se pudo escribir ' + STATUS.SENT + '; la fila quedó ' + STATUS.SENDING
      );
      result.stoppedReason = 'No se pudo registrar un envío en la hoja; la ejecución se detuvo';
      break;
    }
    record(rowNumber, recipient, STATUS.SENT, successDetail);
  }
}

function sendCount_(value) {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

/**
 * `SendResultView` para la sidebar: `{ ok, kind, campaign, counts, rows,
 * stoppedReason, summaryLines }`, con todas las filas (`{ rowNumber,
 * recipient, result, detail }`), textos saneados y JSON plano. Las líneas de
 * resumen informan los correos aceptados por Gmail (D-13: aceptados, no
 * entregados), las filas omitidas, para revisión y pendientes, el motivo de
 * cada fila no enviada y el motivo de corte.
 */
function buildSendResultView_(result) {
  const source = result || {};
  const counts = source.counts || {};
  const total = sendCount_(counts.total);
  const processed = sendCount_(counts.processed);
  const view = {
    ok: source.ok === true,
    kind: viewText_(source.kind),
    campaign: viewText_(source.campaign),
    counts: {
      total: total,
      processed: processed,
      sent: sendCount_(counts.sent),
      skipped: sendCount_(counts.skipped),
      review: sendCount_(counts.review),
      pending: typeof counts.pending === 'number' && isFinite(counts.pending) ? counts.pending : total - processed,
    },
    rows: (Array.isArray(source.rows) ? source.rows : []).map(function (row) {
      const item = row || {};
      return {
        rowNumber: sendCount_(item.rowNumber),
        recipient: viewText_(item.recipient),
        result: viewText_(item.result),
        detail: viewText_(item.detail),
      };
    }),
    stoppedReason: viewText_(source.stoppedReason),
    summaryLines: [],
  };

  const lines = view.summaryLines;
  if (!view.ok) {
    if (view.stoppedReason) {
      lines.push('El envío no se inició: ' + view.stoppedReason);
    }
    return view;
  }

  const sent = view.counts.sent;
  lines.push('Campaña: ' + view.campaign);
  lines.push(sent === 1 ? '1 correo aceptado por Gmail' : sent + ' correos aceptados por Gmail');
  lines.push('Filas procesadas: ' + view.counts.processed + ' de ' + view.counts.total);
  if (view.counts.skipped > 0) {
    lines.push('Filas omitidas (no se enviaron ni se modificaron): ' + view.counts.skipped);
  }
  if (view.counts.review > 0) {
    lines.push(
      'Filas para revisión manual (revisá la carpeta Enviados de Gmail antes de cambiar ' + HEADERS.RESULT + '): ' +
        view.counts.review
    );
  }
  if (view.counts.pending > 0) {
    lines.push('Filas pendientes: ' + view.counts.pending + ' (siguen elegibles para otra ejecución)');
  }
  view.rows.forEach(function (row) {
    if (row.result !== STATUS.SENT) {
      lines.push('Fila ' + row.rowNumber + ' (' + row.result + '): ' + row.detail);
    }
  });
  if (view.stoppedReason) {
    lines.push('El envío se detuvo: ' + view.stoppedReason);
  }
  return view;
}
