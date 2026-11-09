'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');

const OWN_EMAIL = 'operator@example.test';
const ALIAS_EMAIL = 'alias@example.test';

// Blob falso de Apps Script: bytes, nombre y tipo.
function fakeBlob(label, bytes, contentType) {
  const blob = {
    label,
    name: '',
    getBytes: () => new Array(bytes).fill(0),
    getContentType: () => contentType,
    setName(name) {
      blob.name = name;
      return blob;
    },
  };
  return blob;
}

// Pestaña falsa con registro de llamadas a rangos, filas y activación.
function fakeSheet(id, name, values, hidden = {}, log, maxColumns = 26) {
  return {
    values,
    getMaxColumns: () => maxColumns,
    insertColumnsAfter(afterPosition, howMany) {
      log.push(['insertColumnsAfter', id, afterPosition, howMany]);
      maxColumns += howMany;
    },
    getSheetId: () => id,
    getName: () => name,
    getDataRange: () => ({ getDisplayValues: () => values.map((row) => row.slice()) }),
    isRowHiddenByUser(row) {
      log.push(['isRowHiddenByUser', id, row]);
      return Boolean(hidden.user && hidden.user.includes(row));
    },
    isRowHiddenByFilter(row) {
      log.push(['isRowHiddenByFilter', id, row]);
      return Boolean(hidden.filter && hidden.filter.includes(row));
    },
    getRange(...args) {
      log.push(['getRange', id, ...args]);
      return {
        setValue(value) {
          log.push(['setValue', id, value]);
        },
        getDisplayValues() {
          const [row, column, numRows, numColumns] = args;
          return values.slice(row - 1, row - 1 + numRows).map((r) => r.slice(column - 1, column - 1 + numColumns));
        },
      };
    },
    appendRow(row) {
      log.push(['appendRow', id, row]);
      values.push(row);
    },
    activate() {
      log.push(['activate', id]);
    },
  };
}

