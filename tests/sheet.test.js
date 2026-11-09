'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');

// Encabezados V2 (D-31): Email Address, dos variables, File Attachments y las
// cuatro columnas gestionadas.
const HEADER_ROW = [
  'Email Address',
  'First Name',
  'Reference',
  'File Attachments',
  'Fecha',
  'Campaña',
  'Resultado',
  'Detalle',
];
const COLUMNS = { email: 0, attachments: 3, date: 4, campaign: 5, result: 6, detail: 7 };
const LEGACY_ERROR = 'La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"';
const MANAGED = ['Fecha', 'Campaña', 'Resultado', 'Detalle'];

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

// Fila de datos en el orden de `HEADER_ROW`, con `Resultado` dado.
function row(result, extra = {}) {
  const date = extra.date || '';
  return {
    values: ['alpha@example.test', 'Alpha', 'REF-1', '', date, '', result, ''],
    ...extra,
  };
}

function classify(ctx, headerRow, rows) {
  const mapped = ctx.mapHeaders_(headerRow);
  assert.equal(mapped.ok, true);
  return plain(ctx.classifyRows_(sheetData(headerRow, rows), mapped.columns));
}

test('AC-12 / D-31: mapHeaders_ acepta los encabezados V2 completos con los seis índices', () => {
  const ctx = loadAppsScript();
  const result = plain(ctx.mapHeaders_(HEADER_ROW));
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.columns, COLUMNS);
  assert.deepEqual(result.legacy, { status: -1, scheduled: -1 });
  assert.equal(result.byName['Resultado'], 6);
  assert.equal(result.byName['First Name'], 1);
});

test('AC-12: mapHeaders_ rechaza un encabezado duplicado', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email Address', 'First Name', 'First Name', ...MANAGED]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.match(result.errors.join('\n'), /First Name/);
});

test('AC-12: mapHeaders_ rechaza un duplicado normalizado (First Name / first  name)', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email Address', 'First Name', 'first  name', ...MANAGED]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('AC-12: mapHeaders_ rechaza la falta de Email Address', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['First Name', ...MANAGED]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Email Address/);
});

test('AC-12 / D-31: mapHeaders_ rechaza la falta de cada columna gestionada y la nombra', () => {
  const ctx = loadAppsScript();
  for (const missing of MANAGED) {
    const headers = ['Email Address', 'First Name', ...MANAGED.filter((name) => name !== missing)];
    const result = ctx.mapHeaders_(headers);
    assert.equal(result.ok, false, `debería rechazar la falta de ${missing}`);
    assert.ok(
      result.errors.some((error) => error.includes('"' + missing + '"')),
      `el error debería nombrar ${missing}: ${result.errors.join(' | ')}`
    );
  }
});

test('AC-12: mapHeaders_ rechaza resultado en minúsculas como ambiguo, sin informarlo como faltante', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email Address', 'First Name', 'Fecha', 'Campaña', 'resultado', 'Detalle']);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /"resultado" es ambiguo/);
  assert.equal(result.errors.some((error) => error.includes('Falta')), false);
});

test('AC-12: mapHeaders_ rechaza un encabezado requerido con otro espaciado interno (Email  Address)', () => {
  const ctx = loadAppsScript();
  const result = ctx.mapHeaders_(['Email  Address', 'First Name', ...MANAGED]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /ambiguo/);
});

test('AC-12: mapHeaders_ informa Campaña con la ñ descompuesta como ambigua, no como columna desconocida', () => {
  const ctx = loadAppsScript();
  const decomposed = 'Campa' + 'ñ' + 'a';
  assert.notEqual(decomposed, 'Campaña');
  const result = ctx.mapHeaders_(['Email Address', 'Fecha', decomposed, 'Resultado', 'Detalle']);
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  assert.match(text, /ambiguo/);
  assert.match(text, /"Campaña"/);
  assert.equal(result.errors.some((error) => error.includes('Falta')), false);
});

