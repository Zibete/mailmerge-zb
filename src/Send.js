/**
 * Armado de mensajes, envío de prueba y registro. El envío real en dos fases
 * (`prepareSend_`, `executeSend_`) usa el mismo `buildMessage_` (AC-15).
 */

// Resultado que se registra para un envío de prueba.
const TEST_LOG_RESULT_ = 'PRUEBA';

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

function isBlankRow_(values) {
  return (values || []).every(function (value) {
    return value === null || value === undefined || String(value).trim() === '';
  });
}

/**
 * Envío de prueba de una fila a la cuenta que ejecuta (D-06, R-08).
 *
 * Exige una campaña sin errores globales (incluida una cuenta identificable,
 * D-22) y una fila válida, pero ignora su estado y visibilidad (D-07). Una
 * fila menor que 2, mayor que la última fila con datos o totalmente vacía es
 * error. El mensaje es el de `buildMessage_` con solo `to` reemplazado por la
 * cuenta propia y el asunto con `TEST_SUBJECT_PREFIX`. Nunca escribe estado.
 *
 * Devuelve `{ ok, errors, to, logErrors }`; `logErrors` cuenta las fallas al
 * escribir el registro (D-18), que no cambian el resultado.
 */
function runTestSend_(deps, config, rowNumber) {
  const report = buildPreflight_(deps, config);
  if (report.globalErrors.length > 0) {
    return { ok: false, errors: report.globalErrors.slice(), to: '', logErrors: 0 };
  }

  const to = String(deps.session.userEmail() || '');
  if (to.trim() === '') {
    return { ok: false, errors: ['No se pudo identificar la cuenta que ejecuta'], to: '', logErrors: 0 };
  }

  let sheet;
  try {
    sheet = deps.sheets.readSheet(config.sheetId);
  } catch (e) {
    return {
      ok: false,
      errors: ['La pestaña configurada ya no existe; volvé a configurar la campaña'],
      to: '',
      logErrors: 0,
    };
  }
  const lastRow = sheet.values.length;
  if (typeof rowNumber !== 'number' || Math.floor(rowNumber) !== rowNumber || rowNumber < 2 || rowNumber > lastRow) {
    return {
      ok: false,
      errors: ['La fila elegida no existe: indicá un número de fila entre 2 y ' + Math.max(lastRow, 2)],
      to: '',
      logErrors: 0,
    };
  }
  const values = sheet.values[rowNumber - 1];
  if (isBlankRow_(values)) {
    return { ok: false, errors: ['La fila ' + rowNumber + ' está vacía'], to: '', logErrors: 0 };
  }

  const built = buildMessage_(deps, report.templateData, { rowNumber: rowNumber, values: values }, report.headers, config);
  if (!built.ok) {
    return { ok: false, errors: built.errors, to: '', logErrors: 0 };
  }

  const message = {};
  Object.keys(built.message).forEach(function (key) {
    message[key] = built.message[key];
  });
  message.to = to;
  message.subject = TEST_SUBJECT_PREFIX + built.message.subject;

  const entry = {
    date: new Date(deps.clock.now()),
    campaignId: deps.ids.newCampaignId(),
    sheetName: report.sheet.name,
    rowNumber: rowNumber,
    recipient: to,
    result: TEST_LOG_RESULT_,
    detail: '',
  };

  try {
    deps.gmail.send(message);
  } catch (e) {
    entry.detail = 'Falló el envío de prueba';
    const logged = appendLogSafe_(deps, entry);
    return {
      ok: false,
      errors: ['Gmail no aceptó el envío de prueba; revisá la carpeta Enviados antes de reintentar'],
      to: to,
      logErrors: logged ? 0 : 1,
    };
  }

  entry.detail = 'Envío de prueba a la cuenta propia; el estado de la fila no cambia';
  const logged = appendLogSafe_(deps, entry);
  return { ok: true, errors: [], to: to, logErrors: logged ? 0 : 1 };
}

/**
 * Escribe una entrada en el registro sin propagar errores (D-18): una falla
 * del registro no cambia el estado de la fila ni detiene el envío. Solo se
 * registran los campos permitidos (AC-26). Devuelve `true` si se escribió y
 * `false` si falló, para que el llamador cuente las fallas.
 */
