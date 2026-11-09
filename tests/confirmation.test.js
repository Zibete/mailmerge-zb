'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const { createCampaignFixture, buildRow, fileLink, DRIVE_IDS, USER_EMAIL } = require('./fixtures/campaign');

const CONF_PREFIX = 'MM_CONF_';
const PROG_PREFIX = 'MM_PROG_';
const FIRST_TOKEN = '00000000-0000-4000-8000-000000000001';
const UNKNOWN_TOKEN = '11111111-1111-4111-8111-111111111111';
const DEFAULT_NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const INVALID_MESSAGE = 'La confirmación venció o no es válida; volvé a revisar';
const EXPIRED_MESSAGE = 'La confirmación venció; volvé a revisar y confirmar';
const STORE_FAILED_MESSAGE = 'No se pudo guardar la confirmación; no se enviará nada';
const SNAPSHOT_KEYS = [
  'campaign',
  'config',
  'createdAt',
  'expiresAt',
  'kind',
  'overwriteRows',
  'rows',
  'templateDigest',
  'testTo',
  'userEmail',
  'v',
];

function sha256(text) {
  return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function setup(options, ctxSetup) {
  const ctx = loadAppsScript();
  if (ctxSetup) {
    vm.runInContext(ctxSetup, ctx);
  }
  const fixture = createCampaignFixture();
  const fake = createFakeDeps(fixture, options);
  return { ctx, fixture, fake };
}

function campaignValues(fixture) {
  return fixture.sheets.find((sheet) => sheet.id === fixture.campaignSheetId).values;
}

function storedSnapshot(fake, token) {
  const raw = fake.fixture.cache[CONF_PREFIX + token];
  return raw === undefined ? undefined : JSON.parse(raw);
}

// La preparación nunca envía, nunca escribe la hoja y nunca toma el lock.
function assertNoSheetEffects(fake) {
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.equal(fake.calls.headerWrites.length, 0);
  assert.equal(fake.calls.lockCalls.length, 0);
}

// Rechazo de la preparación: sin token, sin vista y sin tocar la caché.
function assertRejected(fake, result, pattern) {
  assert.equal(result.ok, false);
  assert.equal(result.token, '');
  assert.equal(result.view, null);
  assert.ok(result.errors.length > 0);
  if (pattern) {
    assert.match(result.errors.join(' | '), pattern);
  }
  assert.equal(fake.calls.cachePuts.length, 0);
  assert.equal(fake.calls.cacheRemoves.length, 0);
  assertNoSheetEffects(fake);
}

test('AC-34 / D-26 / D-27: prepareConfirmation_ send guarda un snapshot mínimo con TTL 600 y devuelve la vista', () => {
  const { ctx, fixture, fake } = setup();

  const result = ctx.prepareConfirmation_(fake.deps, 'send');

  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.errors), []);
  assert.equal(result.token, FIRST_TOKEN);
  assert.ok(ctx.isValidToken_(result.token));
  assert.equal(fake.calls.cachePuts.length, 1);
  const put = fake.calls.cachePuts[0];
  assert.equal(put.key, CONF_PREFIX + result.token);
  assert.equal(put.ttlSeconds, 600);

  const snapshot = JSON.parse(put.value);
  assert.deepEqual(Object.keys(snapshot).sort(), SNAPSHOT_KEYS);
  assert.equal(snapshot.v, 2);
  assert.equal(snapshot.kind, 'send');
  assert.equal(snapshot.userEmail, USER_EMAIL);
  assert.equal(snapshot.createdAt, DEFAULT_NOW);
  assert.equal(snapshot.expiresAt, snapshot.createdAt + 600000);
  assert.deepEqual(snapshot.config, plain(fake.deps.props.getConfig()));
  assert.equal(snapshot.campaign, 'camp0001');
  const report = ctx.buildPreflight_(fake.deps, fake.deps.props.getConfig());
  assert.equal(snapshot.templateDigest, sha256(report.templateKey));
  const columns = report.headers.columns;
  const values = campaignValues(fixture);
  assert.deepEqual(
    snapshot.rows,
    [2, 3, 4].map((rowNumber) => [
      rowNumber,
      sha256(ctx.rowKey_(values[rowNumber - 1], columns)),
      sha256(ctx.metaKey_(values[rowNumber - 1], columns)),
    ])
  );
  assert.deepEqual(snapshot.overwriteRows, []);
  assert.equal(snapshot.testTo, '');

  for (const forbidden of [
    'alpha@example.test',
    'beta@example.test',
    'gamma@example.test',
    'REF-001',
    'Alpha',
    'http',
    'drive.google.com',
    'docs.google.com',
    DRIVE_IDS.PDF_ALPHA,
  ]) {
    assert.equal(put.value.includes(forbidden), false, 'el snapshot no debe contener ' + forbidden);
  }
  assert.ok(put.value.includes(USER_EMAIL));

  assert.deepEqual(plain(result.view), {
    kind: 'send',
    campaign: 'camp0001',
    sheetName: 'Recipients',
    subject: 'Notice {{Reference}}',
    from: USER_EMAIL,
    replyTo: '',
    count: 3,
    commonAttachments: ['common-terms.pdf'],
    rows: [
      { rowNumber: 2, email: 'alpha@example.test', attachmentNames: ['alpha-notice.pdf', 'Alpha Letter'] },
      { rowNumber: 3, email: 'beta@example.test', attachmentNames: ['beta-notice.pdf'] },
      { rowNumber: 4, email: 'gamma@example.test', attachmentNames: [] },
    ],
    invalidCount: 0,
    excludedCount: 0,
    overwriteRows: [],
    consentRequired: false,
    consentText: '',
    warning: 'Se enviarán 3 correos reales. Esta acción no se puede deshacer.',
    expiresAtIso: '2026-11-09T12:10:00.000Z',
  });
  assertNoSheetEffects(fake);
});