// Globales de Google falsos y mínimos para los adaptadores de `Services.js`.
function createGoogleFakes(options = {}) {
  const log = [];
  const sheets = [
    fakeSheet(
      101,
      'Recipients',
      [
        ['Email Address', 'Mail Merge Status'],
        ['alpha@example.test', ''],
        ['beta@example.test', ''],
        ['gamma@example.test', ''],
      ],
      { user: [3], filter: [4] },
      log,
      options.maxColumns
    ),
  ];
  if (options.withLogSheet) {
    sheets.push(fakeSheet(202, 'Registro Mail Merge', [['Fecha']], {}, log));
  }
  const spreadsheet = {
    getSheets: () => sheets.slice(),
    getSheetByName: (name) => sheets.find((sheet) => sheet.getName() === name) || null,
    insertSheet(name) {
      log.push(['insertSheet', name]);
      const sheet = fakeSheet(300 + sheets.length, name, [], {}, log);
      sheets.push(sheet);
      return sheet;
    },
  };

  const attachmentsCalls = [];
  const draftMessage = {
    getSubject: () => 'Notice {{Reference}}',
    getDate: () => new Date(Date.UTC(2026, 10, 1, 10, 0, 0)),
    getPlainBody: () => 'Hola {{First Name}}',
    getBody: () => '<p>Hola {{First Name}}</p><img src="cid:logo" alt="logo.png">',
    getAttachments(opts) {
      attachmentsCalls.push(opts);
      if (opts.includeInlineImages) {
        return [{ getName: () => 'logo.png', getSize: () => 10, getContentType: () => 'image/png', label: 'inline' }];
      }
      return [{ getName: () => 'common.pdf', getSize: () => 3000, getContentType: () => 'application/pdf', label: 'common' }];
    },
  };
  const draft = { getId: () => 'draft-001', getMessage: () => draftMessage };

  const nativeExport = fakeBlob('native-pdf', 1500, 'application/pdf');
  const binaryBlob = fakeBlob('binary', 1000, 'application/pdf');
  const files = {
    nativeDoc000000000000001: {
      getId: () => 'nativeDoc000000000000001',
      getName: () => 'Alpha Letter',
      getMimeType: () => 'application/vnd.google-apps.document',
      getSize: () => 0,
      isTrashed: () => false,
      getAs(mime) {
        log.push(['getAs', mime]);
        return nativeExport;
      },
      getBlob() {
        log.push(['getBlob', 'native']);
        throw new Error('un nativo no se descarga con getBlob');
      },
    },
    binaryPdf00000000000001: {
      getId: () => 'binaryPdf00000000000001',
      getName: () => 'alpha-notice.pdf',
      getMimeType: () => 'application/pdf',
      getSize: () => 1000,
      isTrashed: () => false,
      getAs(mime) {
        log.push(['getAs', mime]);
        throw new Error('un binario no se exporta');
      },
      getBlob() {
        log.push(['getBlob', 'binary']);
        return binaryBlob;
      },
    },
  };

  const properties = { ...(options.properties || {}) };
  const sentEmails = [];
  const cacheStore = {};

  const globals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush() {
        log.push(['flush']);
      },
    },
    GmailApp: {
      getDrafts: () => [draft],
      getDraft: (id) => (id === 'draft-001' ? draft : null),
      getAliases: () => [ALIAS_EMAIL],
      sendEmail(...args) {
        sentEmails.push(args);
      },
    },
    DriveApp: {
      getFileById(id) {
        if (!files[id]) {
          throw new Error('No se encontró el archivo');
        }
        return files[id];
      },
    },
    LockService: {
      getDocumentLock: () => ({
        tryLock(ms) {
          log.push(['tryLock', ms]);
          return true;
        },
        releaseLock() {
          log.push(['releaseLock']);
        },
      }),
    },
    MailApp: { getRemainingDailyQuota: () => 42 },
    PropertiesService: {
      getUserProperties: () => ({
        getProperties: () => ({ ...properties }),
        setProperties(values) {
          log.push(['setProperties', { ...values }]);
          Object.assign(properties, values);
        },
      }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => OWN_EMAIL }) },
    // `computeDigest` devuelve los bytes con signo (-128..127), como el
    // `Byte[]` de Apps Script.
    Utilities: {
      getUuid: () => '0123abcd-4567-89ef-0123-456789abcdef',
      DigestAlgorithm: { SHA_256: 'SHA_256_ALG' },
      Charset: { UTF_8: 'UTF_8_CHARSET' },
      computeDigest(algorithm, text, charset) {
        log.push(['computeDigest', algorithm, text, charset]);
        return Array.from(nodeCrypto.createHash('sha256').update(String(text), 'utf8').digest()).map((b) =>
          b > 127 ? b - 256 : b
        );
      },
    },
    CacheService: {
      getUserCache() {
        log.push(['getUserCache']);
        return {
          get(key) {
            log.push(['cache.get', key]);
            return Object.prototype.hasOwnProperty.call(cacheStore, key) ? cacheStore[key] : null;
          },
          put(key, value, seconds) {
            log.push(['cache.put', key, value, seconds]);
            cacheStore[key] = value;
          },
          remove(key) {
            log.push(['cache.remove', key]);
            delete cacheStore[key];
          },
        };
      },
    },
    HtmlService: {},
  };

  return { globals, log, sheets, sentEmails, attachmentsCalls, properties, nativeExport, binaryBlob, cacheStore };
}

function setup(options) {
  const google = createGoogleFakes(options);
  const ctx = loadAppsScript(google.globals);
  const deps = ctx.createServices_();
  return { google, deps };
}

function baseMessage(patch = {}) {
  return {
    to: 'alpha@example.test',
    subject: 'Notice REF-001',
    plainBody: 'Hola Alpha',
    htmlBody: '<p>Hola Alpha</p>',
    attachments: [
      { name: 'common.pdf', mimeType: 'application/pdf', size: 3000, blob: { fake: 'common' } },
      { name: 'alpha-notice.pdf', mimeType: 'application/pdf', size: 1000, blob: { fake: 'alpha' } },
    ],
    inlineImages: { logo: { fake: 'logo' } },
    from: OWN_EMAIL,
    replyTo: '',
    ...patch,
  };
}

