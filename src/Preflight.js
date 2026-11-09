/**
 * Validación previa de la campaña (R-07, AC-27): lee la configuración, la
 * pestaña, el borrador, la cuenta y los adjuntos, y arma un informe. Es de
 * solo lectura: nunca llama a `gmail.send` ni escribe en la hoja
 * (`writeCells`, `writeHeaderCells`). También arma las vistas estructuradas
 * para la sidebar (`buildValidationView_`), en JSON plano y con los textos
 * saneados (D-42, D-44).
 */

// Cantidad de filas que lista el texto de consentimiento (D-47) antes de
// `y N filas más`.
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

// Valida la plantilla contra los encabezados: marcadores desconocidos o de
// columnas gestionadas (D-35; errores globales, afectan a todas las filas) e
// imágenes inline sin emparejar. Las columnas gestionadas las escribe el
// script durante el envío, así que no pueden alimentar el contenido.
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
    if (MANAGED_HEADERS.indexOf(name) !== -1) {
      errors.push('La columna "' + name + '" la escribe Mail Merge y no se puede usar como marcador');
    } else if (!Object.prototype.hasOwnProperty.call(known, name)) {
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
 * Devuelve `{ ok, globalErrors, setup, sheet, template, templateData, from,
 * replyTo, headers, templateKey, valid, invalid, excluded, quotaRemaining }`.
 * `ok` es `true` si no hay errores globales; con errores globales
 * (configuración, pestaña, encabezados, plantilla, cuenta, remitente) `valid`
 * queda vacío y no se revisan las filas. `setup` es el plan de "Preparar
 * columnas" (`planColumnSetup_`) cuando la pestaña tiene encabezados heredados
 * o le falta alguna columna gestionada (D-35), y `null` en otro caso.
 * `templateData` es la plantilla tal como la devolvió `getTemplate` y es la
 * única que se usa para armar mensajes.
 */
function buildPreflight_(deps, config) {
  const report = {
    ok: false,
    globalErrors: [],
    setup: null,
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
    report.globalErrors.push(
      'La configuración de la campaña está incompleta; completala en la sección "Campaña" del panel'
    );
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
    if (!report.headers.ok) {
      const setupPlan = planColumnSetup_(sheet);
      if (setupPlan.needed) {
        report.setup = setupPlan;
      }
    }
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
        key: rowKey_(row.values, report.headers.columns),
        email: rowCheck.email,
        attachmentNames: attachments.names,
      });
    }
  });

  return report;
}

// --- Vistas estructuradas para la sidebar (D-42, D-44, D-47) ---------------
// JSON plano (sin `Date`, `Map` ni funciones) y textos saneados en una línea:
// la sidebar los inserta solo con `textContent`.

// Texto saneado para una vista: sin CR, LF ni tabulaciones, recortado.
function viewText_(value) {
  return value === null || value === undefined ? '' : sanitizeHeaderValue_(value);
}

function byRowNumber_(a, b) {
  return a.rowNumber - b.rowNumber;
}

/**
 * Revisión por fila para la sidebar (D-42, modifica D-23): adjuntos comunes
 * del borrador y, por cada fila válida en orden ascendente (hasta `limit`),
 * `{ rowNumber, email, attachmentNames }` con los nombres en el orden de la
 * celda. Devuelve `{ commonAttachments, rows, more }`, con `more` = filas
 * válidas que exceden `limit`. Solo nombres de archivo saneados: nunca URLs,
 * IDs de Drive ni valores de otras columnas.
 */
function buildRowReview_(report, limit = LIMITS.MAX_CONFIRM_ROWS) {
  const commonAttachments = ((report.templateData && report.templateData.attachments) || []).map(function (
    attachment
  ) {
    return viewText_(attachment.name);
  });
  const sorted = (report.valid || []).slice().sort(byRowNumber_);
  const rows = sorted.slice(0, limit).map(function (row) {
    return {
      rowNumber: row.rowNumber,
      email: viewText_(row.email),
      attachmentNames: (row.attachmentNames || []).map(viewText_),
    };
  });
  return { commonAttachments: commonAttachments, rows: rows, more: Math.max(0, sorted.length - limit) };
}

/**
 * Filas a enviar cuyas columnas `Fecha`, `Campaña` o `Detalle` ya tienen valor
 * (no vacío tras recortar), que el envío reemplazaría (D-47). Recibe filas con
 * `{ rowNumber, values }` y las columnas de `mapHeaders_`; devuelve
 * `[{ rowNumber, columns }]` en orden ascendente, con los nombres de esas
 * columnas en el orden `Fecha`, `Campaña`, `Detalle`. Nunca devuelve los
 * valores.
 */