test('AC-34: sin filas válidas → "No hay correos para enviar" sin cachePut', () => {
  const { ctx, fake } = setup();
  for (const rowNumber of [2, 3, 4]) {
    fake.setCell(rowNumber, 'Resultado', 'SKIP');
  }

  const result = ctx.prepareConfirmation_(fake.deps, 'send');

  assertRejected(fake, result);
  assert.deepEqual(plain(result.errors), ['No hay correos para enviar']);
});

test('AC-34: con errores globales → ok: false sin cachePut (send y test)', () => {
  const { ctx, fixture, fake } = setup();
  fixture.config.from = 'intruder@example.test';

  assertRejected(fake, ctx.prepareConfirmation_(fake.deps, 'send'), /remitente/);
  assertRejected(fake, ctx.prepareConfirmation_(fake.deps, 'test', 2), /remitente/);
});

test('prepareConfirmation_ con un kind desconocido → ok: false sin tocar la caché', () => {
  const { ctx, fake } = setup();

  assertRejected(fake, ctx.prepareConfirmation_(fake.deps, 'otro'));
  assertRejected(fake, ctx.prepareConfirmation_(fake.deps, undefined));
  assert.equal(fake.calls.cacheGets.length, 0);
});

test('AC-46 / D-39: nombre vacío → newCampaignId en la vista y el snapshot; dos preparaciones → IDs distintos', () => {
  const { ctx, fake } = setup();

  const first = ctx.prepareConfirmation_(fake.deps, 'send');
  const second = ctx.prepareConfirmation_(fake.deps, 'send');

  assert.equal(first.view.campaign, 'camp0001');
  assert.equal(storedSnapshot(fake, first.token).campaign, 'camp0001');
  assert.equal(second.view.campaign, 'camp0002');
  assert.equal(storedSnapshot(fake, second.token).campaign, 'camp0002');
  assert.notEqual(first.token, second.token);
});

test('AC-46 / D-39: con nombre de campaña se usa el nombre en la vista y el snapshot', () => {
  const { ctx, fixture, fake } = setup();
  fixture.config.campaignName = 'Aviso noviembre';

  const result = ctx.prepareConfirmation_(fake.deps, 'send');

  assert.equal(result.view.campaign, 'Aviso noviembre');
  const snapshot = storedSnapshot(fake, result.token);
  assert.equal(snapshot.campaign, 'Aviso noviembre');
  assert.equal(snapshot.config.campaignName, 'Aviso noviembre');
});

