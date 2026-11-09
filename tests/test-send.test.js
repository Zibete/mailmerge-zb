'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, plain, isDate } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const { createCampaignFixture, fileLink, DRIVE_IDS, USER_EMAIL } = require('./fixtures/campaign');

const CONF_PREFIX = 'MM_CONF_';
const TEST_DETAIL =
  'PRUEBA enviada a tu cuenta (' + USER_EMAIL + '); el destinatario real no recibió este correo. ' +
  'Para enviárselo, borrá Resultado';
const WRONG_KIND_MESSAGE = 'La confirmación no corresponde a esta operación; volvé a revisar';
const WRONG_USER_MESSAGE = 'La confirmación pertenece a otra cuenta; volvé a revisar';
const CONSENT_MESSAGE = 'Falta el consentimiento para reemplazar Fecha, Campaña o Detalle; volvé a revisar y confirmar';

function setup(options) {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();
  const fake = createFakeDeps(fixture, options);
  return { ctx, fixture, fake };
}

// Arma el mensaje de una fila con el mismo informe que usaría el envío real.
function buildFor(ctx, fake, fixture, rowNumber) {
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  const values = fixture.sheets[0].values[rowNumber - 1].slice();
  return ctx.buildMessage_(fake.deps, report.templateData, { rowNumber, values }, report.headers, fixture.config);
}

function statusColumn(fixture) {
  return fixture.sheets[0].values.map((row) => row[6]);
}

test('AC-05 / AC-06 / AC-08: buildMessage_ adjunta el común y exactamente los archivos de la fila', () => {
  const { ctx, fixture, fake } = setup();
  const built = buildFor(ctx, fake, fixture, 2);

  assert.equal(built.ok, true, JSON.stringify(plain(built.errors)));
  const message = plain(built.message);
  assert.deepEqual(message.attachments, [
    { name: 'common-terms.pdf', mimeType: 'application/pdf', size: 3000, blob: { fakeBlob: 'pdf-common' } },
    { name: 'alpha-notice.pdf', mimeType: 'application/pdf', size: 1000, blob: { fakeBlob: 'pdf-alpha' } },
    { name: 'Alpha Letter.pdf', mimeType: 'application/pdf', size: 1500, blob: { fakeBlob: 'doc-alpha-pdf' } },
  ]);
  assert.ok(!JSON.stringify(message).includes('pdf-beta'));
  assert.equal(message.to, 'alpha@example.test');
  assert.equal(message.subject, 'Notice REF-001');
  assert.equal(message.plainBody, 'Hello Alpha, this is notice REF-001.');
  assert.ok(message.htmlBody.includes('Hello Alpha'));
  assert.deepEqual(message.inlineImages, { logo: { fakeBlob: 'img-logo' } });
  assert.equal(message.from, USER_EMAIL);
  assert.equal(message.replyTo, '');

  const beta = plain(buildFor(ctx, fake, fixture, 3).message);
  assert.deepEqual(
    beta.attachments.map((a) => a.name),
    ['common-terms.pdf', 'beta-notice.pdf']
  );
  assert.equal(fake.calls.sent.length, 0);
});

test('AC-09: buildMessage_ controla el tamaño total con el PDF exportado', () => {
  const { ctx, fixture, fake } = setup();
  // Comunes 3000 + alpha 1000 + nativo exportado 1500 = 5500.
  require('node:vm').runInContext('LIMITS.MAX_TOTAL_ATTACHMENT_BYTES = 5000', ctx);
  const built = buildFor(ctx, fake, fixture, 2);
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes('Los adjuntos suman')));
});

// Prueba V2 (D-40): `prepareConfirmation_` (test) → mutación opcional entre
// fases → `executeConfirmed_` (test). Devuelve la preparación y la
// `SendResultView`, normalizadas con `plain`.
function runTrial(ctx, fake, rowNumber, between, overwriteConsent) {
  const prep = plain(ctx.prepareConfirmation_(fake.deps, 'test', rowNumber));
  if (between) {
    between(prep);
  }
  const result = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'test', overwriteConsent));
  return { prep, result };
}

function resultWrites(fake) {
  return plain(fake.calls.cellWrites).map((write) => [write.rowNumber, write.cells[write.cells.length - 1].value]);
}

