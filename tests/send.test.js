'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, getConst, plain, isDate } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const { createCampaignFixture, buildRow, fileLink, DRIVE_IDS, ALIAS_EMAIL } = require('./fixtures/campaign');

const LOCK_MESSAGE = 'Hay otra ejecución en curso; reintentá en unos minutos';
const CHANGED = 'Cambió después de la confirmación';
const INVALID_MESSAGE = 'La confirmación venció o no es válida; volvé a revisar';
const EXPIRED_MESSAGE = 'La confirmación venció; volvé a revisar y confirmar';
const WRONG_KIND_MESSAGE = 'La confirmación no corresponde a esta operación; volvé a revisar';
const WRONG_USER_MESSAGE = 'La confirmación pertenece a otra cuenta; volvé a revisar';
const CONSUME_FAILED_MESSAGE = 'No se pudo consumir la confirmación; no se enviará nada';
const CONSENT_MESSAGE = 'Falta el consentimiento para reemplazar Fecha, Campaña o Detalle; volvé a revisar y confirmar';
const META_CHANGED = 'Fecha, Campaña o Detalle cambiaron después de la confirmación; la fila no se modificó';
const CLAIM_DETAIL = 'Envío iniciado; si Resultado sigue en ENVIANDO, revisá la carpeta Enviados';
const ACCEPTED = 'Aceptado por Gmail';
const CONF_PREFIX = 'MM_CONF_';
const FIRST_TOKEN = '00000000-0000-4000-8000-000000000001';
const UNKNOWN_TOKEN = '11111111-1111-4111-8111-111111111111';
const DEFAULT_NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const EMAILS = { 2: 'alpha@example.test', 3: 'beta@example.test', 4: 'gamma@example.test' };
// Índices de las columnas gestionadas en el fixture V2.
const COL = { DATE: 4, CAMPAIGN: 5, RESULT: 6, DETAIL: 7 };
const RESULTS = ['Email Sent', 'OMITIDA', 'NO ENVIADA', 'ENVIANDO', 'REVISAR'];

function setup(options) {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();
  const fake = createFakeDeps(fixture, options);
  return { ctx, fixture, fake };
}

// Flujo completo V2: `prepareConfirmation_` (send) → mutación opcional entre
// fases → `executeConfirmed_`. Devuelve la preparación, la `SendResultView`
// (normalizada con `plain`) y el índice de `calls.sequence` donde empieza la
// ejecución.
function runSend(ctx, fake, between, overwriteConsent) {
  const prep = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
  if (between) {
    between(prep);
  }
  const start = fake.calls.sequence.length;
  const raw = ctx.executeConfirmed_(fake.deps, prep.token, 'send', overwriteConsent);
  assertJsonPlain(raw);
  return { prep, result: plain(raw), start };
}

// La `SendResultView` viaja por `google.script.run`: solo primitivos, arreglos
// y objetos planos (sin `Date`, `Map`, funciones ni `undefined`).
function assertJsonPlain(value, path = 'view') {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return;
  }
  assert.equal(typeof value, 'object', path + ' no es JSON plano');
  const tag = Object.prototype.toString.call(value);
  assert.ok(tag === '[object Object]' || tag === '[object Array]', path + ' es ' + tag);
  Object.keys(value).forEach((key) => assertJsonPlain(value[key], path + '.' + key));
}

function status(fake, rowNumber) {
  return fake.getCell(rowNumber, 'Resultado');
}

function sentTo(fake) {
  return fake.calls.sent.map((message) => message.to);
}

function resultsByRow(result) {
  return result.rows.map((row) => [row.rowNumber, row.result]);
}

function rowsWithResult(result, value) {
  return result.rows.filter((row) => row.result === value).map((row) => row.rowNumber);
}

function cellWriteRows(fake) {
  return fake.calls.cellWrites.map((write) => write.rowNumber);
}

// Resumen de `calls.sequence`: las escrituras de celdas quedan con el valor de
// `Resultado` que escriben.
function summarize(sequence) {
  return sequence.map((step) => {
    if (step.type === 'writeCells' || step.type === 'writeCells-failed') {
      const resultCell = step.cells.find((cell) => cell.column === COL.RESULT);
      return { type: step.type, rowNumber: step.rowNumber, result: resultCell ? resultCell.value : undefined };
    }
    if (step.type === 'send' || step.type === 'send-failed') {
      return { type: step.type, to: step.to };
    }
    return { type: step.type, key: step.key };
  });
}

function assertNothingSent(fake, result, message) {
  assert.equal(result.ok, false);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.equal(fake.calls.headerWrites.length, 0);
  assert.equal(result.counts.sent, 0);
  if (message) {
    assert.equal(result.stoppedReason, message);
    assert.ok(result.summaryLines.join('\n').includes(message));
  }
}