test('AC-46: una configuración V1 sin campaignName se prepara con un ID generado', () => {
  const { ctx, fixture, fake } = setup();
  delete fixture.config.campaignName;

  const result = ctx.prepareConfirmation_(fake.deps, 'send');

  assert.equal(result.ok, true);
  assert.equal(result.view.campaign, 'camp0001');
  assert.equal(storedSnapshot(fake, result.token).config.campaignName, '');
});

const TEST_REJECTIONS = [
  [
    'fila oculta',
    (fake) => {
      fake.fixture.sheets[0].hiddenByUser[2] = true;
    },
    3,
    /fila 3.*oculta por el usuario/,
  ],
  ['Resultado no vacío', (fake) => fake.setCell(3, 'Resultado', 'Email Sent'), 3, /fila 3.*resultado: Email Sent/],
  [
    'fila inválida (adjunto faltante)',
    (fake) => fake.setCell(3, 'File Attachments', fileLink(DRIVE_IDS.MISSING)),
    3,
    /fila 3.*No se pudo acceder al archivo adjunto/,
  ],
  ['fila 1', () => {}, 1, /entero, 2 o mayor/],
  ['fuera de rango', () => {}, 99, /no existe.*entre 2 y 4/],
  ['fila vacía', (fake) => fake.appendRow(buildRow({})), 5, /fila 5 está vacía/],
  ["texto no numérico 'abc'", () => {}, 'abc', /entero, 2 o mayor/],
  ['decimal 2.5', () => {}, 2.5, /entero, 2 o mayor/],
  ['negativo -3', () => {}, -3, /entero, 2 o mayor/],
  ['null', () => {}, null, /entero, 2 o mayor/],
];

for (const [name, mutate, rowNumber, pattern] of TEST_REJECTIONS) {
  test('AC-48: la prueba se rechaza sin cachePut: ' + name, () => {
    const { ctx, fake } = setup();
    mutate(fake);

    assertRejected(fake, ctx.prepareConfirmation_(fake.deps, 'test', rowNumber), pattern);
  });
}

test("AC-48: prepareConfirmation_ test acepta '2' igual que 2 (snapshot test con una fila y testTo propio)", () => {
  const numeric = setup();
  const text = setup();
  const padded = setup();

  const fromNumber = numeric.ctx.prepareConfirmation_(numeric.fake.deps, 'test', 2);
  const fromText = text.ctx.prepareConfirmation_(text.fake.deps, 'test', '2');
  const fromPadded = padded.ctx.prepareConfirmation_(padded.fake.deps, 'test', ' 2 ');

  assert.equal(fromText.ok, true);
  const snapshot = storedSnapshot(text.fake, fromText.token);
  assert.equal(snapshot.kind, 'test');
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0][0], 2);
  assert.equal(snapshot.testTo, USER_EMAIL);
  assert.deepEqual(snapshot, storedSnapshot(numeric.fake, fromNumber.token));
  assert.deepEqual(storedSnapshot(padded.fake, fromPadded.token), snapshot);

  assert.deepEqual(plain(fromText.view), plain(fromNumber.view));
  assert.equal(fromText.view.kind, 'test');
  assert.equal(fromText.view.to, USER_EMAIL);
  assert.equal(fromText.view.count, 1);
  assert.deepEqual(plain(fromText.view.rows), [
    { rowNumber: 2, email: 'alpha@example.test', attachmentNames: ['alpha-notice.pdf', 'Alpha Letter'] },
  ]);
  assert.equal(
    fromText.view.warning,
    'Se enviará 1 correo a tu cuenta (operator@example.test) con el asunto precedido por [PRUEBA]. ' +
      'La fila 2 quedará con Resultado = Email Sent y no se enviará al destinatario real hasta que borres ese resultado.'
  );
  assertNoSheetEffects(text.fake);
});