function appendLogSafe_(deps, entry) {
  const source = entry || {};
  const clean = {
    date: source.date,
    campaignId: source.campaignId,
    sheetName: source.sheetName,
    rowNumber: source.rowNumber,
    recipient: source.recipient,
    result: source.result,
    detail: source.detail,
  };
  try {
    deps.sheets.appendLog(clean);
    return true;
  } catch (e) {
    return false;
  }
}

// Textos del envío real. Ninguno incluye cuerpo, asunto renderizado ni URLs.
const SEND_TEXT_ = {
  LOCKED: 'Hay otra ejecución en curso; reintentá en unos minutos',
  CHANGED: 'Cambió después de la confirmación',
  TEMPLATE_CHANGED:
    'La plantilla, los encabezados, el remitente o el Reply-To cambiaron después de la confirmación; ' +
    'no se envió nada. Volvé a validar y confirmar',
  GLOBAL_ERRORS: 'La validación al momento del envío encontró errores que afectan a toda la campaña; no se envió nada',
  TIME:
    'Se alcanzó el tiempo máximo de ejecución; las filas restantes siguen pendientes y se pueden enviar en otra ejecución',
  QUOTA: 'Se agotó la cuota diaria de envíos de Gmail; las filas restantes siguen pendientes',
  QUOTA_UNKNOWN: 'No se pudo consultar la cuota diaria de envíos de Gmail; no se enviaron más correos',
  ACCEPTED: 'Aceptado por Gmail',
};

// Resultados del registro que no son estados de la hoja.
const SEND_LOG_RESULT_ = { SKIPPED: 'OMITIDA', NOT_SENT: 'NO ENVIADA' };

/**
 * Fase A del envío real, sin lock: validación previa completa y lo que el
 * operador confirma (la clave de la plantilla y la clave de cada fila
 * válida). Devuelve `{ report, confirmed: { templateKey, rows: Map<rowNumber, key> } }`.
 * Con errores globales `report.valid` está vacío y no se confirma ninguna fila.
 */
function prepareSend_(deps, config) {
  const report = buildPreflight_(deps, config);
  const rows = new Map();
  report.valid.forEach(function (row) {
    rows.set(row.rowNumber, row.key);
  });
  return { report: report, confirmed: { templateKey: report.templateKey, rows: rows } };
}

// Relee una fila; una falla de lectura se trata como fila distinta (falla
// cerrado: nunca se envía ni se escribe sobre una fila que no se pudo releer).
function readRowSafe_(deps, sheetId, rowNumber, width) {
  try {
    return deps.sheets.readRow(sheetId, rowNumber, width);
  } catch (e) {
    return null;
  }
}

// Resumen de una excepción para el registro y el resumen: una sola línea,
// sin URLs y acotada.
function summarizeError_(error) {
  const text = error && error.message ? error.message : String(error);
  return sanitizeHeaderValue_(text)
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .slice(0, 200);
}

/**
 * Fase B del envío real (R-09 a R-12, AC-18 a AC-26). Toma el lock, relee
 * todo desde cero y solo envía las filas idénticas a las confirmadas, con un
 * checkpoint por fila: `ENVIANDO` → Gmail → verificación de la fila →
 * `Email Sent`. Cualquier resultado ambiguo deja la fila fuera de los envíos
 * automáticos (`ENVIANDO` o `REVISAR`) y detiene la ejecución.
 *
 * Devuelve `{ campaignId, sent, skipped: [{ rowNumber, reason }],
 * review: [{ rowNumber, reason }], stoppedReason, logErrors }`. `sent` cuenta
 * los correos que Gmail aceptó (D-13), incluidos los que quedaron para
 * revisión porque no se pudo registrar el éxito.
 */
function executeSend_(deps, config, prepared, startedAt) {
  const result = { campaignId: '', sent: 0, skipped: [], review: [], stoppedReason: '', logErrors: 0 };

  let locked = false;
  try {
    locked = Boolean(deps.lock.tryLock(LIMITS.LOCK_WAIT_MS));
  } catch (e) {
    locked = false;
  }
  if (!locked) {
    result.stoppedReason = SEND_TEXT_.LOCKED;
    return result;
  }

  try {
    sendConfirmedRows_(deps, config, prepared, startedAt, result);
  } finally {
    deps.lock.release();
  }
  return result;
}

