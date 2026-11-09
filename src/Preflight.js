/**
 * Validación previa de la campaña (R-07, AC-27): lee la configuración, la
 * pestaña, el borrador, la cuenta y los adjuntos, y arma un informe. Es de
 * solo lectura: nunca llama a `gmail.send`, `sheets.writeStatus` ni
 * `sheets.appendLog`.
 */

// Cantidad de filas que se listan en los informes antes de `y N filas más`.
const REPORT_ROW_LIMIT_ = 20;

// Valores de la fila por encabezado (`{ [encabezado]: valor mostrado }`).
function rowValuesByHeader_(values, headers) {
  const result = {};
  Object.keys(headers.byName).forEach(function (header) {
    const value = values[headers.byName[header]];
    result[header] = value === null || value === undefined ? '' : String(value);
  });
  return result;
}

/**
 * Valida el destinatario y renderiza la plantilla para una fila. La usan la
 * validación previa y `buildMessage_`, para que ambas apliquen las mismas
 * reglas.
 *
 * Devuelve `{ ok, email, rendered: { subject, plainBody, htmlBody } | null, errors }`.
 */
function renderRow_(template, values, headers) {
  const errors = [];
  const rawEmail = values[headers.columns.email];
  const email = rawEmail === null || rawEmail === undefined ? '' : String(rawEmail);
  if (email.trim() === '') {
    errors.push('Falta Email Address');
  } else if (!isValidEmail_(email)) {
    errors.push('La dirección de Email Address no es válida (debe ser una sola dirección, sin espacios)');
  }

  const render = renderTemplate_(template, rowValuesByHeader_(values, headers));
  let rendered = null;
  if (!render.ok) {
    render.errors.forEach(function (error) {
      errors.push(error);
    });
  } else if (
    findUnresolvedTokens_(render.subject) ||
    findUnresolvedTokens_(render.plainBody) ||
    findUnresolvedTokens_(render.htmlBody)
  ) {
    errors.push('Quedan marcadores sin resolver ({{ o }}) después de reemplazar los valores');
  } else if (utf8ByteLength_(render.htmlBody) + utf8ByteLength_(render.plainBody) > LIMITS.MAX_BODY_BYTES) {
    errors.push('El cuerpo del correo supera el tamaño máximo permitido');
  } else {
    rendered = { subject: render.subject, plainBody: render.plainBody, htmlBody: render.htmlBody };
  }

  return { ok: errors.length === 0, email: email, rendered: rendered, errors: errors };
}

// Valida la plantilla contra los encabezados: marcadores desconocidos (error
// global, afecta a todas las filas) e imágenes inline sin emparejar.
function validateTemplate_(template, headers) {
  const errors = [];
  const known = headers.byName;
  const names = [];
  [
    extractTokens_(template.subject, { html: false }),
    extractTokens_(template.plainBody, { html: false }),
    extractTokens_(template.htmlBody, { html: true }),
  ].forEach(function (list) {
    list.forEach(function (name) {
      if (names.indexOf(name) === -1) {
        names.push(name);
      }
    });
  });
  names.forEach(function (name) {
    if (!Object.prototype.hasOwnProperty.call(known, name)) {
      errors.push('Marcador desconocido: {{' + name + '}}');
    }
  });
  const inline = mapInlineImages_(template.htmlBody, template.inlineImages);
  inline.errors.forEach(function (error) {
    errors.push(error);
  });
  return { errors: errors, inlineCids: Object.keys(inline.inlineImages).sort() };
}

// Valida el remitente, la cuenta y el Reply-To (D-05, D-22, AC-14).
function validateSender_(deps, config) {
  const errors = [];
  const userEmail = String(deps.session.userEmail() || '');
  if (userEmail.trim() === '') {
    errors.push('No se pudo identificar la cuenta que ejecuta');
  } else {
    let aliases = [];
    try {
      aliases = deps.gmail.getAliases() || [];
    } catch (e) {
      errors.push('No se pudieron leer los alias de Gmail de la cuenta');
    }
    const senders = [userEmail].concat(aliases);
    if (errors.length === 0 && senders.indexOf(config.from) === -1) {
      errors.push(
        'El remitente "' + sanitizeHeaderValue_(config.from) +
          '" no está autorizado para esta cuenta; volvé a configurar la campaña'
      );
    }
  }
  if (config.replyTo && !isValidEmail_(config.replyTo)) {
    errors.push('El Reply-To configurado no es una dirección válida; volvé a configurar la campaña');
  }
  return errors;
}