test('AC-49 / D-41: más filas válidas que MAX_CONFIRM_ROWS → mensaje de tandas sin cachePut', () => {
  const { ctx, fake } = setup(undefined, 'LIMITS.MAX_CONFIRM_ROWS = 2');

  const result = ctx.prepareConfirmation_(fake.deps, 'send');

  assertRejected(fake, result);
  assert.deepEqual(plain(result.errors), [
    'Hay 3 filas para enviar y el máximo por confirmación es 2. Usá un filtro para enviar por tandas',
  ]);
});

test('AC-49 / D-41: un snapshot por encima de MAX_CACHE_VALUE_BYTES → ok: false sin cachePut', () => {
  const { ctx, fake } = setup(undefined, 'LIMITS.MAX_CACHE_VALUE_BYTES = 100');

  assertRejected(fake, ctx.prepareConfirmation_(fake.deps, 'send'));
});

test('AC-49 / D-41: cache.put que lanza → "No se pudo guardar la confirmación; no se enviará nada"', () => {
  const { ctx, fake } = setup({ failOn: { cachePut: true } });

  const result = ctx.prepareConfirmation_(fake.deps, 'send');

  assert.equal(result.ok, false);
  assert.equal(result.token, '');
  assert.equal(result.view, null);
  assert.deepEqual(plain(result.errors), [STORE_FAILED_MESSAGE]);
  assert.equal(fake.calls.cachePuts.length, 0);
  assertNoSheetEffects(fake);
});

test('AC-35: takeConfirmation_ con token undefined o "abc" rechaza sin acceder a la caché', () => {
  const { ctx, fake } = setup();

  for (const token of [undefined, 'abc', '', 42, null]) {
    const taken = ctx.takeConfirmation_(fake.deps, token, 'send');
    assert.equal(taken.ok, false);
    assert.equal(taken.snapshot, null);
    assert.equal(taken.error, INVALID_MESSAGE);
  }
  assert.equal(fake.calls.cacheGets.length, 0);
  assert.equal(fake.calls.cacheRemoves.length, 0);
});

test('AC-35: takeConfirmation_ con un UUID desconocido o desalojado → "La confirmación venció o no es válida"', () => {
  const { ctx, fake } = setup();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  fake.evict(CONF_PREFIX + prepared.token);

  for (const token of [UNKNOWN_TOKEN, prepared.token]) {
    const taken = ctx.takeConfirmation_(fake.deps, token, 'send');
    assert.equal(taken.ok, false);
    assert.equal(taken.error, INVALID_MESSAGE);
  }
  assert.deepEqual(fake.calls.cacheGets, [CONF_PREFIX + UNKNOWN_TOKEN, CONF_PREFIX + prepared.token]);
});

// Prepara una confirmación, altera su contenido en la caché y verifica que
// `takeConfirmation_` la rechace y borre la entrada.
function assertTamperedRejected(kind, rowNumber, tamper, expectedError, takeKind) {
  const { ctx, fake } = setup();
  const prepared = ctx.prepareConfirmation_(fake.deps, kind, rowNumber);
  assert.equal(prepared.ok, true);
  const key = CONF_PREFIX + prepared.token;
  const raw = fake.fixture.cache[key];
  const replaced = tamper(raw, JSON.parse(raw));
  if (replaced !== undefined) {
    fake.setCacheValue(key, typeof replaced === 'string' ? replaced : JSON.stringify(replaced));
  }

  const taken = ctx.takeConfirmation_(fake.deps, prepared.token, takeKind || kind);

  assert.equal(taken.ok, false);
  assert.equal(taken.snapshot, null);
  assert.equal(taken.error, expectedError);
  assert.equal(Object.prototype.hasOwnProperty.call(fake.fixture.cache, key), false, 'la entrada debe borrarse');
  assert.deepEqual(fake.calls.cacheRemoves, [key]);
}

