'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, getConst, plain, isDate } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const { createCampaignFixture, buildRow, fileLink, DRIVE_IDS } = require('./fixtures/campaign');

const LOCK_MESSAGE = 'Hay otra ejecución en curso; reintentá en unos minutos';
const CHANGED = 'Cambió después de la confirmación';
const EMAILS = { 2: 'alpha@example.test', 3: 'beta@example.test', 4: 'gamma@example.test' };

function setup(options) {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();
  const fake = createFakeDeps(fixture, options);
  return { ctx, fixture, fake };
}

// Flujo completo de `runSendPending_`: `startedAt` → Fase A → (mutación
// opcional entre fases) → Fase B.
function runSend(ctx, fake, fixture, between) {
  const startedAt = fake.deps.clock.now();
  const prepared = ctx.prepareSend_(fake.deps, fixture.config);
  if (between) {
    between();
  }
  const result = ctx.executeSend_(fake.deps, fixture.config, prepared, startedAt);
  return { prepared, result };
}

function status(fake, rowNumber) {
  return fake.getCell(rowNumber, 'Resultado');
}

function sentTo(fake) {
  return fake.calls.sent.map((message) => message.to);
}

function skippedRows(result) {
  return plain(result.skipped).map((row) => row.rowNumber);
}

test('prepareSend_ (Fase A) confirma las filas válidas y la clave de la plantilla sin efectos', () => {
  const { ctx, fixture, fake } = setup();
  const prepared = ctx.prepareSend_(fake.deps, fixture.config);

  assert.equal(prepared.report.ok, true);
  assert.equal(prepared.confirmed.templateKey, prepared.report.templateKey);
  assert.deepEqual(
    plain(prepared.confirmed.rows),
    plain(prepared.report.valid.map((row) => [row.rowNumber, row.key]))
  );
  assert.deepEqual(plain(prepared.confirmed.rows).map((pair) => pair[0]), [2, 3, 4]);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);
  assert.equal(fake.calls.lockCalls.length, 0);
});

test('prepareSend_ con errores globales no confirma ninguna fila', () => {
  const { ctx, fixture, fake } = setup();
  const prepared = ctx.prepareSend_(fake.deps, { ...fixture.config, from: 'intruder@example.test' });
  assert.ok(prepared.report.globalErrors.length > 0);
  assert.equal(prepared.confirmed.rows.size, 0);
});

test('Camino feliz: cada fila pasa por ENVIANDO → send → Email Sent y el lock se libera una vez', () => {
  const { ctx, fixture, fake } = setup();
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(result.sent, 3);
  assert.equal(result.stoppedReason, '');
  assert.deepEqual(plain(result.skipped), []);
  assert.deepEqual(plain(result.review), []);
  assert.equal(result.logErrors, 0);
  assert.equal(result.campaignId, 'camp0001');

  assert.deepEqual(plain(fake.calls.sequence), [
    { type: 'writeStatus', rowNumber: 2, value: 'ENVIANDO' },
    { type: 'send', to: EMAILS[2] },
    { type: 'writeStatus', rowNumber: 2, value: 'Email Sent' },
    { type: 'writeStatus', rowNumber: 3, value: 'ENVIANDO' },
    { type: 'send', to: EMAILS[3] },
    { type: 'writeStatus', rowNumber: 3, value: 'Email Sent' },
    { type: 'writeStatus', rowNumber: 4, value: 'ENVIANDO' },
    { type: 'send', to: EMAILS[4] },
    { type: 'writeStatus', rowNumber: 4, value: 'Email Sent' },
  ]);
  assert.deepEqual(plain(fake.calls.lockCalls), [{ op: 'tryLock', ms: 10000 }, { op: 'release' }]);
  assert.equal(fake.calls.statusWrites.every((write) => write.column === 6), true);
  for (const row of [2, 3, 4]) {
    assert.equal(status(fake, row), 'Email Sent');
  }

  // El mensaje real es el de `buildMessage_` (asunto renderizado y adjuntos de la fila).
  assert.equal(fake.calls.sent[0].subject, 'Notice REF-001');
  assert.deepEqual(
    plain(fake.calls.sent[0].attachments).map((a) => a.name),
    ['common-terms.pdf', 'alpha-notice.pdf', 'Alpha Letter.pdf']
  );

  const summary = ctx.formatSendSummary_(result);
  assert.match(summary, /camp0001/);
  assert.match(summary, /3 correos aceptados por Gmail/);
  assert.doesNotMatch(summary, /entregad/i);
});

