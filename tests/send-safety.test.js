'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const { createCampaignFixture, DRIVE_IDS } = require('./fixtures/campaign');

function arrange() {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();
  const fake = createFakeDeps(fixture);
  return { ctx, fixture, fake };
}

function execute(ctx, fake, token, acknowledgement = true) {
  return plain(ctx.executeConfirmed_(fake.deps, token, 'send', false, acknowledgement));
}

test('P0-1: filas intercambiadas durante la descarga se rechazan antes del claim y de Gmail', () => {
  const { ctx, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  assert.equal(prepared.ok, true);
  const original = fake.deps.drive.getAttachment;
  let swapped = false;
  fake.deps.drive.getAttachment = function (info) {
    if (!swapped) {
      swapped = true;
      fake.swapRows(2, 3);
    }
    return original(info);
  };

  const result = execute(ctx, fake, prepared.token);
  assert.deepEqual(fake.calls.sent.map((m) => m.to), ['gamma@example.test']);
  assert.deepEqual(fake.calls.cellWrites.map((c) => c.rowNumber), [4, 4], 'no debe marcar ENVIANDO sobre otra fila');
  assert.equal(result.rows[0].result, 'OMITIDA');
  assert.equal(fake.getCell(2, 'Resultado'), '');
  assert.equal(fake.getCell(3, 'Resultado'), '');
});

test('P0-1: intercambio inmediatamente después del claim impide la llamada a Gmail', () => {
  const { ctx, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const original = fake.deps.sheets.writeCells;
  let swapped = false;
  fake.deps.sheets.writeCells = function (sheetId, rowNumber, cells) {
    original(sheetId, rowNumber, cells);
    if (!swapped && cells.some((cell) => cell.value === 'ENVIANDO')) {
      swapped = true;
      fake.swapRows(2, 3);
    }
  };

  const result = execute(ctx, fake, prepared.token);
  assert.equal(fake.calls.sent.length, 0);
  assert.ok(result.stoppedReason.includes('cambió') || result.stoppedReason.includes('identidad'));
  assert.equal(fake.getCell(3, 'Resultado'), 'ENVIANDO', 'se conserva el claim para conciliación manual');
});

test('P0-2: falta de reconocimiento de filtros bloquea el envío real en el servidor', () => {
  const { ctx, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const result = execute(ctx, fake, prepared.token, false);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.match(result.stoppedReason, /filtro/i);
});

test('P0-3: mismo nombre y tamaño pero bytes distintos del adjunto invalidan el borrador confirmado', () => {
  const { ctx, fixture, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  assert.equal(prepared.ok, true);
  fixture.gmail.drafts[0].attachments[0].blob.fakeBlob = 'pdf-change';

  const result = execute(ctx, fake, prepared.token);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.match(result.stoppedReason, /plantilla/i);
});

test('P0-3: mismo nombre y tamaño pero bytes distintos de imagen inline invalidan confirmación', () => {
  const { ctx, fixture, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  fixture.gmail.drafts[0].inlineImages[0].blob.fakeBlob = 'img-blah';

  const result = execute(ctx, fake, prepared.token);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
});

test('P0-3: archivo Drive modificado tras confirmar se omite sin mandar correo a esa fila', () => {
  const { ctx, fixture, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  fixture.drive.files[DRIVE_IDS.PDF_ALPHA].modifiedAt = '2026-11-09T12:30:00.000Z';

  const result = execute(ctx, fake, prepared.token);
  assert.deepEqual(fake.calls.sent.map((msg) => msg.to), ['beta@example.test', 'gamma@example.test']);
  assert.equal(result.rows[0].result, 'OMITIDA');
  assert.equal(fake.getCell(2, 'Resultado'), '');
});

test('P0-3: edición de Drive durante la descarga se detecta antes del claim', () => {
  const { ctx, fixture, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const original = fake.deps.drive.getAttachment;
  let modified = false;
  fake.deps.drive.getAttachment = function (info) {
    if (!modified && info.id === DRIVE_IDS.PDF_ALPHA) {
      modified = true;
      fixture.drive.files[info.id].modifiedAt = '2026-11-09T12:31:00.000Z';
    }
    return original(info);
  };
  const result = execute(ctx, fake, prepared.token);
  assert.equal(result.rows[0].result, 'OMITIDA');
  assert.equal(fake.getCell(2, 'Resultado'), '');
  assert.deepEqual(fake.calls.sent.map((msg) => msg.to), ['beta@example.test', 'gamma@example.test']);
});


test('P0-1: una fila ocultada mientras se preparan adjuntos no se marca ni envía', () => {
  const { ctx, fixture, fake } = arrange();
  const prepared = ctx.prepareConfirmation_(fake.deps, 'send');
  const original = fake.deps.drive.getAttachment;
  let hidden = false;
  fake.deps.drive.getAttachment = function (info) {
    if (!hidden) {
      fixture.sheets[0].hiddenByFilter[1] = true;
      hidden = true;
    }
    return original(info);
  };
  const result = execute(ctx, fake, prepared.token);
  assert.equal(result.rows[0].result, 'OMITIDA');
  assert.equal(fake.getCell(2, 'Resultado'), '');
  assert.deepEqual(fake.calls.sent.map((m) => m.to), ['beta@example.test', 'gamma@example.test']);
});