const TAMPERED = [
  ['JSON truncado', 'send', undefined, (raw) => raw.slice(0, 20), INVALID_MESSAGE],
  ['v: 1', 'send', undefined, (raw, s) => ({ ...s, v: 1 }), INVALID_MESSAGE],
  ['rows vacío', 'send', undefined, (raw, s) => ({ ...s, rows: [] }), INVALID_MESSAGE],
  ['rows desordenado', 'send', undefined, (raw, s) => ({ ...s, rows: s.rows.slice().reverse() }), INVALID_MESSAGE],
  ['rows con una fila repetida', 'send', undefined, (raw, s) => ({ ...s, rows: [s.rows[0], s.rows[0]] }), INVALID_MESSAGE],
  [
    'test con dos filas',
    'test',
    2,
    (raw, s) => ({ ...s, rows: [s.rows[0], [3, s.rows[0][1], s.rows[0][2]]] }),
    INVALID_MESSAGE,
  ],
  ['test con testTo vacío', 'test', 2, (raw, s) => ({ ...s, testTo: '' }), INVALID_MESSAGE],
  ['sin templateDigest', 'send', undefined, (raw, s) => ({ ...s, templateDigest: undefined }), INVALID_MESSAGE],
  ['sin config', 'send', undefined, (raw, s) => ({ ...s, config: null }), INVALID_MESSAGE],
  [
    'una fila de dos elementos',
    'send',
    undefined,
    (raw, s) => ({ ...s, rows: [s.rows[0].slice(0, 2), s.rows[1], s.rows[2]] }),
    INVALID_MESSAGE,
  ],
  [
    'un metaDigest que no es hex de 64',
    'send',
    undefined,
    (raw, s) => ({ ...s, rows: [[s.rows[0][0], s.rows[0][1], 'no-es-hex'], s.rows[1], s.rows[2]] }),
    INVALID_MESSAGE,
  ],
  [
    'un número de fila no entero',
    'send',
    undefined,
    (raw, s) => ({ ...s, rows: [[2.5, s.rows[0][1], s.rows[0][2]], s.rows[1], s.rows[2]] }),
    INVALID_MESSAGE,
  ],
  [
    'overwriteRows con una fila que no está en rows',
    'send',
    undefined,
    (raw, s) => ({ ...s, overwriteRows: [{ rowNumber: 9, columns: ['Fecha'] }] }),
    INVALID_MESSAGE,
  ],
  ['overwriteRows que no es un arreglo', 'send', undefined, (raw, s) => ({ ...s, overwriteRows: {} }), INVALID_MESSAGE],
];

for (const [name, kind, rowNumber, tamper, expectedError] of TAMPERED) {
  test('AC-35: takeConfirmation_ rechaza y borra un snapshot con ' + name, () => {
    assertTamperedRejected(kind, rowNumber, tamper, expectedError);
  });
}

test('AC-35: takeConfirmation_ rechaza y borra un snapshot de otro kind', () => {
  assertTamperedRejected('send', undefined, () => undefined, 'La confirmación no corresponde a esta operación; volvé a revisar', 'test');
});

test('AC-35: takeConfirmation_ rechaza y borra un snapshot de otra cuenta (mismo fixture)', () => {
  const { ctx, fixture, fake } = setup();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const other = createFakeDeps(fixture, { userEmail: 'otra@example.test' });
  const key = CONF_PREFIX + prepared.token;

  const taken = ctx.takeConfirmation_(other.deps, prepared.token, 'send');

  assert.equal(taken.ok, false);
  assert.equal(taken.error, 'La confirmación pertenece a otra cuenta; volvé a revisar');
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.cache, key), false);
  assert.deepEqual(other.calls.cacheRemoves, [key]);
});

test('AC-35: takeConfirmation_ rechaza y borra un snapshot vencido', () => {
  const { ctx, fake } = setup();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const key = CONF_PREFIX + prepared.token;
  const snapshot = storedSnapshot(fake, prepared.token);

  fake.setNow(snapshot.expiresAt);
  const atExpiry = ctx.takeConfirmation_(fake.deps, prepared.token, 'send');
  assert.equal(atExpiry.ok, true, 'en el instante de vencimiento todavía es válida');

  const again = ctx.prepareConfirmation_(fake.deps, 'send');
  const againSnapshot = storedSnapshot(fake, again.token);
  fake.setNow(againSnapshot.expiresAt + 1);
  const expired = ctx.takeConfirmation_(fake.deps, again.token, 'send');

  assert.equal(expired.ok, false);
  assert.equal(expired.error, EXPIRED_MESSAGE);
  assert.equal(Object.prototype.hasOwnProperty.call(fake.fixture.cache, CONF_PREFIX + again.token), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fake.fixture.cache, key), false);
});