test('AC-11: filas ocultas por el usuario o por un filtro no entran en la validación ni en el envío real', () => {
  const { ctx, fixture, fake } = setup();
  fixture.sheets[0].hiddenByUser[2] = true; // fila 3
  fixture.sheets[0].hiddenByFilter[3] = true; // fila 4
  const { prepared, result } = runSend(ctx, fake, fixture);

  assert.deepEqual(plain(prepared.report.excluded), [
    { rowNumber: 3, reason: 'oculta por el usuario' },
    { rowNumber: 4, reason: 'oculta por un filtro' },
  ]);
  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.equal(result.sent, 1);
  assert.deepEqual(plain(fake.calls.statusWrites).map((w) => w.rowNumber), [2, 2]);
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
});

test('AC-07 / AC-13: filas inválidas en la validación nunca llegan a Gmail en el envío real', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(2, 'Email Address', 'alpha@example.test; beta@example.test');
  fixture.drive.files[DRIVE_IDS.PDF_BETA].noAccess = true;
  const { prepared, result } = runSend(ctx, fake, fixture);

  assert.deepEqual(plain(prepared.report.invalid).map((row) => row.rowNumber), [2, 3]);
  assert.deepEqual(sentTo(fake), [EMAILS[4]]);
  assert.equal(result.sent, 1);
  assert.deepEqual(plain(fake.calls.statusWrites).map((w) => w.rowNumber), [4, 4]);
  assert.equal(status(fake, 2), '');
  assert.equal(status(fake, 3), '');
});

test('AC-09: un PDF exportado que supera el límite en la Fase B omite la fila sin claim ni envío', () => {
  const { ctx, fixture, fake } = setup();
  // Alpha: comunes 3000 + PDF 1000 = 4000 en la validación (el nativo pesa 0);
  // al exportar el nativo suma 1500 → 5500 > 5000. Beta: 3000 + 2000 = 5000 (en el máximo).
  getConst(ctx, 'LIMITS').MAX_TOTAL_ATTACHMENT_BYTES = 5000;
  const { prepared, result } = runSend(ctx, fake, fixture);

  assert.deepEqual(plain(prepared.report.valid.map((row) => row.rowNumber)), [2, 3, 4]);
  assert.deepEqual(sentTo(fake), [EMAILS[3], EMAILS[4]]);
  assert.deepEqual(skippedRows(result), [2]);
  assert.match(plain(result.skipped)[0].reason, /Los adjuntos suman/);
  assert.ok(!fake.calls.statusWrites.some((w) => w.rowNumber === 2));
  assert.equal(status(fake, 2), '');
});

test('AC-18: sin lock no envía ni escribe y lo informa', () => {
  const { ctx, fixture, fake } = setup({ lockAvailable: false });
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.stoppedReason, LOCK_MESSAGE);
  assert.deepEqual(plain(fake.calls.lockCalls), [{ op: 'tryLock', ms: 10000 }]);
  assert.match(ctx.formatSendSummary_(result), /Hay otra ejecución en curso/);
});

test('AC-18: dos ejecuciones confirmadas a la vez envían un solo correo por fila', () => {
  const { ctx, fixture, fake } = setup();
  const startedAt = fake.deps.clock.now();
  // Doble clic: las dos ejecuciones confirman antes de que cualquiera tome el lock.
  const first = ctx.prepareSend_(fake.deps, fixture.config);
  const second = ctx.prepareSend_(fake.deps, fixture.config);

  const resultA = ctx.executeSend_(fake.deps, fixture.config, first, startedAt);
  const resultB = ctx.executeSend_(fake.deps, fixture.config, second, startedAt);

  assert.equal(resultA.sent, 3);
  assert.equal(resultB.sent, 0);
  assert.deepEqual(sentTo(fake).sort(), [EMAILS[2], EMAILS[3], EMAILS[4]]);
  assert.deepEqual(skippedRows(resultB), [2, 3, 4]);
  assert.ok(plain(resultB.skipped).every((row) => row.reason === CHANGED));
});

test('AC-19: claim persistido y falla posterior → cero envíos, ejecución detenida, la fila queda ENVIANDO', () => {
  const { ctx, fixture, fake } = setup({ failOn: { writeStatus: { value: 'ENVIANDO', afterWrite: true } } });
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(result.sent, 0);
  assert.notEqual(result.stoppedReason, '');
  assert.equal(status(fake, 2), 'ENVIANDO');
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
  assert.deepEqual(plain(result.review).map((row) => row.rowNumber), [2]);
  assert.deepEqual(plain(fake.calls.lockCalls).pop(), { op: 'release' });

  // Segunda ejecución sin fallas: la fila ENVIANDO no se reintenta.
  const second = createFakeDeps(fixture);
  runSend(ctx, second, fixture);
  assert.deepEqual(sentTo(second), [EMAILS[3], EMAILS[4]]);
  assert.equal(status(second, 2), 'ENVIANDO');
});

