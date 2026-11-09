'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, getConst, plain } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const { createCampaignFixture, createLegacyFixture, CAMPAIGN_SHEET_ID } = require('./fixtures/campaign');

const LOCK_MESSAGE = 'Hay otra ejecución en curso; reintentá en unos minutos';
const CHANGED_MESSAGE = 'La fila de encabezados cambió; volvé a validar';
const RETRY_MESSAGE =
  'No se pudieron preparar todas las columnas; revisá la fila 1 y volvé a intentar (la operación se puede repetir)';
const V2_HEADERS = [
  'Email Address',
  'First Name',
  'Reference',
  'File Attachments',
  'Resultado',
  'Fecha',
  'Campaña',
  'Detalle',
];

function campaignSheet(fixture) {
  return fixture.sheets.find((sheet) => sheet.id === CAMPAIGN_SHEET_ID);
}

// Reemplaza la pestaña de la campaña por encabezados y filas propios. Cada
// fila es un array de valores o `{ values, hidden }`.
function customFixture(headers, rows = []) {
  const fixture = createCampaignFixture();
  const sheet = campaignSheet(fixture);
  sheet.values = [headers.slice()];
  sheet.hiddenByUser = [false];
  sheet.hiddenByFilter = [false];
  for (const row of rows) {
    const values = Array.isArray(row) ? row : row.values;
    sheet.values.push(values.slice());
    sheet.hiddenByUser.push(Boolean(row.hidden));
    sheet.hiddenByFilter.push(false);
  }
  return fixture;
}

// Plan de columnas calculado sobre el estado actual de la pestaña.
function planOf(ctx, fixture) {
  const sheet = campaignSheet(fixture);
  return plain(
    ctx.planColumnSetup_({
      values: sheet.values.map((row) => row.slice()),
      hiddenByUser: sheet.hiddenByUser.slice(),
      hiddenByFilter: sheet.hiddenByFilter.slice(),
    })
  );
}

// Una ejecución de "Preparar columnas" con un falso nuevo sobre el fixture,
// usando la clave de encabezados que vería el operador al validar.
function runSetup(ctx, fixture, options = {}, headerKey) {
  const fake = createFakeDeps(fixture, options);
  const key = headerKey === undefined ? planOf(ctx, fixture).headerKey : headerKey;
  const result = plain(ctx.applyColumnSetup_(fake.deps, key));
  return { fake, result };
}

function headers(fixture) {
  return campaignSheet(fixture).values[0].slice();
}

function assertBlocked(ctx, fixture, pattern) {
  const plan = planOf(ctx, fixture);
  assert.equal(plan.needed, true);
  assert.deepEqual(plan.renames, []);
  assert.deepEqual(plan.appends, []);
  assert.ok(
    plan.errors.some((error) => pattern.test(error)),
    'ningún error coincide con ' + pattern + ': ' + JSON.stringify(plan.errors)
  );
  const before = JSON.stringify(campaignSheet(fixture).values);
  const { fake, result } = runSetup(ctx, fixture);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, plan.errors);
  assert.deepEqual(fake.calls.headerWrites, []);
  assert.equal(JSON.stringify(campaignSheet(fixture).values), before);
  return { plan, result };
}

test('AC-42 / D-33: la migración V1 renombra en el lugar, agrega Campaña y Detalle y no toca los datos', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  const dataBefore = campaignSheet(fixture).values.slice(1).map((row) => row.slice());

  const plan = planOf(ctx, fixture);
  assert.equal(plan.needed, true);
  assert.equal(plan.headerKey, JSON.stringify(headers(fixture)));
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.blockedRows, []);

  const { fake, result } = runSetup(ctx, fixture);

  assert.deepEqual(result, {
    ok: true,
    errors: [],
    applied: {
      renames: [
        { column: 4, from: 'Mail Merge Status', to: 'Resultado' },
        { column: 5, from: 'Scheduled Date', to: 'Fecha' },
      ],
      appends: [
        { column: 6, name: 'Campaña' },
        { column: 7, name: 'Detalle' },
      ],
    },
  });
  assert.deepEqual(headers(fixture), V2_HEADERS);
  const dataAfter = campaignSheet(fixture).values.slice(1);
  assert.equal(dataAfter.length, dataBefore.length);
  dataAfter.forEach((row, i) => {
    assert.deepEqual(row.slice(0, 6), dataBefore[i]);
    assert.deepEqual(row.slice(6), ['', '']);
  });
  assert.equal(ctx.mapHeaders_(headers(fixture)).ok, true);
  assert.deepEqual(
    fake.calls.headerWrites.map((write) => [write.column, write.value]),
    [
      [4, 'Resultado'],
      [5, 'Fecha'],
      [6, 'Campaña'],
      [7, 'Detalle'],
    ]
  );
});

