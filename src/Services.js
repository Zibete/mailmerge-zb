/**
 * Adaptadores finos sobre los servicios de Google. `createServices_()`
 * construye el objeto `deps` que usa la lógica de los demás archivos (ver el
 * contrato en el plan). Aquí no hay lógica de negocio: solo traducción entre
 * el contrato de `deps` y las APIs de Apps Script. Los servicios se resuelven
 * recién al usarse, para que construir `deps` no lea ni escriba nada.
 *
 * Todo lo que depende del runtime real (alias, exportación a PDF, filas
 * ocultas por filtro, lock) queda PENDING LIVE VALIDATION.
 */

// Prefijos que Sheets interpreta como fórmula al escribir texto con
// `setValue` o `appendRow`; se fuerzan a texto con un apóstrofo inicial
// (D-38, AC-26).
const FORMULA_PREFIXES_ = ['=', '+', '-', '@'];

// Valor seguro para escribir en una celda: un texto que empieza con un prefijo
// de fórmula se escribe precedido por `'`; las `Date`, los números y el resto
// de los valores pasan sin cambios.
function asSheetValue_(value) {
  if (typeof value === 'string' && value !== '' && FORMULA_PREFIXES_.indexOf(value.charAt(0)) !== -1) {
    return "'" + value;
  }
  return value;
}