test('Camino feliz: consumo del token y por fila claim ENVIANDO → send → Email Sent, con el lock liberado una vez', () => {
  const { ctx, fake } = setup();
  const { prep, result, start } = runSend(ctx, fake);

  assert.equal(prep.ok, true);
  assert.equal(prep.token, FIRST_TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'send');
  assert.equal(result.campaign, 'camp0001');
  assert.equal(result.stoppedReason, '');
  assert.deepEqual(result.counts, { total: 3, processed: 3, sent: 3, skipped: 0, review: 0, pending: 0 });
  assert.deepEqual(result.rows, [
    { rowNumber: 2, recipient: EMAILS[2], result: 'Email Sent', detail: ACCEPTED },
    { rowNumber: 3, recipient: EMAILS[3], result: 'Email Sent', detail: ACCEPTED },
    { rowNumber: 4, recipient: EMAILS[4], result: 'Email Sent', detail: ACCEPTED },
  ]);

  assert.deepEqual(summarize(plain(fake.calls.sequence.slice(start))), [
    { type: 'cacheRemove', key: CONF_PREFIX + FIRST_TOKEN },
    { type: 'writeCells', rowNumber: 2, result: 'ENVIANDO' },
    { type: 'send', to: EMAILS[2] },
    { type: 'writeCells', rowNumber: 2, result: 'Email Sent' },
    { type: 'writeCells', rowNumber: 3, result: 'ENVIANDO' },
    { type: 'send', to: EMAILS[3] },
    { type: 'writeCells', rowNumber: 3, result: 'Email Sent' },
    { type: 'writeCells', rowNumber: 4, result: 'ENVIANDO' },
    { type: 'send', to: EMAILS[4] },
    { type: 'writeCells', rowNumber: 4, result: 'Email Sent' },
  ]);
  assert.deepEqual(plain(fake.calls.lockCalls), [{ op: 'tryLock', ms: 10000 }, { op: 'release' }]);
  for (const row of [2, 3, 4]) {
    assert.equal(status(fake, row), 'Email Sent');
  }
  // V2 no usa writeStatus ni el registro V1.
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);

  // El mensaje real es el de `buildMessage_` (asunto renderizado y adjuntos de la fila).
  assert.equal(fake.calls.sent[0].subject, 'Notice REF-001');
  assert.deepEqual(
    plain(fake.calls.sent[0].attachments).map((a) => a.name),
    ['common-terms.pdf', 'alpha-notice.pdf', 'Alpha Letter.pdf']
  );

  const text = result.summaryLines.join('\n');
  assert.match(text, /camp0001/);
  assert.match(text, /3 correos aceptados por Gmail/);
  assert.doesNotMatch(text, /entregad/i);
});

test('AC-40 / D-37: claim con Fecha, Campaña, Detalle y Resultado = ENVIANDO en ese orden; éxito con Detalle y luego Email Sent', () => {
  const { ctx, fake } = setup();
  runSend(ctx, fake);

  const writes = fake.calls.cellWrites;
  assert.equal(writes.length, 6);
  const claim = writes[0];
  assert.equal(claim.rowNumber, 2);
  assert.deepEqual(plain(claim.cells.map((cell) => cell.column)), [COL.DATE, COL.CAMPAIGN, COL.DETAIL, COL.RESULT]);
  assert.ok(isDate(claim.cells[0].value));
  assert.equal(claim.cells[0].value.getTime(), DEFAULT_NOW);
  assert.equal(claim.cells[1].value, 'camp0001');
  assert.equal(claim.cells[2].value, CLAIM_DETAIL);
  assert.equal(claim.cells[3].value, 'ENVIANDO');

  const success = plain(writes[1]);
  assert.deepEqual(success.cells, [
    { column: COL.DETAIL, value: ACCEPTED },
    { column: COL.RESULT, value: 'Email Sent' },
  ]);
  assert.equal(fake.getCell(2, 'Campaña'), 'camp0001');
  assert.equal(fake.getCell(2, 'Detalle'), ACCEPTED);
  assert.ok(isDate(fake.getCell(2, 'Fecha')));
});