test('AC-19: claim que falla sin escribir → cero envíos, ejecución detenida, la fila sigue vacía', () => {
  const { ctx, fixture, fake } = setup({ failOn: { writeStatus: { value: 'ENVIANDO' } } });
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.notEqual(result.stoppedReason, '');
  for (const row of [2, 3, 4]) {
    assert.equal(status(fake, row), '');
  }
});

test('AC-20: falla al persistir Email Sent → un envío, la fila queda ENVIANDO y no se reenvía', () => {
  const { ctx, fixture, fake } = setup({ failOn: { writeStatus: { value: 'Email Sent' } } });
  const { result } = runSend(ctx, fake, fixture);

  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.equal(result.sent, 1);
  assert.notEqual(result.stoppedReason, '');
  assert.equal(status(fake, 2), 'ENVIANDO');
  assert.equal(status(fake, 3), '');
  assert.deepEqual(plain(result.review).map((row) => row.rowNumber), [2]);

  const second = createFakeDeps(fixture);
  runSend(ctx, second, fixture);
  assert.ok(!sentTo(second).includes(EMAILS[2]));
  assert.deepEqual(sentTo(second), [EMAILS[3], EMAILS[4]]);
});

test('AC-21: Gmail lanza → la fila queda REVISAR, la ejecución se detiene y las siguientes no se tocan', () => {
  const { ctx, fixture, fake } = setup({ failOn: { send: true } });
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(status(fake, 2), 'REVISAR');
  assert.deepEqual(plain(fake.calls.statusWrites).map((w) => [w.rowNumber, w.value]), [
    [2, 'ENVIANDO'],
    [2, 'REVISAR'],
  ]);
  assert.deepEqual(plain(result.review).map((row) => row.rowNumber), [2]);
  assert.notEqual(result.stoppedReason, '');
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
  assert.ok(fake.calls.logEntries.some((entry) => entry.rowNumber === 2 && entry.result === 'REVISAR'));
});

test('AC-22: con el reloj por encima de MAX_RUNTIME_MS no envía y deja las filas elegibles', () => {
  const { ctx, fixture, fake } = setup();
  const maxRuntime = getConst(ctx, 'LIMITS').MAX_RUNTIME_MS;
  const startedAt = fake.deps.clock.now();
  const prepared = ctx.prepareSend_(fake.deps, fixture.config);
  fake.setNow(startedAt + maxRuntime + 1);
  const result = ctx.executeSend_(fake.deps, fixture.config, prepared, startedAt);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.notEqual(result.stoppedReason, '');
  assert.match(ctx.formatSendSummary_(result), /tiempo/);
  assert.deepEqual(plain(ctx.buildPreflight_(fake.deps, fixture.config).valid.map((row) => row.rowNumber)), [2, 3, 4]);
});

test('AC-22: con cuota 1 y tres filas envía una sola y las demás siguen vacías y elegibles', () => {
  const { ctx, fixture, fake } = setup({ quota: 1 });
  const { result } = runSend(ctx, fake, fixture);

  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.equal(result.sent, 1);
  assert.notEqual(result.stoppedReason, '');
  assert.equal(status(fake, 2), 'Email Sent');
  assert.equal(status(fake, 3), '');
  assert.equal(status(fake, 4), '');
  assert.deepEqual(plain(fake.calls.statusWrites).map((w) => w.rowNumber), [2, 2]);

  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.deepEqual(plain(report.valid.map((row) => row.rowNumber)), [3, 4]);
});

test('AC-22: con cuota 0 al iniciar la Fase B no envía nada y lo informa', () => {
  const { ctx, fixture, fake } = setup();
  const { result } = runSend(ctx, fake, fixture, () => fake.setQuota(0));

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.match(result.stoppedReason, /cuota/);
});

test('AC-23: el destinatario editado entre fases se omite y las demás filas se envían', () => {
  const { ctx, fixture, fake } = setup();
  const { result } = runSend(ctx, fake, fixture, () => fake.setCell(3, 'Email Address', 'other@example.test'));

  assert.deepEqual(sentTo(fake), [EMAILS[2], EMAILS[4]]);
  assert.deepEqual(plain(result.skipped), [{ rowNumber: 3, reason: CHANGED }]);
  assert.equal(status(fake, 3), '');
  assert.ok(!fake.calls.statusWrites.some((w) => w.rowNumber === 3));
});

