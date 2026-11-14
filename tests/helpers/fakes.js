'use strict';

// Servicios falsos que imitan el contrato de `deps` del plan sobre el estado
// mutable de un fixture (`tests/fixtures/campaign.js`). Registran las
// llamadas con efectos (envíos, escrituras de celdas y de encabezados,
// caché, lock) y permiten inyectar fallas, fijar reloj y cuota, y mutar la
// hoja o la plantilla durante una ejecución mediante ganchos.
//
// Los falsos operan directamente sobre el fixture recibido: dos llamadas a
// `createFakeDeps` con el mismo fixture comparten la hoja y la caché
// (`fixture.cache`; útil para simular una segunda ejecución u otra cuenta),
// pero cada una tiene su propio `calls`.

const nodeCrypto = require('node:crypto');

const EXPORTABLE = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
];
const DEFAULT_NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

function createFakeDeps(fixture, options = {}) {
  const failOn = options.failOn || {};
  const hooks = options.hooks || {};
  const state = {
    now: options.now === undefined ? DEFAULT_NOW : options.now,
    quota: options.quota === undefined ? fixture.quota : options.quota,
    campaignCounter: 0,
    tokenCounter: 0,
  };

  // Caché en memoria compartida por todos los falsos del mismo fixture, como
  // `CacheService.getUserCache()`: `{ [clave]: texto }`.
  if (!fixture.cache) {
    fixture.cache = {};
  }
  const cacheStore = fixture.cache;

  const calls = {
    sent: [],
    lockCalls: [],
    // Orden combinado de escrituras (de celdas y de encabezados), envíos y
    // accesos a la caché, para verificar la secuencia ENVIANDO → send →
    // Email Sent.
    sequence: [],
    // Llamadas a `writeCells` (`{ sheetId, rowNumber, cells }`, con copias de
    // las celdas).
    cellWrites: [],
    // Llamadas de lectura a Drive (para verificar que no haya llamadas extra).
    driveCalls: [],
    configWrites: [],
    // Celdas de encabezado escritas por `writeHeaderCells` (migración).
    headerWrites: [],
    // Accesos a la caché: claves leídas, escrituras (`{ key, value,
    // ttlSeconds }`) y claves borradas. Las escrituras y los borrados también
    // quedan en `sequence` (`cachePut` / `cacheRemove`).
    cacheGets: [],
    cachePuts: [],
    cacheRemoves: [],
  };

  function findSheet(sheetId) {
    return fixture.sheets.find((sheet) => sheet.id === sheetId) || null;
  }

  function requireSheet(sheetId) {
    const sheet = findSheet(sheetId);
    if (!sheet) {
      throw new Error('Falso: no existe la pestaña ' + sheetId);
    }
    return sheet;
  }

  function campaignSheet() {
    return requireSheet(fixture.campaignSheetId);
  }

  function findDraft(draftId) {
    return fixture.gmail.drafts.find((draft) => draft.id === draftId) || null;
  }

  function matchesFailure(rule, value) {
    if (!rule) {
      return false;
    }
    if (typeof rule === 'function') {
      return Boolean(rule(value));
    }
    return true;
  }

  // Valor mostrado de una celda, como `getDisplayValues()`: los dos
  // adaptadores de lectura (`readSheet` y `readRow`) devuelven texto, así que
  // una `Date` escrita por `writeCells` en `Fecha` se lee igual en ambos.
  function displayValue(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  const sheets = {
    listSheets() {
      return fixture.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name }));
    },
    readSheet(sheetId) {
      const sheet = requireSheet(sheetId);
      return {
        id: sheet.id,
        name: sheet.name,
        values: sheet.values.map((row) => row.map(displayValue)),
        hiddenByUser: sheet.values.map((row, i) => Boolean(sheet.hiddenByUser[i])),
        hiddenByFilter: sheet.values.map((row, i) => Boolean(sheet.hiddenByFilter[i])),
      };
    },
    isRowVisible(sheetId, rowNumber) {
      const sheet = requireSheet(sheetId);
      return !sheet.hiddenByUser[rowNumber - 1] && !sheet.hiddenByFilter[rowNumber - 1];
    },
    readRow(sheetId, rowNumber, width) {
      if (typeof hooks.beforeReadRow === 'function') {
        hooks.beforeReadRow(rowNumber);
      }
      const sheet = requireSheet(sheetId);
      const row = sheet.values[rowNumber - 1] || [];
      const out = [];
      for (let i = 0; i < width; i++) {
        out.push(displayValue(row[i]));
      }
      return out;
    },
    // Escribe las celdas de una fila de datos en el orden dado (D-37),
    // extendiendo la hoja si la fila no existe.
    // `failOn.writeCells = { value, rowNumber, afterWrite }` aplica cuando
    // alguna celda de la llamada tiene ese `value` (`undefined` = cualquiera)
    // y la fila coincide (`undefined` = cualquiera): sin `afterWrite` lanza
    // antes de escribir; con `afterWrite` escribe todas las celdas y después
    // lanza.
    writeCells(sheetId, rowNumber, cells) {
      const rule = failOn.writeCells;
      const copies = cells.map((cell) => ({ column: cell.column, value: cell.value }));
      const fails =
        rule &&
        (rule.value === undefined || copies.some((cell) => cell.value === rule.value)) &&
        (rule.rowNumber === undefined || rule.rowNumber === rowNumber);
      if (fails && !rule.afterWrite) {
        calls.sequence.push({ type: 'writeCells-failed', rowNumber, cells: copies });
        throw new Error('Falso: falla al escribir las celdas');
      }
      const sheet = requireSheet(sheetId);
      while (sheet.values.length < rowNumber) {
        sheet.values.push(sheet.values[0].map(() => ''));
        sheet.hiddenByUser.push(false);
        sheet.hiddenByFilter.push(false);
      }
      copies.forEach((cell) => {
        sheet.values[rowNumber - 1][cell.column] = cell.value;
      });
      calls.cellWrites.push({ sheetId, rowNumber, cells: copies.map((cell) => ({ ...cell })) });
      calls.sequence.push({ type: 'writeCells', rowNumber, cells: copies.map((cell) => ({ ...cell })) });
      if (fails) {
        throw new Error('Falso: falla después de escribir las celdas');
      }
    },
    // Escribe celdas de la fila 1 en el orden dado. Una columna más allá del
    // ancho actual extiende todas las filas con '' (simula
    // `insertColumnsAfter`). `failOn.writeHeaderCells = { afterCells: N }`
    // lanza después de escribir las primeras N celdas (N = 0: antes de
    // escribir), para simular una migración parcial.
    writeHeaderCells(sheetId, cells) {
      const rule = failOn.writeHeaderCells;
      const sheet = requireSheet(sheetId);
      cells.forEach((cell, index) => {
        if (rule && index >= (rule.afterCells || 0)) {
          throw new Error('Falso: falla al escribir los encabezados');
        }
        const width = Math.max(...sheet.values.map((row) => row.length));
        if (cell.column >= width) {
          for (const row of sheet.values) {
            while (row.length <= cell.column) {
              row.push('');
            }
          }
        }
        sheet.values[0][cell.column] = cell.value;
        calls.headerWrites.push({ sheetId, column: cell.column, value: cell.value });
        calls.sequence.push({ type: 'writeHeaderCells', column: cell.column, value: cell.value });
      });
    },
  };

  // Imita Blob.getBytes() sin añadir propiedades visibles en los asserts
  // existentes. Los bytes reflejan mutaciones posteriores del blob.
  function testBlob(blob) {
    if (blob && typeof blob.getBytes !== 'function') {
      Object.defineProperty(blob, 'getBytes', {
        configurable: true, value: function () { return Array.from(Buffer.from(String(blob.fakeBlob), 'utf8')); },
      });
    }
    return blob;
  }

  const gmail = {
    listDrafts() {
      return fixture.gmail.drafts.map((draft) => ({ id: draft.id, subject: draft.subject, date: draft.date }));
    },
    getTemplate(draftId) {
      const draft = findDraft(draftId);
      if (!draft) {
        throw new Error('Falso: no existe el borrador ' + draftId);
      }
      return {
        id: draft.id,
        subject: draft.subject,
        plainBody: draft.plainBody,
        htmlBody: draft.htmlBody,
        attachments: draft.attachments.map((a) => ({ name: a.name, size: a.size, mimeType: a.mimeType, blob: testBlob(a.blob) })),
        inlineImages: draft.inlineImages.map((image) => ({ name: image.name, blob: testBlob(image.blob) })),
      };
    },
    getAliases() {
      return fixture.gmail.aliases.slice();
    },
    send(message) {
      if (matchesFailure(failOn.send, message)) {
        calls.sequence.push({ type: 'send-failed', to: message.to });
        throw new Error('Falso: Gmail lanzó una excepción');
      }
      calls.sent.push(message);
      calls.sequence.push({ type: 'send', to: message.to });
      if (typeof state.quota === 'number' && state.quota > 0) {
        state.quota--;
      }
      if (typeof hooks.afterSend === 'function') {
        hooks.afterSend(message);
      }
    },
  };

  const drive = {
    getFileInfo(fileId) {
      calls.driveCalls.push({ op: 'getFileInfo', id: fileId });
      if (failOn.getFileInfo && failOn.getFileInfo.id === fileId) {
        throw new Error('Falso: falla inyectada al leer el archivo');
      }
      const file = fixture.drive.files[fileId];
      if (!file || file.noAccess) {
        throw new Error('Falso: el archivo no existe o no hay acceso');
      }
      return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, trashed: Boolean(file.trashed), modifiedAt: file.modifiedAt || '2026-11-01T00:00:00.000Z' };
    },
    getAttachment(fileInfo) {
      calls.driveCalls.push({ op: 'getAttachment', id: fileInfo.id });
      const file = fixture.drive.files[fileInfo.id];
      if (!file || file.noAccess) {
        throw new Error('Falso: el archivo no existe o no hay acceso');
      }
      if (EXPORTABLE.indexOf(file.mimeType) !== -1) {
        return { name: file.name + '.pdf', mimeType: 'application/pdf', size: file.exportSize, blob: file.exportBlob };
      }
      if (String(file.mimeType).indexOf('application/vnd.google-apps.') === 0) {
        throw new Error('Falso: tipo nativo no exportable');
      }
      return { name: file.name, mimeType: file.mimeType, size: file.size, blob: file.blob };
    },
  };

  const lock = {
    tryLock(ms) {
      calls.lockCalls.push({ op: 'tryLock', ms });
      return options.lockAvailable !== false;
    },
    release() {
      calls.lockCalls.push({ op: 'release' });
    },
  };

  // `failOn.cachePut` y `failOn.cacheRemove`: `true` o una función de la
  // clave; lanzan sin modificar la caché.
  const cache = {
    get(key) {
      calls.cacheGets.push(key);
      return Object.prototype.hasOwnProperty.call(cacheStore, key) ? cacheStore[key] : null;
    },
    put(key, value, ttlSeconds) {
      if (matchesFailure(failOn.cachePut, key)) {
        calls.sequence.push({ type: 'cachePut-failed', key });
        throw new Error('Falso: falla al escribir en la caché');
      }
      cacheStore[key] = String(value);
      calls.cachePuts.push({ key, value: String(value), ttlSeconds });
      calls.sequence.push({ type: 'cachePut', key });
    },
    remove(key) {
      if (matchesFailure(failOn.cacheRemove, key)) {
        calls.sequence.push({ type: 'cacheRemove-failed', key });
        throw new Error('Falso: falla al borrar de la caché');
      }
      delete cacheStore[key];
      calls.cacheRemoves.push(key);
      calls.sequence.push({ type: 'cacheRemove', key });
    },
  };

  const deps = {
    sheets,
    gmail,
    drive,
    lock,
    quota: {
      remaining() {
        return state.quota;
      },
    },
    session: {
      userEmail() {
        return options.userEmail === undefined ? fixture.account.userEmail : options.userEmail;
      },
    },
    props: {
      // Una configuración V1 sin `campaignName` devuelve `''`, como el
      // adaptador real sin `MM_CAMPAIGN_NAME`.
      getConfig() {
        return fixture.config ? { campaignName: '', ...fixture.config } : null;
      },
      setConfig(config) {
        calls.configWrites.push({ ...config });
        fixture.config = { ...config };
      },
    },
    clock: {
      now() {
        return typeof state.now === 'function' ? state.now() : state.now;
      },
    },
    ids: {
      newCampaignId() {
        if (options.campaignId !== undefined) {
          return options.campaignId;
        }
        state.campaignCounter++;
        return 'camp' + String(state.campaignCounter).padStart(4, '0');
      },
      // UUID válidos y deterministas: `options.tokens` en orden o
      // `00000000-0000-4000-8000-00000000000N`.
      newToken() {
        state.tokenCounter++;
        if (Array.isArray(options.tokens) && options.tokens.length >= state.tokenCounter) {
          return options.tokens[state.tokenCounter - 1];
        }
        return '00000000-0000-4000-8000-' + String(state.tokenCounter).padStart(12, '0');
      },
    },
    cache,
    crypto: {
      sha256Hex(text) {
        return nodeCrypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
      },
      sha256HexBytes(bytes) {
        return nodeCrypto.createHash('sha256').update(Buffer.from(bytes.map((n) => n & 0xff))).digest('hex');
      },
    },
  };

  // Helpers de mutación sobre la pestaña de la campaña.
  function headerIndex(header) {
    const index = campaignSheet().values[0].indexOf(header);
    if (index === -1) {
      throw new Error('Falso: no existe el encabezado ' + header);
    }
    return index;
  }

  function setCell(rowNumber, header, value) {
    const sheet = campaignSheet();
    const column = headerIndex(header);
    while (sheet.values.length < rowNumber) {
      sheet.values.push(sheet.values[0].map(() => ''));
      sheet.hiddenByUser.push(false);
      sheet.hiddenByFilter.push(false);
    }
    sheet.values[rowNumber - 1][column] = value;
  }

  function insertRowAbove(rowNumber, values) {
    const sheet = campaignSheet();
    sheet.values.splice(rowNumber - 1, 0, values.slice());
    sheet.hiddenByUser.splice(rowNumber - 1, 0, false);
    sheet.hiddenByFilter.splice(rowNumber - 1, 0, false);
  }

  function appendRow(values) {
    insertRowAbove(campaignSheet().values.length + 1, values);
    return campaignSheet().values.length;
  }

  function swapRows(a, b) {
    const sheet = campaignSheet();
    for (const list of [sheet.values, sheet.hiddenByUser, sheet.hiddenByFilter]) {
      const tmp = list[a - 1];
      list[a - 1] = list[b - 1];
      list[b - 1] = tmp;
    }
  }

  function setTemplate(patch) {
    const draft = findDraft(fixture.config.draftId);
    if (!draft) {
      throw new Error('Falso: no existe el borrador configurado');
    }
    Object.assign(draft, patch);
  }

  function getCell(rowNumber, header) {
    const row = campaignSheet().values[rowNumber - 1] || [];
    return row[headerIndex(header)];
  }

  return {
    deps,
    calls,
    fixture,
    setCell,
    getCell,
    insertRowAbove,
    appendRow,
    swapRows,
    setTemplate,
    setNow(value) {
      state.now = value;
    },
    // Desalojo de una entrada de la caché (sin registrar llamadas).
    evict(key) {
      delete cacheStore[key];
    },
    // Contenido corrupto o alterado en la caché (sin registrar llamadas).
    setCacheValue(key, value) {
      cacheStore[key] = value;
    },
    setQuota(value) {
      state.quota = value;
    },
  };
}

module.exports = { createFakeDeps };