test('AC-40 / D-37: excepción de Gmail escribe Detalle y luego REVISAR; fila omitida y claim fallido sin cellWrites', () => {
  // Fila 2 omitida (destinatario editado), fila 3 con excepción de Gmail.
  const failing = setup({ failOn: { send: (message) => message.to === EMAILS[3] } });
  const { result } = runSend(failing.ctx, failing.fake, () =>
    failing.fake.setCell(2, 'Email Address', 'other@example.test')
  );
  assert.deepEqual(resultsByRow(result), [
    [2, 'OMITIDA'],
    [3, 'REVISAR'],
  ]);
  assert.ok(!cellWriteRows(failing.fake).includes(2));
  const review = plain(failing.fake.calls.cellWrites).filter((write) => write.rowNumber === 3);
  assert.equal(review.length, 2);
  assert.deepEqual(
    review[1].cells.map((cell) => cell.column),
    [COL.DETAIL, COL.RESULT]
  );
  assert.equal(review[1].cells[1].value, 'REVISAR');
  assert.match(review[1].cells[0].value, /^Gmail lanzó una excepción \(/);
  assert.ok(review[1].cells[0].value.length <= getConst(failing.ctx, 'LIMITS').MAX_DETAIL_CHARS);
  assert.equal(failing.fake.getCell(3, 'Detalle'), review[1].cells[0].value);

  // Claim fallido sin escribir: ninguna escritura de esa fila.
  const claimFails = setup({ failOn: { writeCells: { value: 'ENVIANDO', rowNumber: 2 } } });
  runSend(claimFails.ctx, claimFails.fake);
  assert.equal(claimFails.fake.calls.cellWrites.length, 0);
  assert.equal(claimFails.fake.getCell(2, 'Detalle'), '');
  assert.equal(claimFails.fake.getCell(2, 'Campaña'), '');
});

test('AC-11: filas ocultas por el usuario o por un filtro no entran en la confirmación ni en el envío', () => {
  const { ctx, fixture, fake } = setup();
  fixture.sheets[0].hiddenByUser[2] = true; // fila 3
  fixture.sheets[0].hiddenByFilter[3] = true; // fila 4
  const { prep, result } = runSend(ctx, fake);

  assert.deepEqual(prep.view.rows.map((row) => row.rowNumber), [2]);
  assert.equal(prep.view.excludedCount, 2);
  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.deepEqual(result.counts, { total: 1, processed: 1, sent: 1, skipped: 0, review: 0, pending: 0 });
  assert.deepEqual(cellWriteRows(fake), [2, 2]);
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
});

test('AC-07 / AC-13: filas inválidas en la validación nunca llegan a Gmail en el envío real', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(2, 'Email Address', 'alpha@example.test; beta@example.test');
  fixture.drive.files[DRIVE_IDS.PDF_BETA].noAccess = true;
  const { prep, result } = runSend(ctx, fake);

  assert.equal(prep.view.invalidCount, 2);
  assert.deepEqual(prep.view.rows.map((row) => row.rowNumber), [4]);
  assert.deepEqual(sentTo(fake), [EMAILS[4]]);
  assert.equal(result.counts.sent, 1);
  assert.deepEqual(cellWriteRows(fake), [4, 4]);
  assert.equal(status(fake, 2), '');
  assert.equal(status(fake, 3), '');
});

test('AC-09: un PDF exportado que supera el límite en la Fase B omite la fila sin claim ni envío', () => {
  const { ctx, fake } = setup();
  // Alpha: comunes 3000 + PDF 1000 = 4000 en la validación (el nativo pesa 0);
  // al exportar el nativo suma 1500 → 5500 > 5000. Beta: 3000 + 2000 = 5000 (en el máximo).
  getConst(ctx, 'LIMITS').MAX_TOTAL_ATTACHMENT_BYTES = 5000;
  const { prep, result } = runSend(ctx, fake);

  assert.deepEqual(prep.view.rows.map((row) => row.rowNumber), [2, 3, 4]);
  assert.deepEqual(sentTo(fake), [EMAILS[3], EMAILS[4]]);
  assert.deepEqual(rowsWithResult(result, 'OMITIDA'), [2]);
  assert.match(result.rows[0].detail, /Los adjuntos suman/);
  assert.equal(result.rows[0].recipient, EMAILS[2]);
  assert.ok(!cellWriteRows(fake).includes(2));
  assert.equal(status(fake, 2), '');
});

test('AC-18: sin lock no envía ni escribe, la confirmación sigue en la caché y una ejecución posterior envía', () => {
  const { ctx, fixture, fake } = setup({ lockAvailable: false });
  const { prep, result } = runSend(ctx, fake);

  assertNothingSent(fake, result, LOCK_MESSAGE);
  assert.deepEqual(plain(fake.calls.lockCalls), [{ op: 'tryLock', ms: 10000 }]);
  assert.equal(fake.calls.cacheRemoves.length, 0);
  assert.equal(fake.calls.cacheGets.length, 0);
  assert.ok(Object.prototype.hasOwnProperty.call(fixture.cache, CONF_PREFIX + prep.token));

  const later = createFakeDeps(fixture);
  const second = plain(ctx.executeConfirmed_(later.deps, prep.token, 'send'));
  assert.equal(second.ok, true);
  assert.deepEqual(sentTo(later), [EMAILS[2], EMAILS[3], EMAILS[4]]);
});

test('AC-18: dos ejecuciones secuenciales con tokens distintos envían un solo correo por fila', () => {
  const { ctx, fake } = setup();
  // Doble clic: dos confirmaciones preparadas antes de que cualquiera ejecute.
  const first = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
  const second = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
  assert.notEqual(first.token, second.token);

  const resultA = plain(ctx.executeConfirmed_(fake.deps, first.token, 'send'));
  const resultB = plain(ctx.executeConfirmed_(fake.deps, second.token, 'send'));

  assert.equal(resultA.counts.sent, 3);
  assert.equal(resultB.counts.sent, 0);
  assert.deepEqual(sentTo(fake).sort(), [EMAILS[2], EMAILS[3], EMAILS[4]]);
  assert.deepEqual(rowsWithResult(resultB, 'OMITIDA'), [2, 3, 4]);
  assert.ok(resultB.rows.every((row) => row.detail === CHANGED));
  assert.equal(fake.calls.cellWrites.length, 6);
});