test('AC-36 / D-28: una toma válida devuelve el snapshot y borra la entrada; la segunda toma se rechaza', () => {
  const { ctx, fake } = setup();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const key = CONF_PREFIX + prepared.token;
  const stored = storedSnapshot(fake, prepared.token);

  const taken = ctx.takeConfirmation_(fake.deps, prepared.token, 'send');

  assert.equal(taken.ok, true);
  assert.equal(taken.error, '');
  assert.deepEqual(plain(taken.snapshot), stored);
  assert.equal(Object.prototype.hasOwnProperty.call(fake.fixture.cache, key), false);
  assert.deepEqual(fake.calls.cacheRemoves, [key]);

  const second = ctx.takeConfirmation_(fake.deps, prepared.token, 'send');
  assert.equal(second.ok, false);
  assert.equal(second.snapshot, null);
  assert.equal(second.error, INVALID_MESSAGE);
});

test('AC-36 / D-28: cache.remove que lanza al consumir → ok: false y sin snapshot', () => {
  const { ctx, fixture } = setup();
  const preparer = createFakeDeps(fixture);
  const prepared = ctx.prepareConfirmation_(preparer.deps, 'send');
  const failing = createFakeDeps(fixture, { failOn: { cacheRemove: true } });

  const taken = ctx.takeConfirmation_(failing.deps, prepared.token, 'send');

  assert.equal(taken.ok, false);
  assert.equal(taken.snapshot, null);
  assert.match(taken.error, /no se enviará nada/);
});

test('cancelConfirmation_ borra una entrada existente y devuelve { ok: true }', () => {
  const { ctx, fake } = setup();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const key = CONF_PREFIX + prepared.token;

  assert.deepEqual(plain(ctx.cancelConfirmation_(fake.deps, prepared.token)), { ok: true });
  assert.equal(Object.prototype.hasOwnProperty.call(fake.fixture.cache, key), false);
  assert.deepEqual(fake.calls.cacheRemoves, [key]);
  assert.equal(fake.calls.lockCalls.length, 0);
});

test('cancelConfirmation_ con un token desconocido o ya consumido → { ok: true }', () => {
  const { ctx, fake } = setup();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  ctx.takeConfirmation_(fake.deps, prepared.token, 'send');

  assert.deepEqual(plain(ctx.cancelConfirmation_(fake.deps, prepared.token)), { ok: true });
  assert.deepEqual(plain(ctx.cancelConfirmation_(fake.deps, UNKNOWN_TOKEN)), { ok: true });
});

test('cancelConfirmation_ con un token de formato inválido no accede a la caché', () => {
  const { ctx, fake } = setup();

  for (const token of [undefined, 'abc', '', null, 7]) {
    assert.deepEqual(plain(ctx.cancelConfirmation_(fake.deps, token)), { ok: true });
  }
  assert.equal(fake.calls.cacheGets.length, 0);
  assert.equal(fake.calls.cacheRemoves.length, 0);
});

test('isValidToken_ acepta solo UUID', () => {
  const ctx = loadAppsScript();
  assert.equal(ctx.isValidToken_(FIRST_TOKEN), true);
  assert.equal(ctx.isValidToken_('0123ABCD-4567-89EF-0123-456789ABCDEF'), true);
  for (const token of ['abc', '', undefined, null, 12, FIRST_TOKEN + 'x', ' ' + FIRST_TOKEN, 'MM_CONF_x']) {
    assert.equal(ctx.isValidToken_(token), false);
  }
});

