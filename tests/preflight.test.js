'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const {
  createCampaignFixture,
  createLegacyFixture,
  buildRow,
  fileLink,
  DRIVE_IDS,
  ALIAS_EMAIL,
} = require('./fixtures/campaign');

function setup(options, createFixture = createCampaignFixture) {
  const ctx = loadAppsScript();
  const fixture = createFixture();
  const fake = createFakeDeps(fixture, options);
  return { ctx, fixture, fake };
}

function validRowNumbers(report) {
  return plain(report.valid.map((row) => row.rowNumber));
}

function invalidRow(report, rowNumber) {
  return report.invalid.find((row) => row.rowNumber === rowNumber);
}

// AC-27: la validación nunca envía ni escribe celdas de datos ni encabezados.
function assertNoSideEffects(fake) {
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.equal(fake.calls.headerWrites.length, 0);
}

test('AC-27: buildPreflight_ es de solo lectura y devuelve las filas elegibles', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(4, 'Resultado', 'Email Sent');
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assertNoSideEffects(fake);
  assert.equal(report.ok, true);
  assert.deepEqual(plain(report.globalErrors), []);
  assert.deepEqual(validRowNumbers(report), [2, 3]);
  assert.deepEqual(plain(report.excluded), [{ rowNumber: 4, reason: 'resultado: Email Sent' }]);
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
  assert.equal(alpha.key, ctx.rowKey_(fixture.sheets[0].values[1], report.headers.columns));
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
  const incompleteError = incomplete.globalErrors.find((e) => e.includes('configuración de la campaña está incompleta'));
  assert.ok(incompleteError);
  assert.ok(incompleteError.includes('sección "Campaña"'));
  assert.ok(!incompleteError.includes('Configurar campaña'));
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

test('AC-45 / D-35: con encabezados V1 la validación da error global y devuelve el plan de columnas', () => {
  const { ctx, fixture, fake } = setup(undefined, createLegacyFixture);
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.equal(report.ok, false);
  assert.ok(
    report.globalErrors.includes('La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"')
  );
  assert.equal(report.valid.length, 0);
  assert.equal(report.setup.needed, true);
  assert.equal(report.setup.headerKey, JSON.stringify(fixture.sheets[0].values[0]));
  assert.deepEqual(plain(report.setup.renames), [
    { column: 4, from: 'Mail Merge Status', to: 'Resultado' },
    { column: 5, from: 'Scheduled Date', to: 'Fecha' },
  ]);
  assert.deepEqual(plain(report.setup.appends), [
    { column: 6, name: 'Campaña' },
    { column: 7, name: 'Detalle' },
  ]);
  assert.deepEqual(plain(report.setup.errors), []);
  assertNoSideEffects(fake);
});

test('D-35: una pestaña V2 a la que le falta una columna gestionada devuelve el plan con el agregado', () => {
  const { ctx, fixture, fake } = setup();
  // Sin `Detalle` (última columna del fixture).
  fixture.sheets[0].values = fixture.sheets[0].values.map((row) => row.slice(0, 7));
  const report = ctx.buildPreflight_(fake.deps, fixture.config);

  assert.equal(report.ok, false);
  assert.ok(report.globalErrors.includes('Falta el encabezado requerido "Detalle" en la fila 1.'));
  assert.equal(report.setup.needed, true);
  assert.deepEqual(plain(report.setup.renames), []);
  assert.deepEqual(plain(report.setup.appends), [{ column: 7, name: 'Detalle' }]);
  assertNoSideEffects(fake);
});

test('D-35: una pestaña V2 completa no necesita plan de columnas (setup null)', () => {
  const { ctx, fixture, fake } = setup();
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  assert.equal(report.ok, true);
  assert.equal(report.setup, null);

  // Con otros errores globales (sin cuenta) tampoco hay plan.
  const noAccount = setup({ userEmail: '' });
  assert.equal(noAccount.ctx.buildPreflight_(noAccount.fake.deps, noAccount.fixture.config).setup, null);
});

test('AC-45 / D-35: un marcador de columna gestionada es error global exacto en asunto, texto plano o HTML', () => {
  const cases = [
    [{ subject: 'Notice {{Resultado}}' }, ['Resultado']],
    [{ plainBody: 'Hello {{Fecha}}' }, ['Fecha']],
    [{ htmlBody: '<p>{{Detalle}}</p><img src="cid:logo" alt="logo.png">' }, ['Detalle']],
    [{ subject: '{{Campaña}} {{Reference}}', plainBody: 'Hello {{Campaña}} {{Fecha}}' }, ['Campaña', 'Fecha']],
  ];
  for (const [patch, names] of cases) {
    const { ctx, fixture, fake } = setup();
    fake.setTemplate(patch);
    const report = ctx.buildPreflight_(fake.deps, fixture.config);

    assert.equal(report.ok, false);
    assert.deepEqual(
      plain(report.globalErrors),
      names.map((name) => 'La columna "' + name + '" la escribe Mail Merge y no se puede usar como marcador')
    );
    assert.equal(report.valid.length, 0);
    assertNoSideEffects(fake);
  }
});

const VALIDATION_VIEW_KEYS = [
  'ok',
  'globalErrors',
  'setup',
  'sheetName',
  'subject',
  'from',
  'replyTo',
  'quotaRemaining',
  'counts',
  'excludedByReason',
  'commonAttachments',
  'rows',
  'moreRows',
  'invalidRows',
  'moreInvalid',
  'overwriteRows',
].sort();

test('AC-33 / D-42: buildValidationView_ lista todas las filas válidas con destinatario y adjuntos, sin URLs ni IDs', () => {
  const { ctx, fixture, fake } = setup();
  fixture.drive.files[DRIVE_IDS.PDF_ALPHA].name = 'alpha\nnotice.pdf';
  for (let i = 0; i < 22; i++) {
    fake.appendRow(buildRow({ 'Email Address': 'row' + i + '@example.test', 'First Name': 'N', Reference: 'R' }));
  }
  const invalidRowNumber = fake.appendRow(
    buildRow({ 'Email Address': 'not-an-email', 'First Name': 'N', Reference: 'R' })
  );
  const skipRowNumber = fake.appendRow(buildRow({ 'Email Address': 'skip@example.test', Resultado: 'SKIP' }));
  const hiddenRowNumber = fake.appendRow(
    buildRow({ 'Email Address': 'hidden@example.test', 'First Name': 'N', Reference: 'R' })
  );
  fixture.sheets[0].hiddenByUser[hiddenRowNumber - 1] = true;
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  const view = ctx.buildValidationView_(report);

  assertNoSideEffects(fake);
  assert.deepEqual(plain(view), JSON.parse(JSON.stringify(view)));
  assert.deepEqual(Object.keys(view).sort(), VALIDATION_VIEW_KEYS);
  assert.equal(view.ok, true);
  assert.deepEqual(plain(view.globalErrors), []);
  assert.equal(view.setup, null);
  assert.equal(view.sheetName, 'Recipients');
  assert.equal(view.subject, 'Notice {{Reference}}');
  assert.equal(view.from, 'operator@example.test');
  assert.equal(view.replyTo, '');
  assert.equal(view.quotaRemaining, 100);
  assert.deepEqual(plain(view.counts), { valid: 25, invalid: 1, excluded: 2 });
  assert.deepEqual(plain(view.excludedByReason), [
    { reason: 'resultado: SKIP', count: 1 },
    { reason: 'oculta por el usuario', count: 1 },
  ]);
  assert.ok(skipRowNumber < hiddenRowNumber);
  assert.deepEqual(plain(view.commonAttachments), ['common-terms.pdf']);

  // Las 25 filas, sin corte en 20, en orden ascendente.
  assert.equal(view.rows.length, 25);
  assert.equal(view.moreRows, 0);
  assert.deepEqual(
    plain(view.rows.map((row) => row.rowNumber)),
    Array.from({ length: 25 }, (_, i) => i + 2)
  );
  assert.deepEqual(plain(view.rows.slice(0, 3)), [
    { rowNumber: 2, email: 'alpha@example.test', attachmentNames: ['alpha notice.pdf', 'Alpha Letter'] },
    { rowNumber: 3, email: 'beta@example.test', attachmentNames: ['beta-notice.pdf'] },
    { rowNumber: 4, email: 'gamma@example.test', attachmentNames: [] },
  ]);
  assert.deepEqual(plain(view.rows[24]), { rowNumber: 26, email: 'row21@example.test', attachmentNames: [] });

  assert.deepEqual(plain(view.invalidRows), [
    {
      rowNumber: invalidRowNumber,
      reasons: ['La dirección de Email Address no es válida (debe ser una sola dirección, sin espacios)'],
    },
  ]);
  assert.equal(view.moreInvalid, 0);
  assert.deepEqual(plain(view.overwriteRows), []);

  const text = JSON.stringify(view);
  assert.ok(!text.includes('drive.google.com'));
  assert.ok(!text.includes('docs.google.com'));
  for (const id of Object.values(DRIVE_IDS)) {
    assert.ok(!text.includes(id));
  }
  // Ningún valor de otras columnas ni saltos de línea.
  assert.ok(!text.includes('REF-001') && !text.includes('"Alpha"'));
  assert.ok(!text.includes('\\n'));
});

test('AC-33 / D-42: buildValidationView_ con errores globales trae el plan y ninguna fila', () => {
  const { ctx, fixture, fake } = setup(undefined, createLegacyFixture);
  fake.deps.quota.remaining = () => {
    throw new Error('Falso: cuota no disponible');
  };
  const view = ctx.buildValidationView_(ctx.buildPreflight_(fake.deps, fixture.config));

  assert.deepEqual(plain(view), JSON.parse(JSON.stringify(view)));
  assert.deepEqual(Object.keys(view).sort(), VALIDATION_VIEW_KEYS);
  assert.equal(view.ok, false);
  assert.ok(view.globalErrors.includes('La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"'));
  assert.equal(view.setup.needed, true);
  assert.equal(view.setup.headerKey, JSON.stringify(fixture.sheets[0].values[0]));
  assert.equal(view.setup.appends.length, 2);
  assert.equal(view.quotaRemaining, null);
  assert.deepEqual(plain(view.counts), { valid: 0, invalid: 0, excluded: 0 });
  assert.deepEqual(plain(view.rows), []);
  assert.deepEqual(plain(view.invalidRows), []);
  assert.deepEqual(plain(view.overwriteRows), []);
  assertNoSideEffects(fake);
});

test('D-41 / D-42: con MAX_CONFIRM_ROWS reducido, rows e invalidRows se cortan y moreRows / moreInvalid cuentan el resto', () => {
  const { ctx, fixture, fake } = setup();
  vm.runInContext('LIMITS.MAX_CONFIRM_ROWS = 2', ctx);
  for (let i = 0; i < 3; i++) {
    fake.appendRow(buildRow({ 'Email Address': 'not-an-email-' + i, 'First Name': 'N', Reference: 'R' }));
  }
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  const view = ctx.buildValidationView_(report);

  assert.deepEqual(plain(view.counts), { valid: 3, invalid: 3, excluded: 0 });
  assert.deepEqual(plain(view.rows.map((row) => row.rowNumber)), [2, 3]);
  assert.equal(view.moreRows, 1);
  assert.deepEqual(plain(view.invalidRows.map((row) => row.rowNumber)), [5, 6]);
  assert.equal(view.moreInvalid, 1);

  const review = ctx.buildRowReview_(report);
  assert.equal(review.rows.length, 2);
  assert.equal(review.more, 1);
  const wide = ctx.buildRowReview_(report, 10);
  assert.equal(wide.rows.length, 3);
  assert.equal(wide.more, 0);
  assert.deepEqual(plain(wide.commonAttachments), ['common-terms.pdf']);
});

test('AC-54 / D-47: overwriteRows lista las filas válidas con Fecha, Campaña o Detalle con valor, sin los valores', () => {
  const { ctx, fixture, fake } = setup();
  fake.setCell(3, 'Detalle', 'x');
  fake.setCell(4, 'Fecha', '2026-01-01');
  // Un valor de solo espacios no cuenta.
  fake.setCell(2, 'Campaña', '   ');
  // Una fila con Resultado no vacío no es válida: no aparece aunque tenga Detalle.
  fake.appendRow(
    buildRow({ 'Email Address': 'done@example.test', Resultado: 'Email Sent', Detalle: 'enviado antes' })
  );
  const report = ctx.buildPreflight_(fake.deps, fixture.config);
  const view = ctx.buildValidationView_(report);

  assert.deepEqual(plain(view.overwriteRows), [
    { rowNumber: 3, columns: ['Detalle'] },
    { rowNumber: 4, columns: ['Fecha'] },
  ]);
  assert.deepEqual(plain(ctx.findOverwriteRows_(report.valid, report.headers.columns)), plain(view.overwriteRows));
  const text = JSON.stringify(view);
  assert.ok(!text.includes('"x"'));
  assert.ok(!text.includes('2026-01-01'));
  assert.ok(!text.includes('enviado antes'));
  assertNoSideEffects(fake);
});

test('AC-54 / D-47: findOverwriteRows_ ordena por fila y nombra las columnas como Fecha, Campaña, Detalle', () => {
  const ctx = loadAppsScript();
  const columns = { email: 0, attachments: -1, date: 1, campaign: 2, result: 3, detail: 4 };
  const rows = [
    { rowNumber: 7, values: ['g@example.test', '', 'Otra', '', ''] },
    { rowNumber: 5, values: ['e@example.test', 'ayer', '', '', 'algo'] },
    { rowNumber: 6, values: ['f@example.test', ' ', '', '', '\t'] },
  ];
  assert.deepEqual(plain(ctx.findOverwriteRows_(rows, columns)), [
    { rowNumber: 5, columns: ['Fecha', 'Detalle'] },
    { rowNumber: 7, columns: ['Campaña'] },
  ]);
  assert.deepEqual(plain(ctx.findOverwriteRows_([], columns)), []);

  // Sin valores en esas columnas, la vista no lista nada.
  const { ctx: viewCtx, fixture, fake } = setup();
  const view = viewCtx.buildValidationView_(viewCtx.buildPreflight_(fake.deps, fixture.config));
  assert.deepEqual(plain(view.overwriteRows), []);
});

test('AC-54 / D-47: formatOverwriteConsent_ arma el texto de la casilla con columnas por fila', () => {
  const ctx = loadAppsScript();
  assert.equal(
    ctx.formatOverwriteConsent_([
      { rowNumber: 3, columns: ['Detalle'] },
      { rowNumber: 4, columns: ['Fecha'] },
    ]),
    'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 2 filas: ' +
      'fila 3 (Detalle), fila 4 (Fecha)'
  );
  assert.equal(
    ctx.formatOverwriteConsent_([{ rowNumber: 9, columns: ['Fecha', 'Campaña'] }]),
    'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 1 fila: fila 9 (Fecha, Campaña)'
  );

  const many = Array.from({ length: 25 }, (_, i) => ({ rowNumber: i + 2, columns: ['Fecha', 'Detalle'] }));
  const text = ctx.formatOverwriteConsent_(many);
  assert.ok(
    text.startsWith(
      'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 25 filas: ' +
        'fila 2 (Fecha, Detalle), fila 3 (Fecha, Detalle)'
    )
  );
  assert.equal((text.match(/fila \d+ \(/g) || []).length, 20);
  assert.ok(text.endsWith('fila 21 (Fecha, Detalle) y 5 filas más'));
  assert.ok(!text.includes('\n'));

  assert.equal(ctx.formatOverwriteConsent_([]), '');
});