test('AC-19: claim persistido y falla posterior → cero envíos, ejecución detenida, la fila queda ENVIANDO', () => {
  const { ctx, fixture, fake } = setup({ failOn: { writeCells: { value: 'ENVIANDO', afterWrite: true } } });
  const { result } = runSend(ctx, fake);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(result.counts.sent, 0);
  assert.notEqual(result.stoppedReason, '');
  assert.equal(status(fake, 2), 'ENVIANDO');
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
  assert.deepEqual(resultsByRow(result), [[2, 'NO ENVIADA']]);
  assert.deepEqual(result.counts, { total: 3, processed: 1, sent: 0, skipped: 0, review: 1, pending: 2 });
  assert.deepEqual(plain(fake.calls.lockCalls).pop(), { op: 'release' });

  // Segunda ejecución sin fallas: la fila ENVIANDO no se reintenta.
  const second = createFakeDeps(fixture);
  runSend(ctx, second);
  assert.deepEqual(sentTo(second), [EMAILS[3], EMAILS[4]]);
  assert.equal(status(second, 2), 'ENVIANDO');
});

test('AC-19: claim que falla sin escribir → cero envíos, ejecución detenida, la fila sigue vacía', () => {
  const { ctx, fake } = setup({ failOn: { writeCells: { value: 'ENVIANDO' } } });
  const { result } = runSend(ctx, fake);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.notEqual(result.stoppedReason, '');
  assert.deepEqual(resultsByRow(result), [[2, 'NO ENVIADA']]);
  for (const row of [2, 3, 4]) {
    assert.equal(status(fake, row), '');
  }
});

test('AC-20: falla al persistir Email Sent → un envío, la fila queda ENVIANDO y no se reenvía', () => {
  const { ctx, fixture, fake } = setup({ failOn: { writeCells: { value: 'Email Sent' } } });
  const { result } = runSend(ctx, fake);

  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.equal(result.counts.sent, 1);
  assert.equal(result.counts.review, 1);
  assert.notEqual(result.stoppedReason, '');
  assert.equal(status(fake, 2), 'ENVIANDO');
  assert.equal(status(fake, 3), '');
  assert.deepEqual(resultsByRow(result), [[2, 'ENVIANDO']]);

  const second = createFakeDeps(fixture);
  runSend(ctx, second);
  assert.ok(!sentTo(second).includes(EMAILS[2]));
  assert.deepEqual(sentTo(second), [EMAILS[3], EMAILS[4]]);
});

test('AC-21: Gmail lanza → la fila queda REVISAR, la ejecución se detiene y las siguientes no se tocan', () => {
  const { ctx, fake } = setup({ failOn: { send: true } });
  const { result } = runSend(ctx, fake);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(result.counts.sent, 0);
  assert.equal(status(fake, 2), 'REVISAR');
  assert.deepEqual(plain(fake.calls.cellWrites).map((w) => [w.rowNumber, w.cells[w.cells.length - 1].value]), [
    [2, 'ENVIANDO'],
    [2, 'REVISAR'],
  ]);
  assert.deepEqual(resultsByRow(result), [[2, 'REVISAR']]);
  assert.deepEqual(result.counts, { total: 3, processed: 1, sent: 0, skipped: 0, review: 1, pending: 2 });
  assert.notEqual(result.stoppedReason, '');
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
});

test('AC-22: con cuota 1 y tres filas envía una sola y las demás siguen vacías y elegibles', () => {
  const { ctx, fixture, fake } = setup({ quota: 1 });
  const { result } = runSend(ctx, fake);

  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.equal(result.counts.sent, 1);
  assert.equal(result.counts.pending, 2);
  assert.match(result.stoppedReason, /cuota/);
  assert.equal(status(fake, 2), 'Email Sent');
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
  assert.deepEqual(cellWriteRows(fake), [2, 2]);

  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.deepEqual(plain(report.valid.map((row) => row.rowNumber)), [3, 4]);
});

test('AC-22: con cuota 0 al iniciar la Fase B no envía nada y lo informa', () => {
  const { ctx, fake } = setup();
  const { result } = runSend(ctx, fake, () => fake.setQuota(0));

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.match(result.stoppedReason, /cuota/);
  assert.deepEqual(result.counts, { total: 3, processed: 0, sent: 0, skipped: 0, review: 0, pending: 3 });
});

test('AC-22: con cuota desconocida no envía nada y lo informa (QUOTA_UNKNOWN)', () => {
  const { ctx, fake } = setup();
  const { result } = runSend(ctx, fake, () => fake.setQuota(null));

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.equal(result.stoppedReason, getConst(ctx, 'SEND_TEXT_').QUOTA_UNKNOWN);
});

test('D-30: preparar en t0 y ejecutar en t0 + 5 min (dentro del vencimiento) envía todo', () => {
  const { ctx, fake } = setup();
  const prep = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
  fake.setNow(DEFAULT_NOW + 5 * 60 * 1000);
  const result = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'send'));

  assert.equal(result.ok, true);
  assert.equal(result.counts.sent, 3);
  assert.equal(result.stoppedReason, '');
});