test('AC-23: el enlace de adjunto editado entre fases se omite y las demás filas se envían', () => {
  const { ctx, fixture, fake } = setup();
  const { result } = runSend(ctx, fake, fixture, () =>
    fake.setCell(2, 'File Attachments', fileLink(DRIVE_IDS.PDF_BETA))
  );

  assert.deepEqual(sentTo(fake), [EMAILS[3], EMAILS[4]]);
  assert.deepEqual(plain(result.skipped), [{ rowNumber: 2, reason: CHANGED }]);
  assert.equal(status(fake, 2), '');
  // Ni el motivo ni el registro incluyen URLs.
  const logged = JSON.stringify(plain(fake.calls.logEntries)) + JSON.stringify(plain(result));
  assert.ok(!logged.includes('drive.google.com'));
});

test('AC-23: una edición durante el recorrido (beforeReadRow) omite esa fila', () => {
  const hooks = {};
  const { ctx, fixture, fake } = setup({ hooks });
  let edited = false;
  hooks.beforeReadRow = (rowNumber) => {
    if (rowNumber === 3 && !edited) {
      edited = true;
      fake.setCell(3, 'Email Address', 'other@example.test');
    }
  };
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(edited, true);
  assert.deepEqual(sentTo(fake), [EMAILS[2], EMAILS[4]]);
  assert.deepEqual(plain(result.skipped), [{ rowNumber: 3, reason: CHANGED }]);
  assert.equal(status(fake, 3), '');
  assert.ok(!sentTo(fake).includes('other@example.test'));
});

test('AC-24: filas intercambiadas entre fases nunca se envían con datos de otra fila', () => {
  const { ctx, fixture, fake } = setup();
  const { prepared, result } = runSend(ctx, fake, fixture, () => fake.swapRows(2, 3));

  const confirmedEmail = {};
  prepared.report.valid.forEach((row) => {
    confirmedEmail[row.rowNumber] = row.email;
  });
  // Cada envío fue precedido por el claim de la fila cuyo destinatario confirmado coincide.
  const sequence = plain(fake.calls.sequence);
  sequence.forEach((step, index) => {
    if (step.type === 'send') {
      const claim = sequence[index - 1];
      assert.equal(claim.value, 'ENVIANDO');
      assert.equal(step.to, confirmedEmail[claim.rowNumber]);
    }
  });
  assert.deepEqual(skippedRows(result), [2, 3]);
  assert.deepEqual(sentTo(fake), [EMAILS[4]]);
  assert.equal(status(fake, 2), '');
  assert.equal(status(fake, 3), '');
});

test('AC-25: una re-ejecución después de un envío exitoso no duplica', () => {
  const { ctx, fixture, fake } = setup();
  const { prepared: firstPrepared } = runSend(ctx, fake, fixture);
  assert.equal(fake.calls.sent.length, 3);

  const second = createFakeDeps(fixture);
  const { prepared, result } = runSend(ctx, second, fixture);
  assert.equal(prepared.confirmed.rows.size, 0);
  assert.equal(second.calls.sent.length, 0);
  assert.equal(second.calls.statusWrites.length, 0);
  assert.equal(result.sent, 0);

  // Reutilizar la confirmación vieja tampoco duplica.
  const stale = createFakeDeps(fixture);
  const staleResult = ctx.executeSend_(stale.deps, fixture.config, firstPrepared, stale.deps.clock.now());
  assert.equal(stale.calls.sent.length, 0);
  assert.equal(stale.calls.statusWrites.length, 0);
  assert.deepEqual(skippedRows(staleResult), [2, 3, 4]);
});

test('AC-26: las entradas de registro de un envío exitoso solo tienen los campos permitidos', () => {
  const { ctx, fixture, fake } = setup();
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(fake.calls.logEntries.length, 3);
  const forbidden = ['Hello', 'Notice REF', 'drive.google.com', 'docs.google.com', 'Alpha', 'Beta', 'Gamma', 'REF-00'];
  fake.calls.logEntries.forEach((entry, index) => {
    const rowNumber = index + 2;
    assert.ok(isDate(entry.date));
    assert.deepEqual(Object.keys(entry).sort(), [
      'campaignId',
      'date',
      'detail',
      'recipient',
      'result',
      'rowNumber',
      'sheetName',
    ]);
    assert.equal(entry.campaignId, result.campaignId);
    assert.equal(entry.sheetName, 'Recipients');
    assert.equal(entry.rowNumber, rowNumber);
    assert.equal(entry.recipient, EMAILS[rowNumber]);
    assert.equal(entry.result, 'Email Sent');
    const text = JSON.stringify(plain({ ...entry, date: null }));
    forbidden.forEach((value) => {
      assert.ok(!text.includes(value), 'la entrada contiene ' + value);
    });
  });
});