// Valida los adjuntos de Drive de una fila sin descargarlos (acceso, tipo y
// tamaño de los binarios más los comunes). Devuelve los nombres en el orden
// de la celda, obtenidos en la misma llamada que valida el acceso (D-23).
function checkRowAttachments_(deps, values, headers, commonAttachments) {
  const errors = [];
  const names = [];
  if (headers.columns.attachments === MISSING_COLUMN) {
    return { errors: errors, names: names };
  }
  const parsed = parseDriveLinks_(values[headers.columns.attachments]);
  parsed.errors.forEach(function (error) {
    errors.push(error);
  });
  const sizes = commonAttachments.map(function (attachment) {
    return { size: attachment.size };
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
    names.push(String(info.name));
    // El tamaño de un nativo se conoce recién al exportarlo; se controla en
    // `buildMessage_` antes del claim.
    if (classified.kind === 'binary') {
      sizes.push({ size: info.size });
    }
  });
  const sizeCheck = checkAttachmentSizes_(sizes, LIMITS.MAX_TOTAL_ATTACHMENT_BYTES);
  if (!sizeCheck.ok) {
    errors.push(sizeCheck.error);
  }
  return { errors: errors, names: names };
}

function isCompleteConfig_(config) {
  return Boolean(
    config &&
      typeof config.sheetId === 'number' &&
      isFinite(config.sheetId) &&
      config.draftId &&
      config.from
  );
}

/**
 * Validación previa de solo lectura de la campaña configurada.
 *
 * Devuelve `{ ok, globalErrors, sheet, template, templateData, from, replyTo,
 * headers, templateKey, valid, invalid, excluded, quotaRemaining }`. `ok` es
 * `true` si no hay errores globales; con errores globales (configuración,
 * pestaña, encabezados, plantilla, cuenta, remitente) `valid` queda vacío y
 * no se revisan las filas. `templateData` es la plantilla tal como la
 * devolvió `getTemplate` y es la única que se usa para armar mensajes.
 */
function buildPreflight_(deps, config) {
  const report = {
    ok: false,
    globalErrors: [],
    sheet: { id: config && config.sheetId !== undefined ? config.sheetId : null, name: '' },
    template: { id: config && config.draftId ? config.draftId : '', subject: '' },
    templateData: null,
    from: config && config.from ? config.from : '',
    replyTo: config && config.replyTo ? config.replyTo : '',
    headers: null,
    templateKey: '',
    valid: [],
    invalid: [],
    excluded: [],
    quotaRemaining: null,
  };

  try {
    report.quotaRemaining = deps.quota.remaining();
  } catch (e) {
    report.quotaRemaining = null;
  }

  if (!isCompleteConfig_(config)) {
    report.globalErrors.push('La configuración de la campaña está incompleta; usá "Configurar campaña…"');
    return report;
  }

  let sheet = null;
  try {
    sheet = deps.sheets.readSheet(config.sheetId);
  } catch (e) {
    report.globalErrors.push('La pestaña configurada ya no existe; volvé a configurar la campaña');
  }
  if (sheet) {
    report.sheet = { id: sheet.id, name: sheet.name };
    report.headers = mapHeaders_(sheet.values[0] || []);
    report.headers.errors.forEach(function (error) {
      report.globalErrors.push(error);
    });
  }

  try {
    report.templateData = deps.gmail.getTemplate(config.draftId);
    report.template = { id: report.templateData.id, subject: report.templateData.subject };
  } catch (e) {
    report.globalErrors.push(
      'El borrador configurado ya no existe o no se pudo leer; volvé a configurar la campaña'
    );
  }

  let inlineCids = [];
  if (report.templateData && report.headers && report.headers.ok) {
    const templateCheck = validateTemplate_(report.templateData, report.headers);
    inlineCids = templateCheck.inlineCids;
    templateCheck.errors.forEach(function (error) {
      report.globalErrors.push(error);
    });
  }

  validateSender_(deps, config).forEach(function (error) {
    report.globalErrors.push(error);
  });

  if (report.templateData && report.headers) {
    report.templateKey = JSON.stringify({
      subject: report.templateData.subject,
      plainBody: report.templateData.plainBody,
      htmlBody: report.templateData.htmlBody,
      attachments: (report.templateData.attachments || []).map(function (attachment) {
        return [attachment.name, attachment.size];
      }),
      inlineCids: inlineCids,
      headers: { columns: report.headers.columns, byName: report.headers.byName },
      from: report.from,
      replyTo: report.replyTo,
    });
  }

  if (report.globalErrors.length > 0) {
    return report;
  }
  report.ok = true;

  const classification = classifyRows_(sheet, report.headers.columns);
  report.excluded = classification.excluded;
  const commonAttachments = report.templateData.attachments || [];

  classification.eligible.forEach(function (row) {
    const rowCheck = renderRow_(report.templateData, row.values, report.headers);
    const attachments = checkRowAttachments_(deps, row.values, report.headers, commonAttachments);
    const reasons = rowCheck.errors.concat(attachments.errors);
    if (reasons.length > 0) {
      report.invalid.push({ rowNumber: row.rowNumber, reasons: reasons });
    } else {
      report.valid.push({
        rowNumber: row.rowNumber,
        values: row.values,
        key: rowKey_(row.values),
        email: rowCheck.email,
        attachmentNames: attachments.names,
      });
    }
  });

  return report;
}