test('D-30: con un reloj que avanza en cada llamada, el corte por tiempo deja las filas restantes vacías y elegibles', () => {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();
  const step = 100 * 1000;
  let t = DEFAULT_NOW;
  const fake = createFakeDeps(fixture, {
    now: () => {
      const value = t;
      t += step;
      return value;
    },
  });
  const { result } = runSend(ctx, fake);

  assert.match(result.stoppedReason, /tiempo/);
  assert.ok(fake.calls.sent.length < 3);
  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.deepEqual(result.counts, { total: 3, processed: 1, sent: 1, skipped: 0, review: 0, pending: 2 });
  assert.deepEqual(cellWriteRows(fake), [2, 2]);
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.deepEqual(plain(report.valid.map((row) => row.rowNumber)), [3, 4]);
});

test('AC-23: el destinatario editado entre fases se omite y las demás filas se envían', () => {
  const { ctx, fake } = setup();
  const { result } = runSend(ctx, fake, () => fake.setCell(3, 'Email Address', 'other@example.test'));

  assert.deepEqual(sentTo(fake), [EMAILS[2], EMAILS[4]]);
  assert.deepEqual(result.rows[1], { rowNumber: 3, recipient: '', result: 'OMITIDA', detail: CHANGED });
  assert.equal(status(fake, 3), '');
  assert.ok(!cellWriteRows(fake).includes(3));
});

test('AC-23: el enlace de adjunto editado entre fases se omite y las demás filas se envían', () => {
  const { ctx, fake } = setup();
  const { result } = runSend(ctx, fake, () => fake.setCell(2, 'File Attachments', fileLink(DRIVE_IDS.PDF_BETA)));

  assert.deepEqual(sentTo(fake), [EMAILS[3], EMAILS[4]]);
  assert.deepEqual(rowsWithResult(result, 'OMITIDA'), [2]);
  assert.equal(result.rows[0].detail, CHANGED);
  assert.equal(status(fake, 2), '');
  // Ni el resultado ni las celdas escritas incluyen URLs.
  const text = JSON.stringify(result) + JSON.stringify(plain(fake.calls.cellWrites));
  assert.ok(!text.includes('drive.google.com'));
});

test('AC-23: una edición durante el recorrido (beforeReadRow) omite esa fila', () => {
  const hooks = {};
  const { ctx, fake } = setup({ hooks });
  let edited = false;
  hooks.beforeReadRow = (rowNumber) => {
    if (rowNumber === 3 && !edited) {
      edited = true;
      fake.setCell(3, 'Email Address', 'other@example.test');
    }
  };
  const { result } = runSend(ctx, fake);

  assert.equal(edited, true);
  assert.deepEqual(sentTo(fake), [EMAILS[2], EMAILS[4]]);
  assert.deepEqual(rowsWithResult(result, 'OMITIDA'), [3]);
  assert.equal(result.rows[1].detail, CHANGED);
  assert.equal(status(fake, 3), '');
  assert.ok(!cellWriteRows(fake).includes(3));
  assert.ok(!sentTo(fake).includes('other@example.test'));
});

test('AC-24: filas intercambiadas entre fases nunca se envían con datos de otra fila', () => {
  const { ctx, fake } = setup();
  const { prep, result, start } = runSend(ctx, fake, () => fake.swapRows(2, 3));

  const confirmedEmail = {};
  prep.view.rows.forEach((row) => {
    confirmedEmail[row.rowNumber] = row.email;
  });
  // Cada envío fue precedido por el claim de la fila cuyo destinatario confirmado coincide.
  const sequence = summarize(plain(fake.calls.sequence.slice(start)));
  sequence.forEach((step, index) => {
    if (step.type === 'send') {
      const claim = sequence[index - 1];
      assert.equal(claim.result, 'ENVIANDO');
      assert.equal(step.to, confirmedEmail[claim.rowNumber]);
    }
  });
  assert.deepEqual(rowsWithResult(result, 'OMITIDA'), [2, 3]);
  assert.deepEqual(sentTo(fake), [EMAILS[4]]);
  assert.equal(status(fake, 2), '');
  assert.equal(status(fake, 3), '');
});

test('AC-25: una re-ejecución después de un envío exitoso no duplica', () => {
  const { ctx, fixture, fake } = setup();
  const { prep: firstPrep } = runSend(ctx, fake);
  assert.equal(fake.calls.sent.length, 3);

  const second = createFakeDeps(fixture);
  const prep = plain(ctx.prepareConfirmation_(second.deps, 'send'));
  assert.equal(prep.ok, false);
  assert.deepEqual(prep.errors, ['No hay correos para enviar']);
  assert.equal(second.calls.sent.length, 0);
  assert.equal(second.calls.cellWrites.length, 0);

  // Reutilizar la confirmación vieja tampoco duplica.
  const stale = createFakeDeps(fixture);
  const staleResult = plain(ctx.executeConfirmed_(stale.deps, firstPrep.token, 'send'));
  assertNothingSent(stale, staleResult, INVALID_MESSAGE);
});

test('D-15: un cambio de plantilla entre fases cancela todo sin envíos ni escrituras', () => {
  const { ctx, fake } = setup();
  const { result } = runSend(ctx, fake, () => fake.setTemplate({ subject: 'Changed {{Reference}}' }));

  assertNothingSent(fake, result);
  assert.match(result.stoppedReason, /plantilla/);
  assert.deepEqual(plain(fake.calls.lockCalls).pop(), { op: 'release' });
});