test('D-15: un cambio de plantilla entre fases cancela todo sin envíos ni escrituras', () => {
  const { ctx, fixture, fake } = setup();
  const { result } = runSend(ctx, fake, fixture, () => fake.setTemplate({ subject: 'Changed {{Reference}}' }));

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);
  assert.equal(result.sent, 0);
  assert.match(result.stoppedReason, /plantilla/);
  assert.deepEqual(plain(fake.calls.lockCalls).pop(), { op: 'release' });
});

test('D-15: errores globales en la Fase B cancelan todo sin envíos ni escrituras', () => {
  const { ctx, fixture, fake } = setup();
  // El alias configurado se quita de la cuenta entre la confirmación y el envío.
  const config = { ...fixture.config, from: 'alias@example.test' };
  const startedAt = fake.deps.clock.now();
  const prepared = ctx.prepareSend_(fake.deps, config);
  assert.equal(prepared.confirmed.rows.size, 3);
  fixture.gmail.aliases = [];
  const result = ctx.executeSend_(fake.deps, config, prepared, startedAt);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);
  assert.notEqual(result.stoppedReason, '');
});

test('Fase B paso 8: una fila insertada arriba durante el envío no recibe Email Sent', () => {
  const hooks = {};
  const { ctx, fixture, fake } = setup({ hooks });
  let inserted = false;
  hooks.afterSend = () => {
    if (!inserted) {
      inserted = true;
      fake.insertRowAbove(2, buildRow({ 'Email Address': 'new@example.test', 'First Name': 'New', Reference: 'REF-9' }));
    }
  };
  const { result } = runSend(ctx, fake, fixture);

  assert.deepEqual(sentTo(fake), [EMAILS[2]]);
  assert.equal(result.sent, 1);
  assert.deepEqual(plain(fake.calls.statusWrites).map((w) => [w.rowNumber, w.value]), [[2, 'ENVIANDO']]);
  // La fila insertada sigue vacía y la original (ahora en la fila 3) quedó ENVIANDO.
  assert.equal(status(fake, 2), '');
  assert.equal(status(fake, 3), 'ENVIANDO');
  assert.equal(fake.getCell(3, 'Email Address'), EMAILS[2]);
  assert.deepEqual(plain(result.review).map((row) => row.rowNumber), [2]);
  assert.match(plain(result.review)[0].reason, /cambió de posición/);
  assert.notEqual(result.stoppedReason, '');
  assert.ok(fake.calls.logEntries.some((entry) => entry.rowNumber === 2 && entry.result === 'REVISAR'));
});

test('D-18: una falla del registro no detiene los envíos y el resumen la menciona', () => {
  const { ctx, fixture, fake } = setup({ failOn: { appendLog: true } });
  const { result } = runSend(ctx, fake, fixture);

  assert.equal(fake.calls.sent.length, 3);
  assert.equal(result.sent, 3);
  assert.equal(result.stoppedReason, '');
  assert.equal(result.logErrors, 3);
  for (const row of [2, 3, 4]) {
    assert.equal(status(fake, row), 'Email Sent');
  }
  assert.match(ctx.formatSendSummary_(result), /registro/);
});

test('D-13: formatSendSummary_ informa omitidas, revisión y corte sin decir "entregados"', () => {
  const { ctx } = setup();
  const summary = ctx.formatSendSummary_({
    campaignId: 'c123',
    sent: 1,
    skipped: [{ rowNumber: 3, reason: CHANGED }],
    review: [{ rowNumber: 4, reason: 'Gmail no aceptó el envío' }],
    stoppedReason: 'Se agotó la cuota',
    logErrors: 2,
  });
  assert.match(summary, /c123/);
  assert.match(summary, /1 correo aceptado por Gmail/);
  assert.match(summary, /Fila 3: Cambió después de la confirmación/);
  assert.match(summary, /Fila 4: Gmail no aceptó el envío/);
  assert.match(summary, /Se agotó la cuota/);
  assert.match(summary, /registro/);
  assert.doesNotMatch(summary, /entregad/i);
});
