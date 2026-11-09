'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');

const HEADER_ROW = ['Email Address', 'First Name', 'Reference', 'File Attachments', 'Mail Merge Status', 'Scheduled Date'];
const HEADER_ROW_NO_SCHEDULED = ['Email Address', 'First Name', 'Reference', 'File Attachments', 'Mail Merge Status'];

// Arma el objeto que devuelve `readSheet`: fila 1 = encabezados; las filas
// de datos pueden indicar si están ocultas por el usuario o por un filtro.
function sheetData(headerRow, rows) {
  const values = [headerRow];
  const hiddenByUser = [false];
  const hiddenByFilter = [false];
  for (const row of rows) {
    values.push(row.values);
    hiddenByUser.push(Boolean(row.hiddenByUser));
    hiddenByFilter.push(Boolean(row.hiddenByFilter));
  }
  return { id: 1, name: 'Recipients', values, hiddenByUser, hiddenByFilter };
}

function row(status, extra = {}) {
  const scheduled = extra.scheduled || '';
  return { values: ['alpha@example.test', 'Alpha', 'REF-1', '', status, scheduled], ...extra };
}

function classify(ctx, headerRow, rows) {
  const mapped = ctx.mapHeaders_(headerRow);
  assert.equal(mapped.ok, true);
  return plain(ctx.classifyRows_(sheetData(headerRow, rows), mapped.columns));
}

test('AC-12: mapHeaders_ rechaza un encabezado duplicado', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email Address', 'First Name', 'First Name', 'Mail Merge Status']);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.match(result.errors.join('\n'), /First Name/);
});

test('AC-12: mapHeaders_ rechaza un duplicado normalizado (First Name / first  name)', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email Address', 'First Name', 'first  name', 'Mail Merge Status']);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('AC-12: mapHeaders_ rechaza la falta de Email Address', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['First Name', 'Mail Merge Status']);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Email Address/);
});

test('AC-12: mapHeaders_ rechaza la falta de Mail Merge Status', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email Address', 'First Name']);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Mail Merge Status/);
});

test('AC-12: mapHeaders_ rechaza un encabezado requerido con otra capitalización (email address)', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['email address', 'First Name', 'Mail Merge Status']);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /email address/);
});

test('AC-12: mapHeaders_ rechaza un encabezado requerido con otro espaciado interno', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email  Address', 'First Name', 'Mail Merge Status']);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('AC-12: mapHeaders_ acepta encabezados con espacios alrededor y celdas vacías', () => {
  const ctx = loadAppsScript();
  const result = plain(
    ctx.mapHeaders_(['  Email Address ', '', 'First Name', ' File Attachments', 'Mail Merge Status  ', '', 'Scheduled Date'])
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.columns, { email: 0, attachments: 3, status: 4, scheduled: 6 });
  assert.deepEqual(result.byName, {
    'Email Address': 0,
    'First Name': 2,
    'File Attachments': 3,
    'Mail Merge Status': 4,
    'Scheduled Date': 6,
  });
});

test('AC-12: mapHeaders_ sin Scheduled Date ni File Attachments marca esas columnas como ausentes (-1)', () => {
  const ctx = loadAppsScript();
  const result = plain(ctx.mapHeaders_(['Email Address', 'First Name', 'Mail Merge Status']));
  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, { email: 0, attachments: -1, status: 2, scheduled: -1 });
});

test('AC-10: filas con estado no vacío quedan excluidas con su motivo; estado vacío es elegible', () => {
  const ctx = loadAppsScript();
  const result = classify(ctx, HEADER_ROW, [
    row('SKIP'),
    row('Email Sent'),
    row('ENVIANDO'),
    row('REVISAR'),
    row('2026-01-01'),
    row(''),
  ]);
  assert.deepEqual(result.excluded, [
    { rowNumber: 2, reason: 'estado: SKIP' },
    { rowNumber: 3, reason: 'estado: Email Sent' },
    { rowNumber: 4, reason: 'estado: ENVIANDO' },
    { rowNumber: 5, reason: 'estado: REVISAR' },
    { rowNumber: 6, reason: 'estado: 2026-01-01' },
  ]);
  assert.deepEqual(result.eligible, [
    { rowNumber: 7, values: ['alpha@example.test', 'Alpha', 'REF-1', '', '', ''] },
  ]);
  assert.equal(result.blankRows, 0);
});