test('D-15: errores globales en la Fase B cancelan todo sin envíos ni escrituras', () => {
  const { ctx, fixture, fake } = setup();
  // El alias configurado se quita de la cuenta entre la confirmación y el envío.
  fixture.config.from = ALIAS_EMAIL;
  const { prep, result } = runSend(ctx, fake, () => {
    fixture.gmail.aliases = [];
  });

  assert.equal(prep.view.count, 3);
  assertNothingSent(fake, result);
  assert.notEqual(result.stoppedReason, '');
  assert.deepEqual(plain(fake.calls.lockCalls).pop(), { op: 'release' });
});

test('Fase B paso 8: una fila insertada arriba durante el envío no recibe Email Sent', () => {
  const hooks = {};
  const { ctx, fake } = setup({ hooks });
  let inserted = false;
  hooks.afterSend = () => {
    if (!inserted) {
      inserted = true;
      fake.insertRowAbove(2, buildRow({ 'Email Address': 'new@example.test', 'First Name': 'New', Reference: 'REF-9' }));
    }
  };
  const { result } = runSend(ctx, fake);

  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.equal(result.counts.sent, 1);
  assert.deepEqual(plain(fake.calls.cellWrites).map((w) => [w.rowNumber, w.cells[w.cells.length - 1].value]), [
    [2, 'ENVIANDO'],
  ]);
  // La fila insertada sigue vacía y la original (ahora en la fila 3) quedó ENVIANDO.
  assert.equal(status(fake, 2), '');
  assert.equal(status(fake, 3), 'ENVIANDO');
  assert.equal(fake.getCell(3, 'Email Address'), EMAILS[2]);
  assert.deepEqual(resultsByRow(result), [[2, 'REVISAR']]);
  assert.match(result.rows[0].detail, /cambió de posición/);
  assert.equal(result.counts.review, 1);
  assert.notEqual(result.stoppedReason, '');
});

test('AC-35: executeConfirmed_ con token inválido, desconocido, vencido, desalojado, de otro tipo, de otra cuenta o alterado → cero envíos', () => {
  // Formato inválido: sin lock ni caché.
  for (const token of [undefined, 'abc']) {
    const { ctx, fake } = setup();
    const result = plain(ctx.executeConfirmed_(fake.deps, token, 'send'));
    assertNothingSent(fake, result, INVALID_MESSAGE);
    assert.equal(fake.calls.lockCalls.length, 0);
    assert.equal(fake.calls.cacheGets.length, 0);
  }

  // UUID desconocido.
  {
    const { ctx, fake } = setup();
    const result = plain(ctx.executeConfirmed_(fake.deps, UNKNOWN_TOKEN, 'send'));
    assertNothingSent(fake, result, INVALID_MESSAGE);
    assert.deepEqual(plain(fake.calls.lockCalls), [{ op: 'tryLock', ms: 10000 }, { op: 'release' }]);
  }

  const cases = [
    {
      name: 'vencido',
      message: EXPIRED_MESSAGE,
      between: (fake) => fake.setNow(DEFAULT_NOW + 600001),
    },
    { name: 'desalojado', message: INVALID_MESSAGE, between: (fake, token) => fake.evict(CONF_PREFIX + token) },
    {
      name: 'JSON truncado',
      message: INVALID_MESSAGE,
      between: (fake, token) => fake.setCacheValue(CONF_PREFIX + token, fake.fixture.cache[CONF_PREFIX + token].slice(0, 20)),
    },
    {
      name: 'v: 1',
      message: INVALID_MESSAGE,
      between: (fake, token) => {
        const snapshot = JSON.parse(fake.fixture.cache[CONF_PREFIX + token]);
        snapshot.v = 1;
        fake.setCacheValue(CONF_PREFIX + token, JSON.stringify(snapshot));
      },
    },
  ];
  for (const item of cases) {
    const { ctx, fake } = setup();
    const prep = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
    item.between(fake, prep.token);
    const result = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'send'));
    assertNothingSent(fake, result, item.message);
  }

  // Token de una prueba ejecutado como envío.
  {
    const { ctx, fake } = setup();
    const prep = plain(ctx.prepareConfirmation_(fake.deps, 'test', 2));
    assert.equal(prep.ok, true);
    const result = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'send'));
    assertNothingSent(fake, result, WRONG_KIND_MESSAGE);
  }

  // Token de envío ejecutado con otro tipo: rechazo sin envíos.
  for (const kind of ['test', 'otro']) {
    const { ctx, fake } = setup();
    const prep = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
    const result = plain(ctx.executeConfirmed_(fake.deps, prep.token, kind));
    assertNothingSent(fake, result);
  }

  // Otra cuenta sobre el mismo fixture (misma caché).
  {
    const { ctx, fixture, fake } = setup();
    const prep = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
    const other = createFakeDeps(fixture, { userEmail: 'other@example.test' });
    const result = plain(ctx.executeConfirmed_(other.deps, prep.token, 'send'));
    assertNothingSent(other, result, WRONG_USER_MESSAGE);
  }
});