test('D-08 / D-39: props.getConfig devuelve sheetId numérico y campaignName', () => {
  const { deps } = setup({
    properties: {
      MM_SHEET_ID: '101',
      MM_DRAFT_ID: 'draft-001',
      MM_FROM: ALIAS_EMAIL,
      MM_REPLY_TO: 'r@example.test',
      MM_CAMPAIGN_NAME: 'Aviso noviembre',
    },
  });

  const config = plain(deps.props.getConfig());

  assert.deepEqual(config, {
    sheetId: 101,
    draftId: 'draft-001',
    from: ALIAS_EMAIL,
    replyTo: 'r@example.test',
    campaignName: 'Aviso noviembre',
  });
  assert.equal(typeof deps.props.getConfig().sheetId, 'number');
});

test('D-08: props.getConfig devuelve sheetId null si falta o no es numérico, y conserva el 0', () => {
  assert.equal(setup({ properties: {} }).deps.props.getConfig().sheetId, null);
  assert.equal(setup({ properties: { MM_SHEET_ID: 'x' } }).deps.props.getConfig().sheetId, null);
  assert.equal(setup({ properties: { MM_SHEET_ID: '0' } }).deps.props.getConfig().sheetId, 0);
  assert.equal(setup({ properties: {} }).deps.props.getConfig().replyTo, '');
});

test('AC-46 / D-39: props.getConfig sin MM_CAMPAIGN_NAME (configuración V1) devuelve campaignName vacío', () => {
  const { deps } = setup({
    properties: { MM_SHEET_ID: '101', MM_DRAFT_ID: 'draft-001', MM_FROM: OWN_EMAIL, MM_REPLY_TO: '' },
  });

  assert.equal(deps.props.getConfig().campaignName, '');
});

test('D-08 / D-39: props.setConfig guarda las cinco claves como texto en UserProperties', () => {
  const { google, deps } = setup();

  deps.props.setConfig({ sheetId: 101, draftId: 'draft-001', from: OWN_EMAIL, replyTo: '', campaignName: 'Aviso' });

  assert.deepEqual(google.properties, {
    MM_SHEET_ID: '101',
    MM_DRAFT_ID: 'draft-001',
    MM_FROM: OWN_EMAIL,
    MM_REPLY_TO: '',
    MM_CAMPAIGN_NAME: 'Aviso',
  });

  deps.props.setConfig({ sheetId: 101, draftId: 'draft-001', from: OWN_EMAIL, replyTo: '' });
  assert.equal(google.properties.MM_CAMPAIGN_NAME, '');
});

test('D-26: cache usa CacheService.getUserCache recién al usarse y delega get, put y remove', () => {
  const { google, deps } = setup();
  assert.equal(google.log.filter((entry) => entry[0] === 'getUserCache').length, 0);

  assert.equal(deps.cache.get('MM_CONF_x'), null);
  deps.cache.put('MM_CONF_x', '{"v":2}', 600);
  assert.equal(deps.cache.get('MM_CONF_x'), '{"v":2}');
  deps.cache.remove('MM_CONF_x');
  assert.equal(deps.cache.get('MM_CONF_x'), null);

  assert.deepEqual(
    google.log.filter((entry) => entry[0].indexOf('cache.') === 0),
    [
      ['cache.get', 'MM_CONF_x'],
      ['cache.put', 'MM_CONF_x', '{"v":2}', 600],
      ['cache.get', 'MM_CONF_x'],
      ['cache.remove', 'MM_CONF_x'],
      ['cache.get', 'MM_CONF_x'],
    ]
  );
  assert.ok(google.log.filter((entry) => entry[0] === 'getUserCache').length >= 1);
});