test('AC-42 / D-33: con una celda de datos sin encabezado a la derecha, las columnas nuevas van después de ella', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  const sheet = campaignSheet(fixture);
  sheet.values[2].push('', 'nota del operador');

  const { result } = runSetup(ctx, fixture);

  assert.equal(result.ok, true);
  assert.deepEqual(result.applied.appends, [
    { column: 8, name: 'Campaña' },
    { column: 9, name: 'Detalle' },
  ]);
  assert.deepEqual(headers(fixture), [
    'Email Address',
    'First Name',
    'Reference',
    'File Attachments',
    'Resultado',
    'Fecha',
    '',
    '',
    'Campaña',
    'Detalle',
  ]);
  assert.equal(sheet.values[2][7], 'nota del operador');
});

test('D-33: una hoja V2 completa no necesita preparación (needed: false) y no escribe', () => {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();

  const plan = planOf(ctx, fixture);
  assert.deepEqual(plan, {
    needed: false,
    headerKey: JSON.stringify(headers(fixture)),
    renames: [],
    appends: [],
    errors: [],
    blockedRows: [],
  });

  const { fake, result } = runSetup(ctx, fixture);
  assert.deepEqual(result, { ok: true, errors: [], applied: { renames: [], appends: [] } });
  assert.deepEqual(fake.calls.headerWrites, []);
});

test('D-33: encabezados duplicados o ambiguos se devuelven como errores sin proponer escrituras', () => {
  const ctx = loadAppsScript();

  assertBlocked(ctx, customFixture(['Email Address', 'resultado', 'Mail Merge Status']), /ambiguo/);
  assertBlocked(
    ctx,
    customFixture(['Email Address', 'Mail Merge Status', 'Scheduled Date', 'Mail Merge Status']),
    /más de una vez/
  );
});

test('AC-43 / D-34 (a): conviven un encabezado heredado y su reemplazo → cero escrituras', () => {
  const ctx = loadAppsScript();

  assertBlocked(
    ctx,
    customFixture(['Email Address', 'Mail Merge Status', 'Resultado'], [['a@example.test', '', '']]),
    /"Mail Merge Status" y "Resultado"/
  );
  assertBlocked(
    ctx,
    customFixture(['Email Address', 'Resultado', 'Scheduled Date', 'Fecha'], [['a@example.test', '', '', '']]),
    /"Scheduled Date" y "Fecha"/
  );
});

test('AC-43 / D-34 (b): hoja V1 con una columna Campaña preexistente → cero escrituras', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  const sheet = campaignSheet(fixture);
  sheet.values.forEach((row, i) => row.push(i === 0 ? 'Campaña' : 'propia'));

  assertBlocked(ctx, fixture, /"Campaña"/);
});

test('AC-43 / D-34 (c): Scheduled Date con valor y estado vacío (también oculta) bloquea y lista las filas', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  const sheet = campaignSheet(fixture);
  sheet.values[1][5] = '2026-12-01';
  sheet.values[2][5] = '2026-12-02';
  sheet.hiddenByUser[2] = true;

  const { plan } = assertBlocked(ctx, fixture, /Scheduled Date/);

  assert.deepEqual(plan.blockedRows, [2, 3]);
  const error = plan.errors.find((item) => /Scheduled Date/.test(item));
  assert.match(error, /filas 2, 3/);
  assert.match(error, /"Mail Merge Status"/);
  assert.match(error, /SKIP/);
});