test('AC-36 / D-28: el mismo token dos veces → la segunda no envía; el consumo precede al primer writeCells', () => {
  const { ctx, fake } = setup();
  const { prep, start } = runSend(ctx, fake);
  assert.equal(fake.calls.sent.length, 3);

  const sequence = summarize(plain(fake.calls.sequence.slice(start)));
  const removeIndex = sequence.findIndex((step) => step.type === 'cacheRemove' && step.key === CONF_PREFIX + prep.token);
  const firstWrite = sequence.findIndex((step) => step.type === 'writeCells');
  assert.ok(removeIndex !== -1 && removeIndex < firstWrite);

  const again = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'send'));
  assert.equal(again.ok, false);
  assert.equal(again.stoppedReason, INVALID_MESSAGE);
  assert.equal(fake.calls.sent.length, 3);
  assert.equal(fake.calls.cellWrites.length, 6);
});

test('AC-36 / D-28: cache.remove que lanza al consumir → cero envíos y escrituras', () => {
  const { ctx, fake } = setup({ failOn: { cacheRemove: true } });
  const { result } = runSend(ctx, fake);
  assertNothingSent(fake, result, CONSUME_FAILED_MESSAGE);
});

test('AC-37 / D-43: cambiar from, replyTo, draftId, sheetId o campaignName entre fases cancela todo', () => {
  const changes = {
    from: (fixture) => {
      fixture.config.from = ALIAS_EMAIL;
    },
    replyTo: (fixture) => {
      fixture.config.replyTo = 'reply@example.test';
    },
    draftId: (fixture) => {
      const copy = { ...fixture.gmail.drafts[0], id: 'draft-002' };
      fixture.gmail.drafts.push(copy);
      fixture.config.draftId = 'draft-002';
    },
    sheetId: (fixture) => {
      fixture.config.sheetId = 202;
    },
    campaignName: (fixture) => {
      fixture.config.campaignName = 'Otra campaña';
    },
  };
  for (const name of Object.keys(changes)) {
    const { ctx, fixture, fake } = setup();
    const { result } = runSend(ctx, fake, () => changes[name](fixture));
    assertNothingSent(fake, result);
    assert.match(result.stoppedReason, /configuración/, name);
    assert.deepEqual(plain(fake.calls.lockCalls).pop(), { op: 'release' }, name);
  }
});

test('AC-54 / D-47: con metadatos a reemplazar, sin overwriteConsent === true no envía y consume el token', () => {
  for (const consent of [undefined, false, 'true']) {
    const { ctx, fake } = setup();
    fake.setCell(3, 'Campaña', 'Anterior');
    const { prep, result } = runSend(ctx, fake, null, consent);

    assert.equal(prep.view.consentRequired, true);
    assertNothingSent(fake, result, CONSENT_MESSAGE);
    assert.equal(fake.getCell(3, 'Campaña'), 'Anterior');
    // El token ya no sirve, ni siquiera con el consentimiento.
    const again = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'send', true));
    assertNothingSent(fake, again, INVALID_MESSAGE);
  }
});

test('AC-54 / D-47: con overwriteConsent true envía y reemplaza la campaña; sin metadatos previos no hace falta', () => {
  const { ctx, fake } = setup();
  fake.setCell(3, 'Campaña', 'Anterior');
  const { result } = runSend(ctx, fake, null, true);
  assert.equal(result.ok, true);
  assert.equal(fake.calls.sent.length, 3);
  assert.equal(fake.getCell(3, 'Campaña'), 'camp0001');

  const plainSetup = setup();
  const { prep, result: plainResult } = runSend(plainSetup.ctx, plainSetup.fake);
  assert.equal(prep.view.consentRequired, false);
  assert.equal(plainResult.counts.sent, 3);
});

test('AC-55 / D-48: Detalle, Fecha o Campaña cambiados después de confirmar omiten la fila sin escribir', () => {
  for (const header of ['Detalle', 'Fecha', 'Campaña']) {
    const { ctx, fake } = setup();
    const { result } = runSend(ctx, fake, () => fake.setCell(3, header, 'x'));

    assert.deepEqual(resultsByRow(result), [
      [2, 'Email Sent'],
      [3, 'OMITIDA'],
      [4, 'Email Sent'],
    ], header);
    assert.equal(result.rows[1].detail, META_CHANGED, header);
    assert.equal(result.rows[1].recipient, EMAILS[3], header);
    assert.ok(!cellWriteRows(fake).includes(3), header);
    assert.deepEqual(sentTo(fake), [EMAILS[2], EMAILS[4]], header);
    assert.equal(fake.getCell(3, header), 'x', header);
    assert.equal(status(fake, 3), '', header);
  }
});