test('AC-12: mapHeaders_ acepta encabezados con espacios alrededor y celdas vacías', () => {
  const ctx = loadAppsScript();
  const result = plain(
    ctx.mapHeaders_([
      '  Email Address ',
      '',
      'First Name',
      ' File Attachments',
      'Fecha ',
      '',
      ' Campaña',
      'Resultado  ',
      'Detalle',
    ])
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.columns, { email: 0, attachments: 3, date: 4, campaign: 6, result: 7, detail: 8 });
  assert.deepEqual(result.byName, {
    'Email Address': 0,
    'First Name': 2,
    'File Attachments': 3,
    Fecha: 4,
    'Campaña': 6,
    Resultado: 7,
    Detalle: 8,
  });
});

test('AC-12: mapHeaders_ sin File Attachments marca esa columna como ausente (-1)', () => {
  const ctx = loadAppsScript();
  const result = plain(ctx.mapHeaders_(['Email Address', 'First Name', 'Resultado', 'Fecha', 'Campaña', 'Detalle']));
  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, { email: 0, attachments: -1, date: 3, campaign: 4, result: 2, detail: 5 });
});

test('D-31: mapHeaders_ con Mail Merge Status devuelve el error de encabezados heredados y su índice', () => {
  const ctx = loadAppsScript();
  const result = plain(
    ctx.mapHeaders_(['Email Address', 'First Name', 'File Attachments', 'Mail Merge Status', 'Scheduled Date'])
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes(LEGACY_ERROR), result.errors.join(' | '));
  assert.equal(result.errors.filter((error) => error === LEGACY_ERROR).length, 1);
  assert.deepEqual(result.legacy, { status: 3, scheduled: 4 });
});

test('D-31: mapHeaders_ con solo Scheduled Date junto a las gestionadas también es un encabezado heredado', () => {
  const ctx = loadAppsScript();
  const result = plain(ctx.mapHeaders_([...HEADER_ROW, 'Scheduled Date']));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [LEGACY_ERROR]);
  assert.deepEqual(result.legacy, { status: -1, scheduled: 8 });
  assert.deepEqual(result.columns, COLUMNS);
});

test('D-31: mapHeaders_ informa una variante ambigua de un encabezado heredado (mail merge status)', () => {
  const ctx = loadAppsScript();
  const result = plain(ctx.mapHeaders_([...HEADER_ROW, 'mail merge status']));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /"Mail Merge Status"/);
  assert.match(result.errors.join('\n'), /ambiguo/);
});

test('AC-10 / D-31: filas con Resultado no vacío quedan excluidas con su motivo; Resultado vacío es elegible aunque Fecha tenga valor', () => {
  const ctx = loadAppsScript();
  const result = classify(ctx, HEADER_ROW, [
    row('SKIP'),
    row('Email Sent'),
    row('ENVIANDO'),
    row('REVISAR'),
    row('2026-01-01'),
    row('', { date: '2026-12-01' }),
  ]);
  assert.deepEqual(result.excluded, [
    { rowNumber: 2, reason: 'resultado: SKIP' },
    { rowNumber: 3, reason: 'resultado: Email Sent' },
    { rowNumber: 4, reason: 'resultado: ENVIANDO' },
    { rowNumber: 5, reason: 'resultado: REVISAR' },
    { rowNumber: 6, reason: 'resultado: 2026-01-01' },
  ]);
  assert.deepEqual(result.eligible, [
    {
      rowNumber: 7,
      values: ['alpha@example.test', 'Alpha', 'REF-1', '', '2026-12-01', '', '', ''],
    },
  ]);
  assert.equal(result.blankRows, 0);
});