// Línea `y N filas más` para listas truncadas.
function moreRowsLine_(total, limit) {
  return total > limit ? ['y ' + (total - limit) + ' filas más'] : [];
}

/**
 * Revisión por fila para el operador (D-23): adjuntos comunes del borrador y,
 * por cada fila válida (hasta `limit`), `Fila N → destinatario: archivos`.
 * Solo nombres de archivo saneados: nunca URLs, IDs de Drive ni valores de
 * otras columnas.
 */
function formatRowReview_(report, limit) {
  const max = limit === undefined ? REPORT_ROW_LIMIT_ : limit;
  const common = ((report.templateData && report.templateData.attachments) || []).map(function (attachment) {
    return sanitizeHeaderValue_(attachment.name);
  });
  const lines = ['Adjuntos comunes: ' + (common.length > 0 ? common.join(', ') : 'ninguno')];
  const rows = (report.valid || []).slice().sort(function (a, b) {
    return a.rowNumber - b.rowNumber;
  });
  rows.slice(0, max).forEach(function (row) {
    const names = (row.attachmentNames || []).map(sanitizeHeaderValue_);
    const prefix = 'Fila ' + row.rowNumber + ' → ' + sanitizeHeaderValue_(row.email);
    lines.push(names.length > 0 ? prefix + ': ' + names.join(', ') : prefix + ' (sin adjuntos propios)');
  });
  return lines.concat(moreRowsLine_(rows.length, max)).join('\n');
}

/**
 * Informe de la validación previa en español, para `Ui.alert`.
 */
function formatPreflightReport_(report) {
  const lines = [
    'Pestaña: ' + (report.sheet && report.sheet.name ? sanitizeHeaderValue_(report.sheet.name) : '(no disponible)'),
    'Borrador (asunto): ' +
      (report.template && report.template.subject ? sanitizeHeaderValue_(report.template.subject) : '(no disponible)'),
    'Remitente: ' + (report.from ? sanitizeHeaderValue_(report.from) : '(no configurado)'),
    'Reply-To: ' + (report.replyTo ? sanitizeHeaderValue_(report.replyTo) : '(ninguno)'),
  ];

  if (report.globalErrors.length > 0) {
    lines.push('', 'Errores que bloquean toda la campaña:');
    report.globalErrors.forEach(function (error) {
      lines.push('- ' + sanitizeHeaderValue_(error));
    });
  }

  lines.push(
    '',
    'Filas válidas: ' + report.valid.length,
    'Filas inválidas: ' + report.invalid.length,
    'Filas excluidas: ' + report.excluded.length
  );
  const byReason = {};
  const reasonOrder = [];
  report.excluded.forEach(function (row) {
    if (!Object.prototype.hasOwnProperty.call(byReason, row.reason)) {
      byReason[row.reason] = 0;
      reasonOrder.push(row.reason);
    }
    byReason[row.reason]++;
  });
  reasonOrder.forEach(function (reason) {
    lines.push('  - ' + sanitizeHeaderValue_(reason) + ': ' + byReason[reason]);
  });
  lines.push(
    'Cuota diaria disponible: ' +
      (report.quotaRemaining === null || report.quotaRemaining === undefined ? 'no disponible' : report.quotaRemaining)
  );

  if (report.globalErrors.length === 0) {
    lines.push('', 'Correos que se enviarían:', formatRowReview_(report));
  }

  if (report.invalid.length > 0) {
    lines.push('', 'Filas inválidas (no se enviarán):');
    report.invalid.slice(0, REPORT_ROW_LIMIT_).forEach(function (row) {
      lines.push('Fila ' + row.rowNumber + ': ' + row.reasons.map(sanitizeHeaderValue_).join('; '));
    });
    moreRowsLine_(report.invalid.length, REPORT_ROW_LIMIT_).forEach(function (line) {
      lines.push(line);
    });
  }

  return lines.join('\n');
}