test('D-27: crypto.sha256Hex convierte los bytes con signo de computeDigest a hex en minúsculas', () => {
  const { google, deps } = setup();

  assert.equal(deps.crypto.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(
    google.log.filter((entry) => entry[0] === 'computeDigest'),
    [['computeDigest', 'SHA_256_ALG', 'abc', 'UTF_8_CHARSET']]
  );
  assert.equal(deps.crypto.sha256Hex('Campaña ñ'), nodeCrypto.createHash('sha256').update('Campaña ñ', 'utf8').digest('hex'));
});

test('D-26: ids.newToken usa Utilities.getUuid', () => {
  const { deps } = setup();

  assert.equal(deps.ids.newToken(), '0123abcd-4567-89ef-0123-456789abcdef');
});

test('D-05: gmail.send omite replyTo vacío y from igual a la cuenta propia', () => {
  const { google, deps } = setup();

  deps.gmail.send(baseMessage());

  assert.equal(google.sentEmails.length, 1);
  const [to, subject, plainBody, options] = google.sentEmails[0];
  assert.equal(to, 'alpha@example.test');
  assert.equal(subject, 'Notice REF-001');
  assert.equal(plainBody, 'Hola Alpha');
  assert.equal('replyTo' in options, false);
  assert.equal('from' in options, false);
  assert.equal(options.htmlBody, '<p>Hola Alpha</p>');
  assert.deepEqual(plain(options.attachments), [{ fake: 'common' }, { fake: 'alpha' }]);
  assert.deepEqual(plain(options.inlineImages), { logo: { fake: 'logo' } });
});

test('D-05 / AC-14: gmail.send pasa from (alias) y replyTo cuando corresponden', () => {
  const { google, deps } = setup();

  deps.gmail.send(baseMessage({ from: ALIAS_EMAIL, replyTo: 'respuestas@example.test' }));

  const options = google.sentEmails[0][3];
  assert.equal(options.from, ALIAS_EMAIL);
  assert.equal(options.replyTo, 'respuestas@example.test');
});

test('AC-18: lock usa getDocumentLock con tryLock y release llama a releaseLock', () => {
  const { google, deps } = setup();

  assert.equal(deps.lock.tryLock(10000), true);
  deps.lock.release();

  assert.deepEqual(google.log, [['tryLock', 10000], ['releaseLock']]);
});

test('R-12: writeStatus usa la columna column + 1 y llama a flush después de escribir', () => {
  const { google, deps } = setup();

  deps.sheets.writeStatus(101, 3, 1, 'ENVIANDO');

  assert.deepEqual(google.log, [['getRange', 101, 3, 2], ['setValue', 101, 'ENVIANDO'], ['flush']]);
});

test('AC-41 / D-38: writeCells escribe cada celda en orden, neutraliza fórmulas y hace un solo flush al final', () => {
  const { google, deps } = setup();
  const date = new Date(Date.UTC(2026, 10, 9, 12, 0, 0));

  deps.sheets.writeCells(101, 5, [
    { column: 4, value: date },
    { column: 5, value: '=HYPERLINK("x")' },
    { column: 7, value: '+X' },
    { column: 7, value: '-X' },
    { column: 7, value: '@X' },
    { column: 2, value: 42 },
    { column: 6, value: 'ENVIANDO' },
  ]);

  assert.deepEqual(google.log, [
    ['getRange', 101, 5, 5],
    ['setValue', 101, date],
    ['getRange', 101, 5, 6],
    ['setValue', 101, '\'=HYPERLINK("x")'],
    ['getRange', 101, 5, 8],
    ['setValue', 101, "'+X"],
    ['getRange', 101, 5, 8],
    ['setValue', 101, "'-X"],
    ['getRange', 101, 5, 8],
    ['setValue', 101, "'@X"],
    ['getRange', 101, 5, 3],
    ['setValue', 101, 42],
    ['getRange', 101, 5, 7],
    ['setValue', 101, 'ENVIANDO'],
    ['flush'],
  ]);
  // La `Date` pasa sin cambios (el mismo objeto).
  assert.equal(google.log[1][2], date);
});

test('AC-41: writeCells lanza sin escribir si la pestaña no existe', () => {
  const { google, deps } = setup();

  assert.throws(() => deps.sheets.writeCells(999, 2, [{ column: 0, value: 'x' }]), /pestaña/);
  assert.equal(google.log.filter((call) => call[0] === 'setValue' || call[0] === 'flush').length, 0);
});

test('D-33: writeHeaderCells inserta las columnas que faltan una sola vez, escribe en la fila 1 y hace un solo flush', () => {
  const { google, deps } = setup({ maxColumns: 6 });

  deps.sheets.writeHeaderCells(101, [
    { column: 6, value: 'Campaña' },
    { column: 7, value: 'Detalle' },
  ]);

  assert.deepEqual(google.log, [
    ['insertColumnsAfter', 101, 6, 2],
    ['getRange', 101, 1, 7],
    ['setValue', 101, 'Campaña'],
    ['getRange', 101, 1, 8],
    ['setValue', 101, 'Detalle'],
    ['flush'],
  ]);
});

test('D-33: writeHeaderCells no inserta columnas si alcanzan las existentes', () => {
  const { google, deps } = setup({ maxColumns: 8 });

  deps.sheets.writeHeaderCells(101, [
    { column: 1, value: 'Resultado' },
    { column: 7, value: 'Detalle' },
  ]);

  assert.deepEqual(google.log, [
    ['getRange', 101, 1, 2],
    ['setValue', 101, 'Resultado'],
    ['getRange', 101, 1, 8],
    ['setValue', 101, 'Detalle'],
    ['flush'],
  ]);
});

test('AC-11: readSheet lee valores mostrados y filas ocultas por fila (índice 0 = false)', () => {
  const { google, deps } = setup();

  const sheet = plain(deps.sheets.readSheet(101));

  assert.equal(sheet.id, 101);
  assert.equal(sheet.name, 'Recipients');
  assert.equal(sheet.values.length, 4);
  assert.deepEqual(sheet.hiddenByUser, [false, false, true, false]);
  assert.deepEqual(sheet.hiddenByFilter, [false, false, false, true]);
  const checkedRows = google.log.filter((call) => call[0] === 'isRowHiddenByUser').map((call) => call[2]);
  assert.deepEqual(checkedRows, [2, 3, 4]);
});

test('readSheet lanza si la pestaña no existe; readRow usa getRange(fila, 1, 1, ancho)', () => {
  const { google, deps } = setup();

  assert.throws(() => deps.sheets.readSheet(999), /pestaña/);
  assert.deepEqual(plain(deps.sheets.readRow(101, 3, 2)), ['beta@example.test', '']);
  assert.deepEqual(google.log.pop(), ['getRange', 101, 3, 1, 1, 2]);
});

test('listSheets devuelve id y nombre de cada pestaña', () => {
  const { deps } = setup({ withLogSheet: true });

  assert.deepEqual(plain(deps.sheets.listSheets()), [
    { id: 101, name: 'Recipients' },
    { id: 202, name: 'Registro Mail Merge' },
  ]);
});

test('D-17: appendLog crea la pestaña de registro con LOG_HEADERS una sola vez y agrega filas en orden', () => {
  const { google, deps } = setup();
  const date = new Date(Date.UTC(2026, 10, 9));
  const entry = {
    date,
    campaignId: 'camp0001',
    sheetName: 'Recipients',
    rowNumber: 2,
    recipient: 'alpha@example.test',
    result: 'Email Sent',
    detail: 'Aceptado por Gmail',
  };

  deps.sheets.appendLog(entry);
  deps.sheets.appendLog({ ...entry, rowNumber: 3 });

  const inserts = google.log.filter((call) => call[0] === 'insertSheet');
  assert.deepEqual(inserts, [['insertSheet', 'Registro Mail Merge']]);
  const rows = google.log.filter((call) => call[0] === 'appendRow').map((call) => call[2]);
  assert.equal(rows.length, 3);
  assert.deepEqual(plain(rows[0]), ['Fecha', 'Campaña', 'Pestaña', 'Fila', 'Destinatario', 'Resultado', 'Detalle']);
  assert.equal(rows[1][0], date);
  assert.deepEqual(plain(rows[1].slice(1)), ['camp0001', 'Recipients', 2, 'alpha@example.test', 'Email Sent', 'Aceptado por Gmail']);
  assert.equal(rows[2][3], 3);
});

test('AC-26: appendLog neutraliza textos que Sheets interpretaría como fórmula', () => {
  const { google, deps } = setup({ withLogSheet: true });

  deps.sheets.appendLog({
    date: new Date(0),
    campaignId: 'camp0001',
    sheetName: '=HOJA',
    rowNumber: 2,
    recipient: '+1@example.test',
    result: 'OMITIDA',
    detail: '-detalle',
  });

  const row = google.log.find((call) => call[0] === 'appendRow')[2];
  assert.deepEqual(plain(row.slice(1)), ['camp0001', "'=HOJA", 2, "'+1@example.test", 'OMITIDA', "'-detalle"]);
});

test('showLogSheet devuelve false sin pestaña de registro y la activa si existe', () => {
  assert.equal(setup().deps.sheets.showLogSheet(), false);

  const { google, deps } = setup({ withLogSheet: true });
  assert.equal(deps.sheets.showLogSheet(), true);
  assert.deepEqual(google.log.pop(), ['activate', 202]);
});

test('AC-08: drive.getAttachment exporta un nativo con getAs(application/pdf) y nombre .pdf', () => {
  const { google, deps } = setup();
  const info = plain(deps.drive.getFileInfo('nativeDoc000000000000001'));
  assert.deepEqual(info, {
    id: 'nativeDoc000000000000001',
    name: 'Alpha Letter',
    mimeType: 'application/vnd.google-apps.document',
    size: 0,
    trashed: false,
  });

  const attachment = deps.drive.getAttachment(info);

  assert.deepEqual(google.log, [['getAs', 'application/pdf']]);
  assert.equal(attachment.name, 'Alpha Letter.pdf');
  assert.equal(attachment.mimeType, 'application/pdf');
  // El tamaño es el del PDF exportado, para el control de tamaño total (AC-09).
  assert.equal(attachment.size, 1500);
  assert.equal(attachment.blob, google.nativeExport);
  assert.equal(google.nativeExport.name, 'Alpha Letter.pdf');
});

test('AC-05: drive.getAttachment descarga un binario con getBlob sin conversión', () => {
  const { google, deps } = setup();
  const info = deps.drive.getFileInfo('binaryPdf00000000000001');

  const attachment = deps.drive.getAttachment(info);

  assert.deepEqual(google.log, [['getBlob', 'binary']]);
  assert.equal(attachment.name, 'alpha-notice.pdf');
  assert.equal(attachment.size, 1000);
  assert.equal(attachment.blob, google.binaryBlob);
});

test('AC-07: drive.getFileInfo lanza si el archivo no existe', () => {
  const { deps } = setup();

  assert.throws(() => deps.drive.getFileInfo('noExiste00000000000000001'));
});

test('R-02: listDrafts devuelve date como texto ISO', () => {
  const { deps } = setup();

  assert.deepEqual(plain(deps.gmail.listDrafts()), [
    { id: 'draft-001', subject: 'Notice {{Reference}}', date: '2026-11-01T10:00:00.000Z' },
  ]);
  assert.equal(typeof deps.gmail.listDrafts()[0].date, 'string');
});

test('R-02: getTemplate separa adjuntos comunes e imágenes inline con dos llamadas a getAttachments', () => {
  const { google, deps } = setup();

  const template = deps.gmail.getTemplate('draft-001');

  assert.deepEqual(plain(google.attachmentsCalls), [
    { includeInlineImages: false, includeAttachments: true },
    { includeInlineImages: true, includeAttachments: false },
  ]);
  assert.equal(template.id, 'draft-001');
  assert.equal(template.subject, 'Notice {{Reference}}');
  assert.equal(template.plainBody, 'Hola {{First Name}}');
  assert.equal(template.htmlBody, '<p>Hola {{First Name}}</p><img src="cid:logo" alt="logo.png">');
  assert.equal(template.attachments.length, 1);
  assert.equal(template.attachments[0].name, 'common.pdf');
  assert.equal(template.attachments[0].size, 3000);
  assert.equal(template.attachments[0].mimeType, 'application/pdf');
  assert.equal(template.attachments[0].blob.label, 'common');
  assert.equal(template.inlineImages.length, 1);
  assert.equal(template.inlineImages[0].name, 'logo.png');
  assert.equal(template.inlineImages[0].blob.label, 'inline');
  assert.throws(() => deps.gmail.getTemplate('draft-ajeno'), /borrador/);
});

test('quota, session, aliases, clock e ids usan los servicios de Google', () => {
  const { deps } = setup();

  assert.equal(deps.quota.remaining(), 42);
  assert.equal(deps.session.userEmail(), OWN_EMAIL);
  assert.deepEqual(plain(deps.gmail.getAliases()), [ALIAS_EMAIL]);
  assert.equal(typeof deps.clock.now(), 'number');
  assert.equal(deps.ids.newCampaignId(), '0123abcd');
});