test('AC-54 / D-47: un Campaña existente aparece en overwriteRows con consentimiento, en send y en test, sin el valor', () => {
  const consentText =
    'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 1 fila: fila 3 (Campaña)';
  for (const [kind, rowNumber] of [
    ['send', undefined],
    ['test', 3],
  ]) {
    const { ctx, fake } = setup();
    fake.setCell(3, 'Campaña', 'Anterior');

    const result = ctx.prepareConfirmation_(fake.deps, kind, rowNumber);

    assert.equal(result.ok, true, kind);
    assert.deepEqual(plain(result.view.overwriteRows), [{ rowNumber: 3, columns: ['Campaña'] }]);
    assert.equal(result.view.consentRequired, true);
    assert.equal(result.view.consentText, consentText);
    const raw = fake.fixture.cache[CONF_PREFIX + result.token];
    assert.deepEqual(JSON.parse(raw).overwriteRows, [{ rowNumber: 3, columns: ['Campaña'] }]);
    assert.equal(raw.includes('Anterior'), false);
    assert.equal(JSON.stringify(plain(result.view)).includes('Anterior'), false);
  }
});

test('AC-54 / D-47: la prueba sobre una fila sin metadatos no pide consentimiento', () => {
  const { ctx, fake } = setup();
  fake.setCell(3, 'Campaña', 'Anterior');

  const result = ctx.prepareConfirmation_(fake.deps, 'test', 2);

  assert.deepEqual(plain(result.view.overwriteRows), []);
  assert.equal(result.view.consentRequired, false);
  assert.equal(result.view.consentText, '');
  assert.deepEqual(storedSnapshot(fake, result.token).overwriteRows, []);
});

test('AC-55 / D-48: cada fila del snapshot es [fila, h, m]; cambiar Detalle cambia m y no h', () => {
  const base = setup();
  const changed = setup();
  changed.fake.setCell(3, 'Detalle', 'x');

  const baseResult = base.ctx.prepareConfirmation_(base.fake.deps, 'send');
  const changedResult = changed.ctx.prepareConfirmation_(changed.fake.deps, 'send');
  const baseRows = storedSnapshot(base.fake, baseResult.token).rows;
  const changedRows = storedSnapshot(changed.fake, changedResult.token).rows;

  const columns = base.ctx.mapHeaders_(campaignValues(changed.fixture)[0]).columns;
  changedRows.forEach((row) => {
    assert.equal(row.length, 3);
    assert.equal(row[2], sha256(changed.ctx.metaKey_(campaignValues(changed.fixture)[row[0] - 1], columns)));
  });
  assert.equal(changedRows[1][0], 3);
  assert.equal(changedRows[1][1], baseRows[1][1]);
  assert.notEqual(changedRows[1][2], baseRows[1][2]);
  assert.deepEqual(changedRows[0], baseRows[0]);
  assert.deepEqual(changedRows[2], baseRows[2]);
});

// Progreso de ejemplo tal como lo acumula el motor (con `recipient`).
function sampleProgress(patch = {}) {
  return {
    state: 'EN_CURSO',
    kind: 'send',
    campaign: 'camp0001',
    counts: { total: 3, processed: 2, sent: 1, skipped: 0, review: 1, pending: 1 },
    rows: [
      { rowNumber: 2, recipient: 'alpha@example.test', result: 'Email Sent', detail: 'Aceptado por Gmail' },
      {
        rowNumber: 3,
        recipient: 'beta@example.test',
        result: 'REVISAR',
        detail: 'Gmail lanzó una excepción (Invalid email: beta@example.test)',
      },
    ],
    rowsTruncated: false,
    stoppedReason: 'Se detuvo en la fila 3 (beta@example.test) por una excepción de Gmail',
    ...patch,
  };
}

test('AC-38 / D-29 / D-46: publishProgress_ publica en MM_PROG_<token> con TTL 1800, sin recipient y con direcciones redactadas', () => {
  const { ctx, fake } = setup();

  ctx.publishProgress_(fake.deps, FIRST_TOKEN, sampleProgress());

  assert.equal(fake.calls.cachePuts.length, 1);
  const put = fake.calls.cachePuts[0];
  assert.equal(put.key, PROG_PREFIX + FIRST_TOKEN);
  assert.equal(put.ttlSeconds, 1800);
  assert.equal(put.value.includes('@example.test'), false);
  assert.equal(put.value.includes('recipient'), false);
  const record = JSON.parse(put.value);
  assert.deepEqual(record, {
    state: 'EN_CURSO',
    kind: 'send',
    campaign: 'camp0001',
    counts: { total: 3, processed: 2, sent: 1, skipped: 0, review: 1, pending: 1 },
    rows: [
      { rowNumber: 2, result: 'Email Sent', detail: 'Aceptado por Gmail' },
      { rowNumber: 3, result: 'REVISAR', detail: 'Gmail lanzó una excepción (Invalid email: [dirección])' },
    ],
    rowsTruncated: false,
    stoppedReason: 'Se detuvo en la fila 3 ([dirección]) por una excepción de Gmail',
  });
  record.rows.forEach((row) => assert.deepEqual(Object.keys(row).sort(), ['detail', 'result', 'rowNumber']));
});

