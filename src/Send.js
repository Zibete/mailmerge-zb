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