function assertTrialRejected(fake, prep) {
  assert.equal(prep.ok, false);
  assert.equal(prep.token, '');
  assert.ok(prep.errors.length > 0);
  assert.equal(fake.calls.cachePuts.length, 0);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
}

test('AC-15: la prueba V2 envía una vez el mismo mensaje del envío real, salvo destinatario y prefijo', () => {
  const { ctx, fixture, fake } = setup();
  const expected = plain(buildFor(ctx, fake, fixture, 2).message);
  const { prep, result } = runTrial(ctx, fake, 2);

  assert.equal(prep.ok, true, JSON.stringify(prep.errors));
  assert.equal(prep.view.to, USER_EMAIL);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.kind, 'test');
  assert.equal(fake.calls.sent.length, 1);
  const sent = plain(fake.calls.sent[0]);
  assert.deepEqual(sent, { ...expected, to: USER_EMAIL, subject: '[PRUEBA] ' + expected.subject });

  // Mismo motor: consumo del token, lock, claim ENVIANDO → send → Email Sent.
  assert.ok(fake.calls.cacheRemoves.includes(CONF_PREFIX + prep.token));
  assert.deepEqual(plain(fake.calls.lockCalls), [{ op: 'tryLock', ms: 10000 }, { op: 'release' }]);
  assert.deepEqual(resultWrites(fake), [
    [2, 'ENVIANDO'],
    [2, 'Email Sent'],
  ]);
  assert.deepEqual(result.counts, { total: 1, processed: 1, sent: 1, skipped: 0, review: 0, pending: 0 });
  assert.deepEqual(result.rows, [{ rowNumber: 2, recipient: USER_EMAIL, result: 'Email Sent', detail: TEST_DETAIL }]);
});

test('AC-47 / D-40 / AC-54 / D-47: la prueba deja Email Sent; tras borrar Resultado el envío real exige consentimiento y reemplaza los metadatos', () => {
  const { ctx, fake } = setup();
  const DEFAULT_NOW = fake.deps.clock.now();
  const trial = runTrial(ctx, fake, 2);
  assert.equal(trial.result.ok, true);
  assert.equal(fake.getCell(2, 'Resultado'), 'Email Sent');
  assert.equal(fake.getCell(2, 'Detalle'), TEST_DETAIL);
  assert.equal(fake.getCell(2, 'Campaña'), trial.prep.view.campaign);
  assert.equal(fake.getCell(2, 'Campaña'), 'camp0001');
  assert.ok(isDate(fake.getCell(2, 'Fecha')));

  // Una preparación de envío posterior excluye la fila probada.
  const afterTrial = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
  assert.equal(afterTrial.ok, true);
  assert.equal(afterTrial.view.count, 2);
  assert.deepEqual(afterTrial.view.rows.map((row) => row.rowNumber), [3, 4]);

  // Con Resultado vacío vuelve a entrar, con consentimiento obligatorio.
  fake.setCell(2, 'Resultado', '');
  const noConsent = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
  assert.equal(noConsent.ok, true);
  assert.equal(noConsent.view.count, 3);
  assert.deepEqual(noConsent.view.overwriteRows, [{ rowNumber: 2, columns: ['Fecha', 'Campaña', 'Detalle'] }]);
  assert.equal(noConsent.view.consentRequired, true);
  const writesBefore = fake.calls.cellWrites.length;
  const rejected = plain(ctx.executeConfirmed_(fake.deps, noConsent.token, 'send'));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.stoppedReason, CONSENT_MESSAGE);
  assert.equal(fake.calls.sent.length, 1);
  assert.equal(fake.calls.cellWrites.length, writesBefore);
  assert.equal(fake.getCell(2, 'Detalle'), TEST_DETAIL);

  // Con el consentimiento, el correo real va al destinatario sin prefijo.
  fake.setNow(DEFAULT_NOW + 60000);
  const withConsent = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
  assert.equal(withConsent.view.consentRequired, true);
  const real = plain(ctx.executeConfirmed_(fake.deps, withConsent.token, 'send', true));
  assert.equal(real.ok, true, JSON.stringify(real));
  assert.deepEqual(real.rows.map((row) => [row.rowNumber, row.result]), [
    [2, 'Email Sent'],
    [3, 'Email Sent'],
    [4, 'Email Sent'],
  ]);
  const toAlpha = fake.calls.sent.filter((message) => message.to === 'alpha@example.test');
  assert.equal(toAlpha.length, 1);
  assert.equal(toAlpha[0].subject, 'Notice REF-001');
  assert.equal(fake.getCell(2, 'Resultado'), 'Email Sent');
  assert.equal(fake.getCell(2, 'Detalle'), 'Aceptado por Gmail');
  assert.equal(fake.getCell(2, 'Campaña'), real.campaign);
  assert.notEqual(real.campaign, 'camp0001');
  assert.equal(fake.getCell(2, 'Fecha').getTime(), DEFAULT_NOW + 60000);
});

