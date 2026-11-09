'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const {
  createCampaignFixture,
  buildRow,
  fileLink,
  DRIVE_IDS,
  ALIAS_EMAIL,
} = require('./fixtures/campaign');

function setup(options) {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();
  const fake = createFakeDeps(fixture, options);
  return { ctx, fixture, fake };
}

function validRowNumbers(report) {
  return plain(report.valid.map((row) => row.rowNumber));
}

function invalidRow(report, rowNumber) {
  return report.invalid.find((row) => row.rowNumber === rowNumber);
}

function assertNoSideEffects(fake) {
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);
}

test('AC-27: buildPreflight_ es de solo lectura y devuelve las filas elegibles', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(4, 'Mail Merge Status', 'Email Sent');
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assertNoSideEffects(fake);
  assert.equal(report.ok, true);
  assert.deepEqual(plain(report.globalErrors), []);
  assert.deepEqual(validRowNumbers(report), [2, 3]);
  assert.deepEqual(plain(report.excluded), [{ rowNumber: 4, reason: 'estado: Email Sent' }]);
  assert.deepEqual(plain(report.invalid), []);
  assert.deepEqual(plain(report.sheet), { id: 101, name: 'Recipients' });
  assert.deepEqual(plain(report.template), { id: 'draft-001', subject: 'Notice {{Reference}}' });
  assert.equal(report.templateData.subject, 'Notice {{Reference}}');
  assert.equal(report.templateData.attachments[0].name, 'common-terms.pdf');
  assert.equal(report.headers.columns.email, 0);
  assert.equal(report.headers.byName.Reference, 2);
  assert.equal(report.from, 'operator@example.test');
  assert.equal(report.replyTo, '');
  assert.equal(typeof report.templateKey, 'string');
  assert.equal(report.quotaRemaining, 100);

  const alpha = report.valid[0];
  assert.equal(alpha.email, 'alpha@example.test');
  assert.equal(alpha.key, ctx.rowKey_(fixture.sheets[0].values[1]));
  assert.deepEqual(plain(alpha.values), plain(fixture.sheets[0].values[1]));
});

test('AC-03: un marcador desconocido en la plantilla es error global y no deja filas válidas', () => {
  const { ctx, fixture, fake } = setup();
  fake.setTemplate({ plainBody: 'Hello {{Not a column}}' });
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.equal(report.ok, false);
  assert.ok(report.globalErrors.some((e) => e.includes('Marcador desconocido: {{Not a column}}')));
  assert.equal(report.valid.length, 0);
  assertNoSideEffects(fake);
});

test('AC-07: un adjunto inexistente o sin acceso invalida solo esa fila', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(2, 'File Attachments', fileLink(DRIVE_IDS.MISSING));
  fixture.drive.files[DRIVE_IDS.PDF_BETA].noAccess = true;
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.equal(report.ok, true);
  assert.deepEqual(validRowNumbers(report), [4]);
  for (const rowNumber of [2, 3]) {
    const row = invalidRow(report, rowNumber);
    assert.ok(row, 'la fila ' + rowNumber + ' debería ser inválida');
    assert.ok(row.reasons.some((r) => r.includes('No se pudo acceder al archivo adjunto n.º 1')));
    for (const reason of row.reasons) {
      assert.ok(!reason.includes('drive.google.com'));
      assert.ok(!reason.includes(DRIVE_IDS.MISSING) && !reason.includes(DRIVE_IDS.PDF_BETA));
    }
  }
  assertNoSideEffects(fake);
});

test('AC-07: un adjunto en la papelera o de tipo no soportado invalida la fila', () => {
  const { ctx, fixture, fake } = setup();
  fixture.drive.files[DRIVE_IDS.PDF_ALPHA].trashed = true;
  fixture.drive.files[DRIVE_IDS.PDF_BETA].mimeType = 'application/vnd.google-apps.form';
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.deepEqual(validRowNumbers(report), [4]);
  assert.ok(invalidRow(report, 2).reasons.some((r) => r.includes('papelera')));
  assert.ok(invalidRow(report, 3).reasons.some((r) => r.includes('tipo no soportado')));
});

test('AC-09: adjuntos binarios más comunes por encima del límite invalidan la fila', () => {
  const { ctx, fixture, fake } = setup();
  // Comunes: 3000. Alpha: 1000 (el nativo cuenta recién al exportarlo). Beta: 2000.
  vm.runInContext('LIMITS.MAX_TOTAL_ATTACHMENT_BYTES = 4500', ctx);
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.deepEqual(validRowNumbers(report), [2, 4]);
  const beta = invalidRow(report, 3);
  assert.ok(beta.reasons.some((r) => r.includes('Los adjuntos suman') && r.includes('máximo por correo')));
  assertNoSideEffects(fake);
});