test('AC-43 / D-34 (c): con más de 20 filas bloqueadas el error lista 20 y "y N filas más"', () => {
  const ctx = loadAppsScript();
  const rows = [];
  for (let i = 0; i < 25; i++) {
    rows.push(['r' + i + '@example.test', '', '2026-12-01']);
  }
  const fixture = customFixture(['Email Address', 'Mail Merge Status', 'Scheduled Date'], rows);

  const { plan } = assertBlocked(ctx, fixture, /y 5 filas más/);

  assert.equal(plan.blockedRows.length, 25);
  assert.deepEqual(plan.blockedRows.slice(0, 3), [2, 3, 4]);
  const error = plan.errors.find((item) => /filas más/.test(item));
  assert.match(error, /2, 3, 4, .*, 21 y 5 filas más/);
  assert.doesNotMatch(error, /\b22\b/);
});

test('AC-43 / D-34 (d): sin heredadas ni Resultado, con Fecha o Detalle propia → cero escrituras', () => {
  const ctx = loadAppsScript();

  assertBlocked(
    ctx,
    customFixture(['Email Address', 'First Name', 'Fecha'], [['a@example.test', 'Ana', '']]),
    /"Fecha"/
  );
  assertBlocked(
    ctx,
    customFixture(['Email Address', 'First Name', 'Fecha'], [['a@example.test', 'Ana', '2026-12-01']]),
    /"Fecha"/
  );
  assertBlocked(
    ctx,
    customFixture(['Email Address', 'Detalle'], [['a@example.test', 'nota']]),
    /"Detalle"/
  );
});

test('AC-43 / D-34 (e): Fecha propia con valor en filas con Resultado vacío (visible y oculta) → error con la columna y las filas', () => {
  const ctx = loadAppsScript();
  const fixture = customFixture(
    ['Email Address', 'Resultado', 'Fecha'],
    [
      ['a@example.test', '', '2026-12-01'],
      { values: ['b@example.test', '', '2026-12-02'], hidden: true },
      ['c@example.test', 'Email Sent', '2026-10-01'],
      ['d@example.test', '', ''],
    ]
  );

  const { plan } = assertBlocked(ctx, fixture, /"Fecha"/);

  assert.deepEqual(plan.blockedRows, [2, 3]);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /filas 2, 3/);
  assert.match(plan.errors[0], /"Resultado" vacío/);
});

test('AC-43: expectedHeaderKey distinto → mensaje de encabezados cambiados y cero escrituras', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();

  const { fake, result } = runSetup(ctx, fixture, {}, JSON.stringify(['otra', 'fila']));

  assert.deepEqual(result, { ok: false, errors: [CHANGED_MESSAGE], applied: { renames: [], appends: [] } });
  assert.deepEqual(fake.calls.headerWrites, []);
  assert.deepEqual(plain(fake.calls.lockCalls.map((call) => call.op)), ['tryLock', 'release']);
});

test('AC-43 / AC-53: lock no disponible → cero escrituras y el mensaje de otra ejecución en curso', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();

  const { fake, result } = runSetup(ctx, fixture, { lockAvailable: false });

  assert.deepEqual(result, { ok: false, errors: [LOCK_MESSAGE], applied: { renames: [], appends: [] } });
  assert.deepEqual(fake.calls.headerWrites, []);
  assert.deepEqual(plain(fake.calls.lockCalls), [{ op: 'tryLock', ms: getConst(ctx, 'LIMITS').LOCK_WAIT_MS }]);
});

test('AC-43 / D-34 (e): Detalle propia con valores solo en filas con Resultado no vacío no bloquea', () => {
  const ctx = loadAppsScript();
  const fixture = customFixture(
    ['Email Address', 'Resultado', 'Detalle'],
    [
      ['a@example.test', 'Email Sent', 'nota previa'],
      { values: ['b@example.test', 'SKIP', 'otra nota'], hidden: true },
      ['c@example.test', '', ''],
    ]
  );
  const detailsBefore = campaignSheet(fixture).values.map((row) => row[2]);

  const { result } = runSetup(ctx, fixture);

  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, {
    renames: [],
    appends: [
      { column: 3, name: 'Fecha' },
      { column: 4, name: 'Campaña' },
    ],
  });
  assert.deepEqual(headers(fixture), ['Email Address', 'Resultado', 'Detalle', 'Fecha', 'Campaña']);
  assert.deepEqual(
    campaignSheet(fixture).values.slice(1).map((row) => row[2]),
    detailsBefore.slice(1)
  );
});