// Cuerpo de la Fase B, dentro del lock. Completa `result` en el lugar.
function sendConfirmedRows_(deps, config, prepared, startedAt, result) {
  const report = buildPreflight_(deps, config);
  if (report.globalErrors.length > 0) {
    result.stoppedReason =
      SEND_TEXT_.GLOBAL_ERRORS + ': ' + report.globalErrors.map(sanitizeHeaderValue_).join('; ');
    return;
  }
  if (report.templateKey !== prepared.confirmed.templateKey) {
    result.stoppedReason = SEND_TEXT_.TEMPLATE_CHANGED;
    return;
  }
  result.campaignId = deps.ids.newCampaignId();

  const sheetId = report.sheet.id;
  const statusColumn = report.headers.columns.status;
  const current = {};
  report.valid.forEach(function (row) {
    current[row.rowNumber] = row;
  });
  const confirmedEmails = {};
  ((prepared.report && prepared.report.valid) || []).forEach(function (row) {
    confirmedEmails[row.rowNumber] = row.email;
  });
  let quota = report.quotaRemaining;

  function log(rowNumber, recipient, logResult, detail) {
    const logged = appendLogSafe_(deps, {
      date: new Date(deps.clock.now()),
      campaignId: result.campaignId,
      sheetName: report.sheet.name,
      rowNumber: rowNumber,
      recipient: recipient,
      result: logResult,
      detail: detail,
    });
    if (!logged) {
      result.logErrors++;
    }
  }

  function skip(rowNumber, recipient, reason) {
    result.skipped.push({ rowNumber: rowNumber, reason: reason });
    log(rowNumber, recipient, SEND_LOG_RESULT_.SKIPPED, reason);
  }

  const rowNumbers = Array.from(prepared.confirmed.rows.keys()).sort(function (a, b) {
    return a - b;
  });

  for (let i = 0; i < rowNumbers.length; i++) {
    const rowNumber = rowNumbers[i];
    const confirmedKey = prepared.confirmed.rows.get(rowNumber);
    const confirmedEmail = confirmedEmails[rowNumber] || '';

    // Paso 3: corte por tiempo o cuota (AC-22); el resto queda sin tocar.
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

    // Paso 3: la fila debe seguir válida y con la misma clave (AC-23 a AC-25).
    const row = current[rowNumber];
    if (!row || row.key !== confirmedKey) {
      skip(rowNumber, confirmedEmail, SEND_TEXT_.CHANGED);
      continue;
    }

    // Paso 4: relectura de la fila (ediciones durante el recorrido).
    const live = readRowSafe_(deps, sheetId, rowNumber, row.values.length);
    if (!live || rowKey_(live) !== confirmedKey) {
      skip(rowNumber, confirmedEmail, SEND_TEXT_.CHANGED);
      continue;
    }

    // Paso 5: armado completo, adjuntos incluidos, antes del claim.
    const built = buildMessage_(deps, report.templateData, { rowNumber: rowNumber, values: row.values }, report.headers, config);
    if (!built.ok) {
      skip(rowNumber, confirmedEmail, built.errors.map(sanitizeHeaderValue_).join('; '));
      continue;
    }
    const recipient = built.message.to;

    // Paso 6: claim ENVIANDO.
    try {
      deps.sheets.writeStatus(sheetId, rowNumber, statusColumn, STATUS.SENDING);
    } catch (e) {
      const reason =
        'No se pudo marcar ' + STATUS.SENDING + ' y no se envió el correo; revisá el estado de la fila antes de reintentar';
      result.review.push({ rowNumber: rowNumber, reason: reason });
      log(rowNumber, recipient, SEND_LOG_RESULT_.NOT_SENT, reason);
      result.stoppedReason = 'No se pudo escribir el estado de la fila ' + rowNumber + '; el envío se detuvo';
      break;
    }

    // Paso 7: Gmail. Una excepción es ambigua: REVISAR y fin (D-16, AC-21).
    try {
      deps.gmail.send(built.message);
    } catch (e) {
      let marked = true;
      try {
        deps.sheets.writeStatus(sheetId, rowNumber, statusColumn, STATUS.REVIEW);
      } catch (e2) {
        marked = false;
      }
      const reason =
        'Gmail lanzó una excepción (' + summarizeError_(e) + '); la fila quedó ' +
        (marked ? STATUS.REVIEW : STATUS.SENDING) +
        '. Revisá la carpeta Enviados antes de cambiar su estado';
      result.review.push({ rowNumber: rowNumber, reason: reason });
      log(rowNumber, recipient, STATUS.REVIEW, reason);
      result.stoppedReason = 'Gmail no aceptó un envío; la ejecución se detuvo para no seguir intentando';
      break;
    }
    result.sent++;
    quota--;

    // Paso 8: la fila sigue en su lugar (misma clave con ENVIANDO).
    const expected = row.values.slice();
    expected[statusColumn] = STATUS.SENDING;
    const after = readRowSafe_(deps, sheetId, rowNumber, row.values.length);
    if (!after || rowKey_(after) !== rowKey_(expected)) {
      result.review.push({
        rowNumber: rowNumber,
        reason:
          'REVISAR: la fila cambió de posición durante el envío; Gmail aceptó el correo, pero no se escribió ' +
          STATUS.SENT + '. Buscá la fila en ' + STATUS.SENDING + ' y reconciliala a mano',
      });
      log(rowNumber, recipient, STATUS.REVIEW, 'La fila cambió de posición durante el envío; Gmail aceptó el correo');
      result.stoppedReason = 'La hoja cambió de estructura durante el envío; la ejecución se detuvo';
      break;
    }

    // Paso 8: éxito. Si la escritura falla, la fila queda ENVIANDO (AC-20).
    try {
      deps.sheets.writeStatus(sheetId, rowNumber, statusColumn, STATUS.SENT);
    } catch (e) {
      const reason =
        'Gmail aceptó el correo, pero no se pudo escribir ' + STATUS.SENT + '; la fila quedó ' + STATUS.SENDING;
      result.review.push({ rowNumber: rowNumber, reason: reason });
      log(rowNumber, recipient, STATUS.SENDING, reason);
      result.stoppedReason = 'No se pudo registrar un envío en la hoja; la ejecución se detuvo';
      break;
    }

    // Paso 9: registro del resultado.
    log(rowNumber, recipient, STATUS.SENT, SEND_TEXT_.ACCEPTED);
  }
}