test('AC-38 / D-29: publishProgress_ nunca lanza aunque cache.put falle', () => {
  const { ctx, fake } = setup({ failOn: { cachePut: true } });

  assert.doesNotThrow(() => ctx.publishProgress_(fake.deps, FIRST_TOKEN, sampleProgress()));
  assert.doesNotThrow(() => ctx.publishProgress_(fake.deps, FIRST_TOKEN, null));
  assert.equal(fake.calls.cachePuts.length, 0);
});

test('AC-38 / D-38: publishProgress_ recorta detail a MAX_DETAIL_CHARS', () => {
  const { ctx, fake } = setup();

  ctx.publishProgress_(
    fake.deps,
    FIRST_TOKEN,
    sampleProgress({ rows: [{ rowNumber: 2, recipient: '', result: 'OMITIDA', detail: 'x'.repeat(1000) }] })
  );

  const record = JSON.parse(fake.calls.cachePuts[0].value);
  assert.equal(record.rows[0].detail, 'x'.repeat(300));
});

test('AC-38: con MAX_CACHE_VALUE_BYTES reducido publica dentro del límite, con contadores completos y las últimas filas', () => {
  const { ctx, fake } = setup(undefined, 'LIMITS.MAX_CACHE_VALUE_BYTES = 2000');
  const rows = [];
  for (let rowNumber = 2; rowNumber <= 51; rowNumber++) {
    rows.push({ rowNumber, recipient: 'r' + rowNumber + '@example.test', result: 'OMITIDA', detail: 'ñ'.repeat(300) });
  }
  const counts = { total: 50, processed: 50, sent: 0, skipped: 50, review: 0, pending: 0 };

  ctx.publishProgress_(fake.deps, FIRST_TOKEN, sampleProgress({ state: 'TERMINADO', counts, rows, stoppedReason: '' }));

  assert.equal(fake.calls.cachePuts.length, 1);
  const value = fake.calls.cachePuts[0].value;
  assert.ok(Buffer.byteLength(value, 'utf8') <= 2000, 'bytes: ' + Buffer.byteLength(value, 'utf8'));
  const record = JSON.parse(value);
  assert.equal(record.rowsTruncated, true);
  assert.deepEqual(record.counts, counts);
  assert.equal(record.state, 'TERMINADO');
  assert.ok(record.rows.length >= 1 && record.rows.length < 50);
  assert.equal(record.rows[record.rows.length - 1].rowNumber, 51);
  record.rows.forEach((row, index) => {
    assert.equal(row.rowNumber, 52 - record.rows.length + index);
  });
});

test('AC-38: readProgress_ → found: false antes de publicar, el registro después y sin caché con un token inválido', () => {
  const { ctx, fake } = setup();

  assert.deepEqual(plain(ctx.readProgress_(fake.deps, FIRST_TOKEN)), { found: false, progress: null });
  ctx.publishProgress_(fake.deps, FIRST_TOKEN, sampleProgress());
  const read = ctx.readProgress_(fake.deps, FIRST_TOKEN);
  assert.equal(read.found, true);
  assert.deepEqual(plain(read.progress), JSON.parse(fake.calls.cachePuts[0].value));

  const getsBefore = fake.calls.cacheGets.length;
  for (const token of [undefined, 'abc', '']) {
    assert.deepEqual(plain(ctx.readProgress_(fake.deps, token)), { found: false, progress: null });
  }
  assert.equal(fake.calls.cacheGets.length, getsBefore);
});