test('AC-55 / D-48: el mismo cambio durante el recorrido (beforeReadRow) omite la fila sin escribir', () => {
  const hooks = {};
  const { ctx, fake } = setup({ hooks });
  hooks.beforeReadRow = (rowNumber) => {
    if (rowNumber === 3 && fake.getCell(3, 'Detalle') === '') {
      fake.setCell(3, 'Detalle', 'x');
    }
  };
  const { result } = runSend(ctx, fake);

  assert.deepEqual(rowsWithResult(result, 'OMITIDA'), [3]);
  assert.equal(result.rows[1].detail, META_CHANGED);
  assert.ok(!cellWriteRows(fake).includes(3));
  assert.deepEqual(sentTo(fake), [EMAILS[2], EMAILS[4]]);
  assert.equal(fake.getCell(3, 'Detalle'), 'x');
});

test('AC-39: los resultados por fila usan los literales previstos y no contienen cuerpo, asunto, URLs ni variables', () => {
  const forbidden = ['Hello', 'Notice REF-001', 'drive.google.com', 'docs.google.com', 'Alpha', 'Beta', 'Gamma', 'REF-00'];
  const collected = [];

  const happy = setup();
  collected.push(runSend(happy.ctx, happy.fake).result);
  collected.push({ cells: plain(happy.fake.calls.cellWrites).map((w) => w.cells.map((c) => c.value)) });

  // Fila 2 omitida por un cambio de adjunto, fila 3 con excepción de Gmail.
  const mixed = setup({ failOn: { send: (message) => message.to === EMAILS[3] } });
  const mixedResult = runSend(mixed.ctx, mixed.fake, () =>
    mixed.fake.setCell(2, 'File Attachments', fileLink(DRIVE_IDS.PDF_BETA))
  ).result;
  collected.push(mixedResult);
  collected.push({ cells: plain(mixed.fake.calls.cellWrites).map((w) => w.cells.map((c) => c.value)) });

  // Falla al escribir Email Sent y claim fallido.
  const sentFails = setup({ failOn: { writeCells: { value: 'Email Sent' } } });
  collected.push(runSend(sentFails.ctx, sentFails.fake).result);
  const claimFails = setup({ failOn: { writeCells: { value: 'ENVIANDO' } } });
  collected.push(runSend(claimFails.ctx, claimFails.fake).result);

  const results = collected.filter((item) => item.rows);
  const seen = new Set();
  results.forEach((result) => {
    result.rows.forEach((row) => {
      assert.ok(RESULTS.includes(row.result), row.result);
      assert.equal(typeof row.detail, 'string');
      assert.notEqual(row.detail, '');
      seen.add(row.result);
    });
  });
  assert.deepEqual([...seen].sort(), [...RESULTS].sort());

  const text = JSON.stringify(
    collected.map((item) => (item.rows ? { rows: item.rows, summaryLines: item.summaryLines } : item))
  );
  forbidden.forEach((value) => {
    assert.ok(!text.includes(value), 'el resultado contiene ' + value);
  });
});

test('D-13: buildSendResultView_ informa omitidas, revisión y corte sin decir "entregados"', () => {
  const { ctx } = setup();
  const view = plain(
    ctx.buildSendResultView_({
      ok: true,
      state: 'TERMINADO',
      kind: 'send',
      campaign: 'c123',
      counts: { total: 4, processed: 3, sent: 1, skipped: 1, review: 1, pending: 1 },
      rows: [
        { rowNumber: 2, recipient: EMAILS[2], result: 'Email Sent', detail: ACCEPTED },
        { rowNumber: 3, recipient: '', result: 'OMITIDA', detail: CHANGED },
        { rowNumber: 4, recipient: EMAILS[4], result: 'REVISAR', detail: 'Gmail no aceptó el envío' },
      ],
      stoppedReason: 'Se agotó la cuota',
    })
  );

  assert.deepEqual(Object.keys(view).sort(), ['campaign', 'counts', 'kind', 'ok', 'rows', 'stoppedReason', 'summaryLines']);
  assert.equal(view.ok, true);
  assert.equal(view.kind, 'send');
  assert.equal(view.campaign, 'c123');
  assert.equal(view.rows.length, 3);
  assert.equal(view.rows[0].recipient, EMAILS[2]);
  const text = view.summaryLines.join('\n');
  assert.match(text, /c123/);
  assert.match(text, /1 correo aceptado por Gmail/);
  assert.match(text, /Fila 3 \(OMITIDA\): Cambió después de la confirmación/);
  assert.match(text, /Fila 4 \(REVISAR\): Gmail no aceptó el envío/);
  assert.match(text, /Se agotó la cuota/);
  assert.match(text, /pendientes: 1/);
  assert.doesNotMatch(text, /entregad/i);

  // Texto saneado: un salto de línea en un detalle queda en una línea.
  const sanitized = plain(
    ctx.buildSendResultView_({
      ok: true,
      kind: 'send',
      campaign: 'c\n1',
      counts: { total: 1, processed: 1, sent: 0, skipped: 1, review: 0, pending: 0 },
      rows: [{ rowNumber: 2, recipient: 'a@example.test', result: 'OMITIDA', detail: 'uno\ndos' }],
      stoppedReason: '',
    })
  );
  assert.ok(!sanitized.rows[0].detail.includes('\n'));
  assert.ok(!sanitized.campaign.includes('\n'));
  assert.ok(sanitized.summaryLines.every((line) => !line.includes('\n')));
});
