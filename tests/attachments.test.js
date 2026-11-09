'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');

// IDs sintéticos de Drive (20 caracteres o más).
const ID_A = 'AAAAAAAAAAAAAAAAAAAAAAAAA1';
const ID_B = 'BBBBBBBBBBBBBBBBBBBBBBBBB2';
const MB = 1024 * 1024;

function assertNoSecrets(errors, secrets) {
  for (const error of errors) {
    for (const secret of secrets) {
      assert.ok(!error.includes(secret), 'el mensaje no debe incluir "' + secret + '": ' + error);
    }
  }
}

test('R-05 / AC-05: dos enlaces separados por coma, con espacios y una pieza vacía, dan exactamente esos dos IDs en orden', () => {
  const ctx = loadAppsScript();
  const cell =
    '  https://drive.google.com/file/d/' + ID_A + '/view?usp=sharing , ,' +
    'https://drive.google.com/open?id=' + ID_B + ' ,';
  const result = plain(ctx.parseDriveLinks_(cell));
  assert.deepEqual(result, { ids: [ID_A, ID_B], errors: [] });
});

test('R-05: una celda vacía no tiene adjuntos ni errores', () => {
  const ctx = loadAppsScript();
  for (const cell of ['', '   ', ' , , ', null, undefined]) {
    assert.deepEqual(plain(ctx.parseDriveLinks_(cell)), { ids: [], errors: [] });
  }
});

test('R-05: cada formato aceptado extrae el ID', () => {
  const ctx = loadAppsScript();
  const links = [
    'https://drive.google.com/file/d/' + ID_A,
    'https://drive.google.com/file/d/' + ID_A + '/view',
    'https://drive.google.com/open?id=' + ID_A,
    'https://drive.google.com/uc?id=' + ID_A,
    'https://drive.google.com/uc?id=' + ID_A + '&export=download',
    'https://docs.google.com/document/d/' + ID_A + '/edit',
    'https://docs.google.com/spreadsheets/d/' + ID_A + '/edit#gid=0',
    'https://docs.google.com/presentation/d/' + ID_A + '/edit?usp=sharing',
  ];
  for (const link of links) {
    assert.deepEqual(plain(ctx.parseDriveLinks_(link)), { ids: [ID_A], errors: [] }, link);
  }
});

test('R-05: rechaza host ajeno, http://, ID suelto, ID corto y formatos desconocidos sin mostrar la URL ni el ID', () => {
  const ctx = loadAppsScript();
  const shortId = 'SHORT1234567890';
  const rejected = [
    'https://example.test/file/d/' + ID_A + '/view',
    'https://drive.google.com.example.test/file/d/' + ID_A,
    'http://drive.google.com/file/d/' + ID_A + '/view',
    ID_A,
    'https://drive.google.com/file/d/' + shortId + '/view',
    'https://docs.google.com/forms/d/' + ID_A + '/edit',
    'https://drive.google.com/drive/folders/' + ID_A,
  ];
  for (const link of rejected) {
    const result = plain(ctx.parseDriveLinks_(link));
    assert.deepEqual(result.ids, [], link);
    assert.deepEqual(result.errors, ['Enlace de adjunto n.º 1 no válido'], link);
    assertNoSecrets(result.errors, [link, ID_A, shortId]);
  }
});

test('R-05: numera el enlace inválido por su posición entre las piezas no vacías', () => {
  const ctx = loadAppsScript();
  const cell = 'https://drive.google.com/file/d/' + ID_A + '/view, , https://example.test/x';
  const result = plain(ctx.parseDriveLinks_(cell));
  assert.deepEqual(result.ids, [ID_A]);
  assert.deepEqual(result.errors, ['Enlace de adjunto n.º 2 no válido']);
});

test('R-05: un ID repetido en la misma celda es error, aunque cambie el formato del enlace', () => {
  const ctx = loadAppsScript();
  const cell =
    'https://drive.google.com/file/d/' + ID_A + '/view,' +
    'https://drive.google.com/open?id=' + ID_A;
  const result = plain(ctx.parseDriveLinks_(cell));
  assert.deepEqual(result.ids, [ID_A]);
  assert.deepEqual(result.errors, ['Enlace de adjunto n.º 2 repetido']);
  assertNoSecrets(result.errors, [ID_A, 'https://']);
});

test('AC-08 (unidad): classifyDriveFile_ exporta a PDF documentos, hojas y presentaciones', () => {
  const ctx = loadAppsScript();
  for (const mimeType of [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
  ]) {
    const result = plain(ctx.classifyDriveFile_({ id: ID_A, name: 'Archivo', mimeType, size: 0, trashed: false }));
    assert.equal(result.ok, true, mimeType);
    assert.equal(result.kind, 'export-pdf', mimeType);
  }
});

test('AC-08 (unidad): classifyDriveFile_ usa el blob original para un PDF', () => {
  const ctx = loadAppsScript();
  const result = plain(ctx.classifyDriveFile_({ id: ID_A, name: 'a.pdf', mimeType: 'application/pdf', size: 10, trashed: false }));
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'binary');
});

test('AC-08 (unidad): classifyDriveFile_ rechaza formularios, carpetas y archivos en la papelera', () => {
  const ctx = loadAppsScript();
  for (const mimeType of ['application/vnd.google-apps.form', 'application/vnd.google-apps.folder']) {
    const result = plain(ctx.classifyDriveFile_({ id: ID_A, name: 'X', mimeType, size: 0, trashed: false }));
    assert.equal(result.ok, false, mimeType);
    assert.match(result.error, /tipo no soportado/);
    assertNoSecrets([result.error], [ID_A]);
  }
  const trashed = plain(ctx.classifyDriveFile_({ id: ID_A, name: 'a.pdf', mimeType: 'application/pdf', size: 10, trashed: true }));
  assert.equal(trashed.ok, false);
  assert.match(trashed.error, /papelera/);
  assertNoSecrets([trashed.error], [ID_A]);
});

test('AC-09 (unidad): checkAttachmentSizes_ acepta por debajo y en el máximo', () => {
  const ctx = loadAppsScript();
  const max = 20 * MB;
  const below = plain(ctx.checkAttachmentSizes_([{ size: 5 * MB }, { size: 5 * MB }], max));
  assert.deepEqual({ ok: below.ok, totalBytes: below.totalBytes }, { ok: true, totalBytes: 10 * MB });
  const equal = plain(ctx.checkAttachmentSizes_([{ size: 15 * MB }, { size: 5 * MB }], max));
  assert.deepEqual({ ok: equal.ok, totalBytes: equal.totalBytes }, { ok: true, totalBytes: max });
  const empty = plain(ctx.checkAttachmentSizes_([], max));
  assert.deepEqual({ ok: empty.ok, totalBytes: empty.totalBytes }, { ok: true, totalBytes: 0 });
});

test('AC-09 (unidad): checkAttachmentSizes_ por encima del máximo devuelve un error accionable', () => {
  const ctx = loadAppsScript();
  const max = 20 * MB;
  const result = plain(ctx.checkAttachmentSizes_([{ size: 15 * MB }, { size: 5 * MB + 1 }], max));
  assert.equal(result.ok, false);
  assert.equal(result.totalBytes, max + 1);
  assert.match(result.error, /MB/);
  assert.match(result.error, /20 MB/);
  assert.match(result.error, /20,1 MB/);
});

test('AC-09 (unidad): checkAttachmentSizes_ falla cerrado con un tamaño desconocido', () => {
  const ctx = loadAppsScript();
  const result = plain(ctx.checkAttachmentSizes_([{ size: 10 }, { size: undefined }], 20 * MB));
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});