test('AC-11: filas ocultas por el usuario o por un filtro quedan excluidas aun con estado vacío', () => {
  const ctx = loadAppsScript();
  const result = classify(ctx, HEADER_ROW, [
    row('', { hiddenByUser: true }),
    row('', { hiddenByFilter: true }),
    row('SKIP', { hiddenByUser: true, hiddenByFilter: true }),
  ]);
  assert.deepEqual(result.excluded, [
    { rowNumber: 2, reason: 'oculta por el usuario' },
    { rowNumber: 3, reason: 'oculta por un filtro' },
    { rowNumber: 4, reason: 'oculta por el usuario' },
  ]);
  assert.deepEqual(result.eligible, []);
});

test('D-03 (AC-31): una fila con Scheduled Date con valor queda excluida', () => {
  const ctx = loadAppsScript();
  const result = classify(ctx, HEADER_ROW, [row('', { scheduled: '2026-12-01' }), row('SKIP', { scheduled: '2026-12-01' })]);
  assert.deepEqual(result.excluded, [
    { rowNumber: 2, reason: 'Scheduled Date con valor' },
    { rowNumber: 3, reason: 'estado: SKIP' },
  ]);
  assert.deepEqual(result.eligible, []);
});

test('D-03 (AC-31): sin columna Scheduled Date la fila es elegible', () => {
  const ctx = loadAppsScript();
  const result = classify(ctx, HEADER_ROW_NO_SCHEDULED, [
    { values: ['alpha@example.test', 'Alpha', 'REF-1', '', ''] },
  ]);
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(result.eligible, [{ rowNumber: 2, values: ['alpha@example.test', 'Alpha', 'REF-1', '', ''] }]);
});

test('AC-10: una fila totalmente vacía no aparece en ninguna lista y suma a blankRows', () => {
  const ctx = loadAppsScript();
  const result = classify(ctx, HEADER_ROW, [
    row(''),
    { values: ['', '', '', '', '', ''] },
    { values: ['', ' ', '', '', '', ''] },
    { values: ['beta@example.test', 'Beta', 'REF-2', '', '', ''] },
  ]);
  assert.equal(result.blankRows, 2);
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(
    result.eligible.map((r) => r.rowNumber),
    [2, 5]
  );
});

test('AC-13: isValidEmail_ acepta una dirección simple', () => {
  const ctx = loadAppsScript();
  assert.equal(ctx.isValidEmail_('alpha@example.test'), true);
});

test('AC-13: isValidEmail_ rechaza direcciones inválidas o múltiples', () => {
  const ctx = loadAppsScript();
  const invalid = [
    '',
    'a b@example.test',
    'a@example.test, b@example.test',
    'a@example.test;b@x.test',
    '<a@example.test>',
    '"a"@example.test',
    'alpha@example.test\r\nBcc: x@example.test',
    'alpha@',
    'alpha@example',
    'alpha',
    'a'.repeat(250) + '@example.test',
    null,
    undefined,
  ];
  for (const value of invalid) {
    assert.equal(ctx.isValidEmail_(value), false, `debería rechazar ${JSON.stringify(value)}`);
  }
});

test('D-14: rowKey_ es igual para valores iguales y distinto si cambia una celda', () => {
  const ctx = loadAppsScript();
  const a = ctx.rowKey_(['alpha@example.test', 'Alpha', '']);
  const b = ctx.rowKey_(['alpha@example.test', 'Alpha', '']);
  const c = ctx.rowKey_(['alpha@example.test', 'Alfa', '']);
  assert.equal(typeof a, 'string');
  assert.equal(a, b);
  assert.notEqual(a, c);
});