test('AC-16: una prueba con un adjunto faltante falla al preparar, sin token ni envío', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(2, 'File Attachments', fileLink(DRIVE_IDS.PDF_ALPHA) + ', ' + fileLink(DRIVE_IDS.MISSING));
  const before = statusColumn(fixture);
  const prep = plain(ctx.prepareConfirmation_(fake.deps, 'test', 2));

  assertTrialRejected(fake, prep);
  assert.ok(prep.errors.some((e) => e.includes('No se pudo acceder al archivo adjunto n.º 2')), JSON.stringify(prep.errors));
  assert.deepEqual(statusColumn(fixture), before);
});

test('AC-16: una falla de Drive entre la preparación y la ejecución bloquea la prueba sin cambiar Resultado', () => {
  const failOn = {};
  const { ctx, fixture, fake } = setup({ failOn });
  const before = statusColumn(fixture);
  const { prep, result } = runTrial(ctx, fake, 2, () => {
    failOn.getFileInfo = { id: DRIVE_IDS.PDF_ALPHA };
  });

  assert.equal(prep.ok, true);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.deepEqual(result.rows.map((row) => [row.rowNumber, row.result]), [[2, 'OMITIDA']]);
  assert.deepEqual(statusColumn(fixture), before);
});

test('AC-16: una falla de Drive al exportar el adjunto en la ejecución bloquea la prueba', () => {
  const { ctx, fixture, fake } = setup();
  const before = statusColumn(fixture);
  const { prep, result } = runTrial(ctx, fake, 2, () => {
    // Se pierde el acceso entre la lectura de la información y la exportación.
    const originalGetAttachment = fake.deps.drive.getAttachment;
    fake.deps.drive.getAttachment = (info) => {
      if (info.id === DRIVE_IDS.DOC_ALPHA) {
        throw new Error('sin acceso');
      }
      return originalGetAttachment(info);
    };
  });

  assert.equal(prep.ok, true);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.deepEqual(result.rows.map((row) => [row.rowNumber, row.result]), [[2, 'OMITIDA']]);
  assert.deepEqual(statusColumn(fixture), before);
});

test('D-40: Gmail que lanza en la prueba deja la fila REVISAR con Detalle, un solo intento y detención', () => {
  const { ctx, fake } = setup({ failOn: { send: true } });
  const { result } = runTrial(ctx, fake, 2);

  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.sequence.filter((step) => step.type === 'send-failed').length, 1);
  assert.equal(fake.getCell(2, 'Resultado'), 'REVISAR');
  assert.match(fake.getCell(2, 'Detalle'), /Gmail lanzó una excepción/);
  assert.deepEqual(resultWrites(fake), [
    [2, 'ENVIANDO'],
    [2, 'REVISAR'],
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((row) => [row.rowNumber, row.recipient, row.result]), [[2, USER_EMAIL, 'REVISAR']]);
  assert.deepEqual(result.counts, { total: 1, processed: 1, sent: 0, skipped: 0, review: 1, pending: 0 });
  assert.notEqual(result.stoppedReason, '');
});

test('D-22: sin cuenta identificable la prueba no se prepara ni envía', () => {
  const { ctx, fake } = setup({ userEmail: '' });
  const prep = plain(ctx.prepareConfirmation_(fake.deps, 'test', 2));
  assertTrialRejected(fake, prep);
  assert.ok(prep.errors.includes('No se pudo identificar la cuenta que ejecuta'));
});