test('AC-44: una segunda ejecución no cambia nada y devuelve ok', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  runSetup(ctx, fixture);
  const after = JSON.stringify(campaignSheet(fixture).values);

  const { fake, result } = runSetup(ctx, fixture);

  assert.deepEqual(result, { ok: true, errors: [], applied: { renames: [], appends: [] } });
  assert.deepEqual(fake.calls.headerWrites, []);
  assert.equal(JSON.stringify(campaignSheet(fixture).values), after);
});

test('AC-44: una falla después de Resultado invita a repetir y la reanudación completa desde Resultado + Scheduled Date', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();

  const first = runSetup(ctx, fixture, { failOn: { writeHeaderCells: { afterCells: 1 } } });

  assert.deepEqual(first.result, { ok: false, errors: [RETRY_MESSAGE], applied: { renames: [], appends: [] } });
  assert.deepEqual(plain(first.fake.calls.headerWrites), [{ sheetId: CAMPAIGN_SHEET_ID, column: 4, value: 'Resultado' }]);
  assert.deepEqual(headers(fixture), [
    'Email Address',
    'First Name',
    'Reference',
    'File Attachments',
    'Resultado',
    'Scheduled Date',
  ]);

  const second = runSetup(ctx, fixture);

  assert.equal(second.result.ok, true);
  assert.deepEqual(second.result.applied, {
    renames: [{ column: 5, from: 'Scheduled Date', to: 'Fecha' }],
    appends: [
      { column: 6, name: 'Campaña' },
      { column: 7, name: 'Detalle' },
    ],
  });
  assert.deepEqual(headers(fixture), V2_HEADERS);
});

test('AC-44 / D-34 (c): en el estado parcial Resultado + Scheduled Date, Scheduled Date con Resultado vacío bloquea', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  const sheet = campaignSheet(fixture);
  sheet.values[0][4] = 'Resultado';
  sheet.values[3][5] = '2026-12-03';

  const { plan } = assertBlocked(ctx, fixture, /Scheduled Date/);

  assert.deepEqual(plan.blockedRows, [4]);
  assert.match(plan.errors[0], /"Resultado"/);
});

test('AC-44 / D-34 (e): desde Resultado + Fecha renombrada con valores solo en filas con estado, la reanudación no bloquea', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  const sheet = campaignSheet(fixture);
  sheet.values[0][4] = 'Resultado';
  sheet.values[0][5] = 'Fecha';

  const { result } = runSetup(ctx, fixture);

  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, {
    renames: [],
    appends: [
      { column: 6, name: 'Campaña' },
      { column: 7, name: 'Detalle' },
    ],
  });
  assert.deepEqual(headers(fixture), V2_HEADERS);
});

test('AC-44: hoja solo con Email Address y variables → agrega Resultado, Fecha, Campaña y Detalle en ese orden', () => {
  const ctx = loadAppsScript();
  const fixture = customFixture(['Email Address', 'First Name'], [['a@example.test', 'Ana']]);

  const { fake, result } = runSetup(ctx, fixture);

  assert.equal(result.ok, true);
  assert.deepEqual(result.applied.appends, [
    { column: 2, name: 'Resultado' },
    { column: 3, name: 'Fecha' },
    { column: 4, name: 'Campaña' },
    { column: 5, name: 'Detalle' },
  ]);
  assert.deepEqual(
    fake.calls.headerWrites.map((write) => write.value),
    ['Resultado', 'Fecha', 'Campaña', 'Detalle']
  );
  assert.equal(ctx.mapHeaders_(headers(fixture)).ok, true);
});

