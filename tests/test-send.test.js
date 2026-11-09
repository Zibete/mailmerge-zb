'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, plain, isDate } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const {
  createCampaignFixture,
  buildRow,
  fileLink,
  DRIVE_IDS,
  USER_EMAIL,
} = require('./fixtures/campaign');

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

test('AC-15: runTestSend_ envía una vez el mismo mensaje del envío real, salvo destinatario y prefijo', () => {
  const { ctx, fixture, fake } = setup();
  const expected = plain(buildFor(ctx, fake, fixture, 2).message);
  const result = ctx.runTestSend_(fake.deps, fixture.config, 2);

  assert.equal(result.ok, true, JSON.stringify(plain(result.errors)));
  assert.equal(result.to, USER_EMAIL);
  assert.equal(fake.calls.sent.length, 1);
  const sent = plain(fake.calls.sent[0]);
  assert.deepEqual(sent, { ...expected, to: USER_EMAIL, subject: '[PRUEBA] ' + expected.subject });
  assert.equal(fake.calls.statusWrites.length, 0);

  assert.equal(fake.calls.logEntries.length, 1);
  const entry = fake.calls.logEntries[0];
  assert.equal(entry.result, 'PRUEBA');
  assert.equal(entry.rowNumber, 2);
  assert.equal(entry.sheetName, 'Recipients');
  assert.equal(entry.recipient, USER_EMAIL);
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
  assert.ok(!JSON.stringify(entry).includes('drive.google.com'));
  assert.ok(!JSON.stringify(entry).includes('REF-001'));
});

test('AC-16: una prueba con un adjunto faltante falla cerrado sin enviar ni cambiar estado', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(2, 'File Attachments', fileLink(DRIVE_IDS.PDF_ALPHA) + ', ' + fileLink(DRIVE_IDS.MISSING));
  const before = statusColumn(fixture);
  const result = ctx.runTestSend_(fake.deps, fixture.config, 2);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('No se pudo acceder al archivo adjunto n.º 2')));
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.deepEqual(statusColumn(fixture), before);
});

test('AC-16: una falla de Drive al exportar el adjunto bloquea la prueba', () => {
  const { ctx, fixture, fake } = setup();
  // Se pierde el acceso entre la lectura de la información y la exportación.
  const originalGetAttachment = fake.deps.drive.getAttachment;
  fake.deps.drive.getAttachment = (info) => {
    if (info.id === DRIVE_IDS.DOC_ALPHA) {
      throw new Error('sin acceso');
    }
    return originalGetAttachment(info);
  };
  const result = ctx.runTestSend_(fake.deps, fixture.config, 2);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.sent.length, 0);
});

test('D-07: runTestSend_ rechaza la fila 1, filas fuera de rango y filas vacías sin enviar', () => {
  const { ctx, fixture, fake } = setup();
  fake.insertRowAbove(3, buildRow({}));

  for (const rowNumber of [1, 0, 6, 99, 2.5, 3]) {
    const result = ctx.runTestSend_(fake.deps, fixture.config, rowNumber);
    assert.equal(result.ok, false, 'fila ' + rowNumber);
    assert.ok(result.errors.length > 0);
  }
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);
});

test('D-07: runTestSend_ envía con una fila no elegible (Email Sent) sin tocar su estado', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(3, 'Resultado', 'Email Sent');
  const result = ctx.runTestSend_(fake.deps, fixture.config, 3);

  assert.equal(result.ok, true, JSON.stringify(plain(result.errors)));
  assert.equal(fake.calls.sent.length, 1);
  assert.equal(fake.calls.sent[0].subject, '[PRUEBA] Notice REF-002');
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.getCell(3, 'Resultado'), 'Email Sent');
});

test('D-22: sin cuenta identificable la prueba no envía', () => {
  const { ctx, fixture, fake } = setup({ userEmail: '' });
  const result = ctx.runTestSend_(fake.deps, fixture.config, 2);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('No se pudo identificar la cuenta que ejecuta'));
  assert.equal(fake.calls.sent.length, 0);
});

test('AC-14: con errores globales la prueba no envía', () => {
  const { ctx, fixture, fake } = setup();
  const result = ctx.runTestSend_(fake.deps, { ...fixture.config, from: 'intruder@example.test' }, 2);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.sent.length, 0);
});

test('D-18: si el registro falla, la prueba sigue ok e informa la falla', () => {
  const { ctx, fixture, fake } = setup({ failOn: { appendLog: true } });
  const result = ctx.runTestSend_(fake.deps, fixture.config, 4);

  assert.equal(result.ok, true);
  assert.equal(result.logErrors, 1);
  assert.equal(fake.calls.sent.length, 1);
  assert.equal(fake.calls.logEntries.length, 0);
});

test('D-18: appendLogSafe_ devuelve true o false y deja solo los campos permitidos', () => {
  const { ctx, fake } = setup();
  const ok = ctx.appendLogSafe_(fake.deps, {
    date: new Date(0),
    campaignId: 'c1',
    sheetName: 'Recipients',
    rowNumber: 2,
    recipient: 'alpha@example.test',
    result: 'PRUEBA',
    detail: 'x',
    body: 'no debe registrarse',
  });
  assert.equal(ok, true);
  assert.deepEqual(Object.keys(fake.calls.logEntries[0]).sort(), [
    'campaignId',
    'date',
    'detail',
    'recipient',
    'result',
    'rowNumber',
    'sheetName',
  ]);

  const failing = createFakeDeps(createCampaignFixture(), { failOn: { appendLog: true } });
  assert.equal(ctx.appendLogSafe_(failing.deps, { result: 'PRUEBA' }), false);
});

test('Gmail que lanza en la prueba devuelve error sin escribir estado', () => {
  const { ctx, fixture, fake } = setup({ failOn: { send: true } });
  const result = ctx.runTestSend_(fake.deps, fixture.config, 2);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
});