test('AC-11: filas ocultas por el usuario o por un filtro quedan excluidas aun con Resultado vacío', () => {
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

test('AC-11: una fila totalmente vacía no aparece en ninguna lista y suma a blankRows; la primera fila de datos es la 2', () => {
  const ctx = loadAppsScript();
  const result = classify(ctx, HEADER_ROW, [
    row(''),
    { values: ['', '', '', '', '', '', '', ''] },
    { values: ['', ' ', '', '', '', '', '', ''] },
    { values: ['beta@example.test', 'Beta', 'REF-2', '', '', '', '', ''] },
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

// Valores de una fila completa en el orden de `HEADER_ROW`.
const BASE_VALUES = ['alpha@example.test', 'Alpha', 'REF-1', '', '', '', '', ''];

function withValue(index, value) {
  const copy = BASE_VALUES.slice();
  copy[index] = value;
  return copy;
}

test('AC-50 / D-36: rowKey_ no cambia si cambian Fecha, Campaña o Detalle', () => {
  const ctx = loadAppsScript();
  const base = ctx.rowKey_(BASE_VALUES, COLUMNS);
  assert.equal(typeof base, 'string');
  assert.equal(ctx.rowKey_(BASE_VALUES.slice(), COLUMNS), base);
  assert.equal(ctx.rowKey_(withValue(COLUMNS.date, '9/11/2026 10:00:00'), COLUMNS), base);
  assert.equal(ctx.rowKey_(withValue(COLUMNS.campaign, 'Campaña de prueba'), COLUMNS), base);
  assert.equal(ctx.rowKey_(withValue(COLUMNS.detail, 'Envío iniciado'), COLUMNS), base);
});

test('AC-50 / D-36: rowKey_ cambia si cambia Resultado u otra columna', () => {
  const ctx = loadAppsScript();
  const base = ctx.rowKey_(BASE_VALUES, COLUMNS);
  assert.notEqual(ctx.rowKey_(withValue(COLUMNS.result, 'ENVIANDO'), COLUMNS), base);
  assert.notEqual(ctx.rowKey_(withValue(1, 'Alfa'), COLUMNS), base);
  assert.notEqual(ctx.rowKey_(withValue(COLUMNS.email, 'beta@example.test'), COLUMNS), base);
  assert.notEqual(ctx.rowKey_(withValue(COLUMNS.attachments, 'https://drive.google.com/x'), COLUMNS), base);
});

test('AC-50 / D-36: rowKey_ no muta el arreglo recibido', () => {
  const ctx = loadAppsScript();
  const values = ['alpha@example.test', 'Alpha', 'REF-1', '', 'fecha', 'campaña', '', 'detalle'];
  const before = values.slice();
  ctx.rowKey_(values, COLUMNS);
  assert.deepEqual(values, before);
});

test('AC-55 / D-48: metaKey_ cambia si cambian Fecha, Campaña o Detalle', () => {
  const ctx = loadAppsScript();
  const base = ctx.metaKey_(BASE_VALUES, COLUMNS);
  assert.equal(base, JSON.stringify(['', '', '']));
  assert.notEqual(ctx.metaKey_(withValue(COLUMNS.date, '9/11/2026'), COLUMNS), base);
  assert.notEqual(ctx.metaKey_(withValue(COLUMNS.campaign, 'abc12345'), COLUMNS), base);
  assert.notEqual(ctx.metaKey_(withValue(COLUMNS.detail, 'x'), COLUMNS), base);
  assert.equal(
    ctx.metaKey_(['a@example.test', 'A', 'R', '', 'f', 'c', '', 'd'], COLUMNS),
    JSON.stringify(['f', 'c', 'd'])
  );
});

test('AC-55 / D-48: metaKey_ no cambia si cambia cualquier otra columna, incluido Resultado', () => {
  const ctx = loadAppsScript();
  const base = ctx.metaKey_(BASE_VALUES, COLUMNS);
  assert.equal(ctx.metaKey_(withValue(COLUMNS.result, 'Email Sent'), COLUMNS), base);
  assert.equal(ctx.metaKey_(withValue(COLUMNS.email, 'beta@example.test'), COLUMNS), base);
  assert.equal(ctx.metaKey_(withValue(1, 'Alfa'), COLUMNS), base);
  assert.equal(ctx.metaKey_(withValue(COLUMNS.attachments, 'enlace'), COLUMNS), base);
});

test('AC-55 / D-48: metaKey_ usa una cadena vacía para una columna gestionada ausente o un valor ausente', () => {
  const ctx = loadAppsScript();
  const columns = { ...COLUMNS, campaign: -1 };
  const values = ['a@example.test', 'A', 'R', '', 'f', 'c', '', 'd'];
  assert.equal(ctx.metaKey_(values, columns), JSON.stringify(['f', '', 'd']));
  assert.equal(ctx.metaKey_(['a@example.test', 'A', 'R', '', 'f'], COLUMNS), JSON.stringify(['f', '', '']));
  assert.equal(ctx.metaKey_(['a', null, null, null, null, undefined, '', null], COLUMNS), JSON.stringify(['', '', '']));
});