test('AC-44 / D-34 (d): si falla después de Resultado en una hoja sin estado, la reanudación agrega las otras tres', () => {
  const ctx = loadAppsScript();
  const fixture = customFixture(['Email Address', 'First Name'], [['a@example.test', 'Ana']]);

  const first = runSetup(ctx, fixture, { failOn: { writeHeaderCells: { afterCells: 1 } } });

  assert.deepEqual(first.result.errors, [RETRY_MESSAGE]);
  assert.deepEqual(headers(fixture), ['Email Address', 'First Name', 'Resultado']);

  const second = runSetup(ctx, fixture);

  assert.equal(second.result.ok, true);
  assert.deepEqual(second.result.applied.appends, [
    { column: 3, name: 'Fecha' },
    { column: 4, name: 'Campaña' },
    { column: 5, name: 'Detalle' },
  ]);
  assert.deepEqual(headers(fixture), ['Email Address', 'First Name', 'Resultado', 'Fecha', 'Campaña', 'Detalle']);
});

test('AC-44 / D-33: con Scheduled Date y sin columna de estado, Resultado se escribe antes que Fecha y la reanudación no cae en (d)', () => {
  const ctx = loadAppsScript();
  const fixture = customFixture(['Email Address', 'Scheduled Date'], [['a@example.test', '']]);

  const full = runSetup(ctx, customFixture(['Email Address', 'Scheduled Date'], [['a@example.test', '']]));
  assert.equal(full.result.ok, true);
  assert.deepEqual(
    full.fake.calls.headerWrites.map((write) => [write.column, write.value]),
    [
      [2, 'Resultado'],
      [1, 'Fecha'],
      [3, 'Campaña'],
      [4, 'Detalle'],
    ]
  );

  const first = runSetup(ctx, fixture, { failOn: { writeHeaderCells: { afterCells: 1 } } });
  assert.deepEqual(first.result.errors, [RETRY_MESSAGE]);
  assert.deepEqual(headers(fixture), ['Email Address', 'Scheduled Date', 'Resultado']);

  const second = runSetup(ctx, fixture);
  assert.equal(second.result.ok, true);
  assert.deepEqual(headers(fixture), ['Email Address', 'Fecha', 'Resultado', 'Campaña', 'Detalle']);
  assert.equal(ctx.mapHeaders_(headers(fixture)).ok, true);
});

test('AC-53: si la pestaña configurada ya no existe, no escribe y libera el lock', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  fixture.config = Object.assign({}, fixture.config, { sheetId: 999999 });

  const { fake, result } = runSetup(ctx, fixture, {}, JSON.stringify(headers(fixture)));

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /ya no existe/);
  assert.deepEqual(fake.calls.headerWrites, []);
  assert.deepEqual(plain(fake.calls.lockCalls.map((call) => call.op)), ['tryLock', 'release']);
});

test('AC-53: applyColumnSetup_ toma el lock con LOCK_WAIT_MS y lo libera una vez, también si writeHeaderCells lanza', () => {
  const ctx = loadAppsScript();
  const waitMs = getConst(ctx, 'LIMITS').LOCK_WAIT_MS;

  const ok = runSetup(ctx, createLegacyFixture());
  assert.equal(ok.result.ok, true);
  assert.deepEqual(plain(ok.fake.calls.lockCalls), [{ op: 'tryLock', ms: waitMs }, { op: 'release' }]);

  const failing = runSetup(ctx, createLegacyFixture(), { failOn: { writeHeaderCells: { afterCells: 0 } } });
  assert.deepEqual(failing.result.errors, [RETRY_MESSAGE]);
  assert.deepEqual(failing.fake.calls.headerWrites, []);
  assert.deepEqual(plain(failing.fake.calls.lockCalls), [{ op: 'tryLock', ms: waitMs }, { op: 'release' }]);
});

test('AC-53: configuración incompleta → error sin llamadas al lock ni escrituras', () => {
  const ctx = loadAppsScript();
  const fixture = createLegacyFixture();
  fixture.config = { sheetId: null, draftId: '', from: '', replyTo: '' };

  const { fake, result } = runSetup(ctx, fixture, {}, JSON.stringify(headers(fixture)));

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /incompleta/);
  assert.deepEqual(fake.calls.lockCalls, []);
  assert.deepEqual(fake.calls.headerWrites, []);
});