test('AC-12: un encabezado duplicado es error global', () => {
  const { ctx, fixture, fake } = setup();
  fixture.sheets[0].values[0][1] = 'Reference';
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.equal(report.ok, false);
  assert.ok(report.globalErrors.some((e) => e.includes('aparece más de una vez')));
  assert.equal(report.valid.length, 0);
});

test('AC-13: un destinatario inválido o vacío invalida solo esa fila', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(2, 'Email Address', 'alpha@example.test, beta@example.test');
  fake.setCell(3, 'Email Address', '');
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.deepEqual(validRowNumbers(report), [4]);
  assert.ok(invalidRow(report, 2).reasons.some((r) => r.includes('Email Address no es válida')));
  assert.ok(invalidRow(report, 3).reasons.includes('Falta Email Address'));
});

test('AC-14: un remitente fuera de la cuenta y sus alias es error global', () => {
  const { ctx, fixture, fake } = setup();
  const report = ctx.buildPreflight_(fake.deps, { ...fixture.config, from: 'intruder@example.test' });

  assert.equal(report.ok, false);
  assert.ok(report.globalErrors.some((e) => e.includes('no está autorizado')));
  assert.equal(report.valid.length, 0);

  const withAlias = ctx.buildPreflight_(fake.deps, { ...fixture.config, from: ALIAS_EMAIL });
  assert.equal(withAlias.ok, true);
  assert.equal(withAlias.from, ALIAS_EMAIL);
});

test('R-04: un Reply-To inválido es error global', () => {
  const { ctx, fixture, fake } = setup();
  const report = ctx.buildPreflight_(fake.deps, { ...fixture.config, replyTo: 'no es una dirección' });
  assert.equal(report.ok, false);
  assert.ok(report.globalErrors.some((e) => e.includes('Reply-To')));
  assert.equal(report.valid.length, 0);
});

test('D-21: un cuerpo renderizado por encima de MAX_BODY_BYTES invalida la fila', () => {
  const { ctx, fixture, fake } = setup();
  vm.runInContext('LIMITS.MAX_BODY_BYTES = 400', ctx);
  fake.setCell(2, 'First Name', 'x'.repeat(300));
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.deepEqual(validRowNumbers(report), [3, 4]);
  assert.ok(
    invalidRow(report, 2).reasons.some((r) => r.includes('El cuerpo del correo supera el tamaño máximo permitido'))
  );
});

test('D-22: una cuenta sin dirección identificable es error global', () => {
  const { ctx, fixture, fake } = setup({ userEmail: '' });
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.equal(report.ok, false);
  assert.ok(report.globalErrors.includes('No se pudo identificar la cuenta que ejecuta'));
  assert.equal(report.valid.length, 0);
});

test('R-02: configuración incompleta, pestaña borrada o borrador borrado son errores globales', () => {
  const { ctx, fixture, fake } = setup();

  const incomplete = ctx.buildPreflight_(fake.deps, { ...fixture.config, draftId: '' });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.globalErrors.some((e) => e.includes('configuración de la campaña está incompleta')));
  const missingConfig = ctx.buildPreflight_(fake.deps, null);
  assert.equal(missingConfig.ok, false);

  const noDraft = ctx.buildPreflight_(fake.deps, { ...fixture.config, draftId: 'draft-borrado' });
  assert.equal(noDraft.ok, false);
  assert.ok(noDraft.globalErrors.some((e) => e.includes('borrador configurado')));
  assert.equal(noDraft.valid.length, 0);

  fixture.sheets.splice(0, 1);
  const noSheet = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.equal(noSheet.ok, false);
  assert.ok(
    noSheet.globalErrors.includes('La pestaña configurada ya no existe; volvé a configurar la campaña')
  );
  assert.equal(noSheet.valid.length, 0);
  assertNoSideEffects(fake);
});

test('R-02: una imagen inline sin emparejar es error global', () => {
  const { ctx, fixture, fake } = setup();
  fake.setTemplate({ inlineImages: [] });
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.equal(report.ok, false);
  assert.ok(report.globalErrors.some((e) => e.includes('cid:logo')));
  assert.equal(report.valid.length, 0);
});

test('D-15: templateKey cambia si cambia el asunto o el Reply-To', () => {
  const { ctx, fixture, fake } = setup();
  const base = ctx.buildPreflight_(fake.deps, fixture.config).templateKey;
  assert.equal(ctx.buildPreflight_(fake.deps, fixture.config).templateKey, base);

  const otherReplyTo = ctx.buildPreflight_(fake.deps, { ...fixture.config, replyTo: 'reply@example.test' });
  assert.notEqual(otherReplyTo.templateKey, base);

  fake.setTemplate({ subject: 'Updated {{Reference}}' });
  assert.notEqual(ctx.buildPreflight_(fake.deps, fixture.config).templateKey, base);
});