/**
 * Resumen del envío real en español, para `Ui.alert`. Informa los correos
 * aceptados por Gmail (D-13: aceptados, no entregados), las filas omitidas y
 * las que requieren revisión manual con su motivo, el motivo de corte y las
 * fallas del registro (D-18).
 */
function formatSendSummary_(result) {
  const sent = result.sent || 0;
  const skipped = result.skipped || [];
  const review = result.review || [];
  const lines = [
    'Campaña: ' + (result.campaignId ? sanitizeHeaderValue_(result.campaignId) : '(no se inició)'),
    sent === 1 ? '1 correo aceptado por Gmail' : sent + ' correos aceptados por Gmail',
  ];

  function listRows(title, rows) {
    lines.push('', title + ': ' + rows.length);
    rows.slice(0, REPORT_ROW_LIMIT_).forEach(function (row) {
      lines.push('Fila ' + row.rowNumber + ': ' + sanitizeHeaderValue_(row.reason));
    });
    moreRowsLine_(rows.length, REPORT_ROW_LIMIT_).forEach(function (line) {
      lines.push(line);
    });
  }

  if (skipped.length > 0) {
    listRows('Filas omitidas (no se enviaron)', skipped);
  }
  if (review.length > 0) {
    listRows('Filas para revisión manual (revisá la carpeta Enviados de Gmail antes de cambiar su estado)', review);
  }
  if (result.stoppedReason) {
    lines.push('', 'El envío se detuvo: ' + sanitizeHeaderValue_(result.stoppedReason));
  }
  if (result.logErrors > 0) {
    lines.push(
      '',
      'Atención: no se pudieron escribir ' + result.logErrors +
        ' entradas del registro; el estado de la hoja sigue siendo la referencia'
    );
  }
  return lines.join('\n');
}