function createServices_() {
  function spreadsheet() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  function findSheet(sheetId) {
    const list = spreadsheet().getSheets();
    for (let i = 0; i < list.length; i++) {
      if (list[i].getSheetId() === sheetId) {
        return list[i];
      }
    }
    return null;
  }

  function requireSheet(sheetId) {
    const sheet = findSheet(sheetId);
    if (!sheet) {
      throw new Error('No existe la pestaña con id ' + sheetId);
    }
    return sheet;
  }

  function ownEmail() {
    return String(Session.getEffectiveUser().getEmail() || '');
  }

  const sheets = {
    listSheets: function () {
      return spreadsheet()
        .getSheets()
        .map(function (sheet) {
          return { id: sheet.getSheetId(), name: sheet.getName() };
        });
    },

    // `hiddenBy*[i]` corresponde a `values[i]`; el índice 0 (encabezados)
    // siempre es `false`.
    readSheet: function (sheetId) {
      const sheet = requireSheet(sheetId);
      const values = sheet.getDataRange().getDisplayValues();
      const hiddenByUser = [];
      const hiddenByFilter = [];
      for (let i = 0; i < values.length; i++) {
        hiddenByUser.push(i === 0 ? false : Boolean(sheet.isRowHiddenByUser(i + 1)));
        hiddenByFilter.push(i === 0 ? false : Boolean(sheet.isRowHiddenByFilter(i + 1)));
      }
      return {
        id: sheet.getSheetId(),
        name: sheet.getName(),
        values: values,
        hiddenByUser: hiddenByUser,
        hiddenByFilter: hiddenByFilter,
      };
    },

    readRow: function (sheetId, rowNumber, width) {
      return requireSheet(sheetId).getRange(rowNumber, 1, 1, width).getDisplayValues()[0];
    },

    // `column` es el índice 0-based de `mapHeaders_`. `flush` persiste el
    // valor antes de seguir (checkpoint por fila).
    writeStatus: function (sheetId, rowNumber, column, value) {
      requireSheet(sheetId).getRange(rowNumber, column + 1).setValue(value);
      SpreadsheetApp.flush();
    },

    // Escribe celdas de una fila de datos (`column` 0-based) en el orden dado,
    // con los textos neutralizados (D-37, D-38). Un único `flush` al final
    // persiste toda la transición antes de seguir.
    writeCells: function (sheetId, rowNumber, cells) {
      const sheet = requireSheet(sheetId);
      cells.forEach(function (cell) {
        sheet.getRange(rowNumber, cell.column + 1).setValue(asSheetValue_(cell.value));
      });
      SpreadsheetApp.flush();
    },

    // Escribe celdas de la fila 1 (`column` 0-based) para "Preparar columnas"
    // (D-33). Si alguna cae más allá de las columnas de la hoja, inserta las
    // que faltan al final una sola vez; un `flush` final persiste el cambio.
    writeHeaderCells: function (sheetId, cells) {
      const sheet = requireSheet(sheetId);
      const maxColumns = sheet.getMaxColumns();
      let neededColumns = 0;
      cells.forEach(function (cell) {
        neededColumns = Math.max(neededColumns, cell.column + 1);
      });
      if (neededColumns > maxColumns) {
        sheet.insertColumnsAfter(maxColumns, neededColumns - maxColumns);
      }
      cells.forEach(function (cell) {
        sheet.getRange(1, cell.column + 1).setValue(cell.value);
      });
      SpreadsheetApp.flush();
    },

    // Crea la pestaña de registro al primer uso (D-17) y agrega una fila en
    // el orden de `LOG_HEADERS`.
    appendLog: function (entry) {
      const book = spreadsheet();
      let log = book.getSheetByName(LOG_SHEET_NAME);
      if (!log) {
        log = book.insertSheet(LOG_SHEET_NAME);
        log.appendRow(LOG_HEADERS.slice());
      }
      log.appendRow(
        [
          entry.date,
          entry.campaignId,
          entry.sheetName,
          entry.rowNumber,
          entry.recipient,
          entry.result,
          entry.detail,
        ].map(asSheetValue_)
      );
    },

    showLogSheet: function () {
      const log = spreadsheet().getSheetByName(LOG_SHEET_NAME);
      if (!log) {
        return false;
      }
      log.activate();
      return true;
    },
  };

  const gmail = {
    // `date` como texto ISO: google.script.run no transporta objetos `Date`
    // hacia la sidebar.
    listDrafts: function () {
      return GmailApp.getDrafts().map(function (draft) {
        const message = draft.getMessage();
        return { id: draft.getId(), subject: message.getSubject(), date: message.getDate().toISOString() };
      });
    },

    // `GmailAttachment` no expone el Content-ID: los adjuntos comunes y las
    // imágenes inline se leen con dos llamadas separadas; las imágenes se
    // emparejan después por nombre (`alt`) en `mapInlineImages_`.
    getTemplate: function (draftId) {
      const draft = GmailApp.getDraft(draftId);
      if (!draft) {
        throw new Error('No existe el borrador configurado');
      }
      const message = draft.getMessage();
      const attachments = message
        .getAttachments({ includeInlineImages: false, includeAttachments: true })
        .map(function (attachment) {
          return {
            name: attachment.getName(),
            size: attachment.getSize(),
            mimeType: attachment.getContentType(),
            blob: attachment,
          };
        });
      const inlineImages = message
        .getAttachments({ includeInlineImages: true, includeAttachments: false })
        .map(function (image) {
          return { name: image.getName(), blob: image };
        });
      return {
        id: draft.getId(),
        subject: message.getSubject(),
        plainBody: message.getPlainBody(),
        htmlBody: message.getBody(),
        attachments: attachments,
        inlineImages: inlineImages,
      };
    },

    getAliases: function () {
      return GmailApp.getAliases();
    },

    // `from` se omite si es la cuenta propia y `replyTo` si está vacío; un
    // alias en `from` debe ser uno de `getAliases()` (PENDING LIVE VALIDATION).
    send: function (message) {
      const options = {
        htmlBody: message.htmlBody,
        attachments: (message.attachments || []).map(function (attachment) {
          return attachment.blob;
        }),
        inlineImages: message.inlineImages || {},
      };
      if (message.replyTo) {
        options.replyTo = message.replyTo;
      }
      if (message.from && message.from !== ownEmail()) {
        options.from = message.from;
      }
      GmailApp.sendEmail(message.to, message.subject, message.plainBody, options);
    },
  };

  const drive = {
    getFileInfo: function (fileId) {
      const file = DriveApp.getFileById(fileId);
      return {
        id: file.getId(),
        name: file.getName(),
        mimeType: file.getMimeType(),
        size: file.getSize(),
        trashed: file.isTrashed(),
      };
    },

    // Nativo exportable → PDF con nombre `${name}.pdf` (D-10); binario → el
    // blob sin conversión. `size` es el tamaño real del blob que se adjunta
    // (para un nativo, el del PDF exportado), que `buildMessage_` controla
    // contra el máximo antes del claim.
    getAttachment: function (fileInfo) {
      const file = DriveApp.getFileById(fileInfo.id);
      if (GOOGLE_EXPORTABLE_MIME_TYPES.indexOf(fileInfo.mimeType) !== -1) {
        const name = fileInfo.name + '.pdf';
        const pdf = file.getAs('application/pdf');
        pdf.setName(name);
        return { name: name, mimeType: 'application/pdf', size: pdf.getBytes().length, blob: pdf };
      }
      if (String(fileInfo.mimeType).indexOf('application/vnd.google-apps.') === 0) {
        throw new Error('Tipo de archivo de Google no exportable');
      }
      const blob = file.getBlob();
      return {
        name: fileInfo.name,
        mimeType: blob.getContentType() || fileInfo.mimeType,
        size: blob.getBytes().length,
        blob: blob,
      };
    },
  };

  // `Lock` no tiene `release()`: se libera con `releaseLock()`.
  // `getDocumentLock()` devuelve `null` fuera de un documento contenedor.
  let documentLock = null;
  const lock = {
    tryLock: function (ms) {
      documentLock = LockService.getDocumentLock();
      if (!documentLock) {
        return false;
      }
      return documentLock.tryLock(ms);
    },
    release: function () {
      if (documentLock) {
        documentLock.releaseLock();
      }
    },
  };

  // Configuración por usuario (D-08, D-39). `UserProperties` guarda texto:
  // `sheetId` se convierte a número (o `null`) para compararlo con
  // `getSheetId()`. Una configuración V1 sin `MM_CAMPAIGN_NAME` devuelve
  // `campaignName: ''`.
  const props = {
    getConfig: function () {
      const values = PropertiesService.getUserProperties().getProperties();
      const rawSheetId = values[PROPERTY_KEYS.SHEET_ID];
      const sheetIdText = rawSheetId === undefined || rawSheetId === null ? '' : String(rawSheetId).trim();
      const sheetId = sheetIdText === '' ? NaN : Number(sheetIdText);
      return {
        sheetId: isFinite(sheetId) ? sheetId : null,
        draftId: values[PROPERTY_KEYS.DRAFT_ID] || '',
        from: values[PROPERTY_KEYS.FROM] || '',
        replyTo: values[PROPERTY_KEYS.REPLY_TO] || '',
        campaignName: values[PROPERTY_KEYS.CAMPAIGN_NAME] || '',
      };
    },
    setConfig: function (config) {
      const values = {};
      values[PROPERTY_KEYS.SHEET_ID] = String(config.sheetId);
      values[PROPERTY_KEYS.DRAFT_ID] = String(config.draftId);
      values[PROPERTY_KEYS.FROM] = String(config.from);
      values[PROPERTY_KEYS.REPLY_TO] = String(config.replyTo || '');
      values[PROPERTY_KEYS.CAMPAIGN_NAME] = String(config.campaignName || '');
      PropertiesService.getUserProperties().setProperties(values);
    },
  };

  // Caché aislada por usuario y script (D-26, D-29), resuelta en cada uso.
  // Guarda el snapshot de confirmación y el registro de progreso como texto.
  const cache = {
    get: function (key) {
      return CacheService.getUserCache().get(key);
    },
    put: function (key, value, ttlSeconds) {
      CacheService.getUserCache().put(key, value, ttlSeconds);
    },
    remove: function (key) {
      CacheService.getUserCache().remove(key);
    },
  };

  // SHA-256 en hexadecimal en minúsculas (D-27). `computeDigest` devuelve
  // bytes con signo (-128..127): `& 0xff` los lleva a 0..255.
  const crypto = {
    sha256Hex: function (text) {
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
      let hex = '';
      for (let i = 0; i < bytes.length; i++) {
        hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
      }
      return hex;
    },
  };

  return {
    sheets: sheets,
    gmail: gmail,
    drive: drive,
    lock: lock,
    quota: {
      remaining: function () {
        return MailApp.getRemainingDailyQuota();
      },
    },
    session: {
      userEmail: function () {
        return ownEmail();
      },
    },
    props: props,
    clock: {
      now: function () {
        return Date.now();
      },
    },
    ids: {
      newCampaignId: function () {
        return Utilities.getUuid().slice(0, 8);
      },
      // Token opaco de una confirmación (D-26).
      newToken: function () {
        return Utilities.getUuid();
      },
    },
    cache: cache,
    crypto: crypto,
  };
}