test('D-23: attachmentNames sigue el orden de la celda sin llamadas extra a Drive', () => {
  const { ctx, fixture, fake } = setup();
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.deepEqual(plain(report.valid.map((row) => row.attachmentNames)), [
    ['alpha-notice.pdf', 'Alpha Letter'],
    ['beta-notice.pdf'],
    [],
  ]);
  assert.deepEqual(plain(fake.calls.driveCalls), [
    { op: 'getFileInfo', id: DRIVE_IDS.PDF_ALPHA },
    { op: 'getFileInfo', id: DRIVE_IDS.DOC_ALPHA },
    { op: 'getFileInfo', id: DRIVE_IDS.PDF_BETA },
  ]);
});

test('D-23: formatRowReview_ muestra adjuntos comunes y destinatario con nombres, sin URLs ni IDs', () => {
  const { ctx, fixture, fake } = setup();
  fixture.drive.files[DRIVE_IDS.PDF_ALPHA].name = 'alpha\nnotice.pdf';
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  const text = ctx.formatRowReview_(report);
  const lines = text.split('\n');

  assert.equal(lines[0], 'Adjuntos comunes: common-terms.pdf');
  assert.equal(lines[1], 'Fila 2 → alpha@example.test: alpha notice.pdf, Alpha Letter');
  assert.equal(lines[2], 'Fila 3 → beta@example.test: beta-notice.pdf');
  assert.equal(lines[3], 'Fila 4 → gamma@example.test (sin adjuntos propios)');
  assert.equal(lines.length, 4);
  assert.ok(!text.includes('drive.google.com'));
  assert.ok(!text.includes('docs.google.com'));
  for (const id of Object.values(DRIVE_IDS)) {
    assert.ok(!text.includes(id));
  }
  // Ningún valor de otras columnas.
  assert.ok(!text.includes('REF-001') && !text.includes('Alpha,'));
});

test('D-23: formatRowReview_ muestra 20 filas y luego "y N filas más"', () => {
  const { ctx, fixture, fake } = setup();
  fake.setTemplate({ attachments: [] });
  for (let i = 0; i < 22; i++) {
    fake.appendRow(buildRow({ 'Email Address': 'row' + i + '@example.test', 'First Name': 'N', Reference: 'R' }));
  }
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.equal(report.valid.length, 25);
  const lines = ctx.formatRowReview_(report).split('\n');

  assert.equal(lines[0], 'Adjuntos comunes: ninguno');
  assert.equal(lines.filter((line) => /^Fila \d+ → /.test(line)).length, 20);
  assert.equal(lines[lines.length - 1], 'y 5 filas más');
  assert.equal(ctx.formatRowReview_(report, 30).split('\n').length, 26);
});

test('formatPreflightReport_ resume la campaña y limita las filas inválidas a 20', () => {
  const { ctx, fixture, fake } = setup();
  for (let i = 0; i < 25; i++) {
    fake.appendRow(buildRow({ 'Email Address': 'not-an-email-' + i, 'First Name': 'N', Reference: 'R' }));
  }
  fake.appendRow(buildRow({ 'Email Address': 'skip@example.test', 'Mail Merge Status': 'SKIP' }));
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.equal(report.invalid.length, 25);
  const text = ctx.formatPreflightReport_(report);

  assert.ok(text.includes('Pestaña: Recipients'));
  assert.ok(text.includes('Notice {{Reference}}'));
  assert.ok(text.includes('Remitente: operator@example.test'));
  assert.ok(text.includes('Filas válidas: 3'));
  assert.ok(text.includes('Filas inválidas: 25'));
  assert.ok(text.includes('Filas excluidas: 1'));
  assert.ok(text.includes('estado: SKIP: 1'));
  assert.ok(text.includes('Cuota diaria disponible: 100'));
  assert.ok(text.includes(ctx.formatRowReview_(report)));
  assert.equal(text.split('\n').filter((line) => /^Fila \d+: /.test(line)).length, 20);
  assert.ok(text.includes('y 5 filas más'));
  assertNoSideEffects(fake);
});

test('formatPreflightReport_ muestra los errores globales', () => {
  const { ctx, fixture, fake } = setup({ userEmail: '' });
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  const text = ctx.formatPreflightReport_(report);
  assert.ok(text.includes('No se pudo identificar la cuenta que ejecuta'));
});