test('AC-14: con errores globales la prueba no se prepara ni envía', () => {
  const { ctx, fixture, fake } = setup();
  fixture.config.from = 'intruder@example.test';
  const prep = plain(ctx.prepareConfirmation_(fake.deps, 'test', 2));
  assertTrialRejected(fake, prep);
});

test('D-22 / AC-14: otra cuenta al ejecutar la prueba → cero envíos ni escrituras', () => {
  const { ctx, fixture, fake } = setup();
  const prep = plain(ctx.prepareConfirmation_(fake.deps, 'test', 2));
  assert.equal(prep.ok, true);
  const other = createFakeDeps(fixture, { userEmail: 'other@example.test' });
  const result = plain(ctx.executeConfirmed_(other.deps, prep.token, 'test'));

  assert.equal(result.ok, false);
  assert.equal(result.stoppedReason, WRONG_USER_MESSAGE);
  assert.equal(other.calls.sent.length, 0);
  assert.equal(other.calls.cellWrites.length, 0);
  assert.equal(fake.getCell(2, 'Resultado'), '');
});

test('D-40: una confirmación de prueba cuyo testTo no es la cuenta que ejecuta cancela todo sin envíos', () => {
  const { ctx, fake } = setup();
  const { result } = runTrial(ctx, fake, 2, (prep) => {
    const snapshot = JSON.parse(fake.fixture.cache[CONF_PREFIX + prep.token]);
    snapshot.testTo = 'other@example.test';
    fake.setCacheValue(CONF_PREFIX + prep.token, JSON.stringify(snapshot));
  });

  assert.equal(result.ok, false);
  assert.equal(result.stoppedReason, 'La cuenta que ejecuta no es la de la prueba; no se envió nada');
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.equal(fake.calls.cachePuts.filter((put) => put.key.startsWith('MM_PROG_')).length, 0);
});

test('AC-54 / D-47: la prueba sobre una fila con metadatos exige overwriteConsent === true', () => {
  const { ctx, fake } = setup();
  fake.setCell(2, 'Detalle', 'Nota anterior');
  const rejected = runTrial(ctx, fake, 2);
  assert.equal(rejected.prep.view.consentRequired, true);
  assert.deepEqual(rejected.prep.view.overwriteRows, [{ rowNumber: 2, columns: ['Detalle'] }]);
  assert.equal(rejected.result.ok, false);
  assert.equal(rejected.result.stoppedReason, CONSENT_MESSAGE);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.getCell(2, 'Detalle'), 'Nota anterior');

  const accepted = runTrial(ctx, fake, 2, null, true);
  assert.equal(accepted.result.ok, true);
  assert.equal(fake.calls.sent.length, 1);
  assert.equal(fake.calls.sent[0].to, USER_EMAIL);
  assert.equal(fake.getCell(2, 'Detalle'), TEST_DETAIL);
});

test('AC-35: un token de prueba ejecutado como envío y un token de envío ejecutado como prueba → rechazo sin envíos', () => {
  {
    const { ctx, fake } = setup();
    const prep = plain(ctx.prepareConfirmation_(fake.deps, 'test', 2));
    const result = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'send'));
    assert.equal(result.ok, false);
    assert.equal(result.stoppedReason, WRONG_KIND_MESSAGE);
    assert.equal(fake.calls.sent.length, 0);
    assert.equal(fake.calls.cellWrites.length, 0);
    assert.equal(fake.fixture.cache[CONF_PREFIX + prep.token], undefined);
  }
  {
    const { ctx, fake } = setup();
    const prep = plain(ctx.prepareConfirmation_(fake.deps, 'send'));
    const result = plain(ctx.executeConfirmed_(fake.deps, prep.token, 'test'));
    assert.equal(result.ok, false);
    assert.equal(result.stoppedReason, WRONG_KIND_MESSAGE);
    assert.equal(fake.calls.sent.length, 0);
    assert.equal(fake.calls.cellWrites.length, 0);
    assert.equal(fake.fixture.cache[CONF_PREFIX + prep.token], undefined);
  }
});