function findOverwriteRows_(rows, columns) {
  const managed = [
    [columns.date, HEADERS.DATE],
    [columns.campaign, HEADERS.CAMPAIGN],
    [columns.detail, HEADERS.DETAIL],
  ];
  const result = [];
  (rows || []).forEach(function (row) {
    const values = row.values || [];
    const names = managed
      .filter(function (pair) {
        return presentColumn_(values, pair[0]) !== MISSING_COLUMN && cellText_(values[pair[0]]) !== '';
      })
      .map(function (pair) {
        return pair[1];
      });
    if (names.length > 0) {
      result.push({ rowNumber: row.rowNumber, columns: names });
    }
  });
  return result.sort(byRowNumber_);
}

/**
 * Texto de la casilla de consentimiento de D-47: `Acepto que se reemplacen los
 * valores existentes de Fecha, Campaña o Detalle en N filas: fila 2 (Fecha,
 * Detalle), fila 5 (Campaña)`, con hasta `REPORT_ROW_LIMIT_` filas y luego
 * `y N filas más`. Devuelve `''` si la lista está vacía.
 */
function formatOverwriteConsent_(overwriteRows) {
  const list = overwriteRows || [];
  if (list.length === 0) {
    return '';
  }
  const items = list.slice(0, REPORT_ROW_LIMIT_).map(function (row) {
    return 'fila ' + row.rowNumber + ' (' + (row.columns || []).map(viewText_).join(', ') + ')';
  });
  const more = list.length - REPORT_ROW_LIMIT_;
  return viewText_(
    'Acepto que se reemplacen los valores existentes de ' + HEADERS.DATE + ', ' + HEADERS.CAMPAIGN + ' o ' +
      HEADERS.DETAIL + ' en ' + list.length + (list.length === 1 ? ' fila: ' : ' filas: ') + items.join(', ') +
      (more > 0 ? ' y ' + more + ' filas más' : '')
  );
}

// Copia del plan de columnas para la vista. `headerKey` no se sanea: es la
// clave exacta del compare-and-set de `applyColumnSetup_`.
function viewColumnSetupPlan_(plan) {
  return {
    needed: plan.needed === true,
    headerKey: String(plan.headerKey),
    renames: (plan.renames || []).map(function (rename) {
      return { column: rename.column, from: viewText_(rename.from), to: viewText_(rename.to) };
    }),
    appends: (plan.appends || []).map(function (append) {
      return { column: append.column, name: viewText_(append.name) };
    }),
    errors: (plan.errors || []).map(viewText_),
    blockedRows: (plan.blockedRows || []).slice(),
  };
}

/**
 * Vista de la validación para la sidebar (`ValidationView` del plan; D-42,
 * D-44, D-47). Lista todas las filas válidas y las inválidas hasta
 * `LIMITS.MAX_CONFIRM_ROWS` (`moreRows` / `moreInvalid` cuentan el resto),
 * los motivos de exclusión en orden de primera aparición y, como aviso, las
 * filas válidas con `Fecha`, `Campaña` o `Detalle` a reemplazar
 * (`overwriteRows`, vacío con errores globales). `quotaRemaining` es `null` si
 * no está disponible.
 */
function buildValidationView_(report) {
  const limit = LIMITS.MAX_CONFIRM_ROWS;
  const globalErrors = report.globalErrors || [];
  const valid = report.valid || [];
  const invalid = (report.invalid || []).slice().sort(byRowNumber_);
  const excluded = report.excluded || [];
  const review = buildRowReview_(report, limit);

  const excludedByReason = [];
  const positionByReason = {};
  excluded.forEach(function (row) {
    const reason = viewText_(row.reason);
    if (!Object.prototype.hasOwnProperty.call(positionByReason, reason)) {
      positionByReason[reason] = excludedByReason.length;
      excludedByReason.push({ reason: reason, count: 0 });
    }
    excludedByReason[positionByReason[reason]].count++;
  });

  const quota = report.quotaRemaining;
  const canOverwrite = globalErrors.length === 0 && report.headers && report.headers.ok;

  return {
    ok: report.ok === true && globalErrors.length === 0,
    globalErrors: globalErrors.map(viewText_),
    setup: report.setup ? viewColumnSetupPlan_(report.setup) : null,
    sheetName: viewText_(report.sheet && report.sheet.name),
    subject: viewText_(report.template && report.template.subject),
    from: viewText_(report.from),
    replyTo: viewText_(report.replyTo),
    quotaRemaining: typeof quota === 'number' && isFinite(quota) ? quota : null,
    counts: { valid: valid.length, invalid: invalid.length, excluded: excluded.length },
    excludedByReason: excludedByReason,
    commonAttachments: review.commonAttachments,
    rows: review.rows,
    moreRows: review.more,
    invalidRows: invalid.slice(0, limit).map(function (row) {
      return { rowNumber: row.rowNumber, reasons: (row.reasons || []).map(viewText_) };
    }),
    moreInvalid: Math.max(0, invalid.length - limit),
    overwriteRows: canOverwrite ? findOverwriteRows_(valid, report.headers.columns) : [],
  };
}
