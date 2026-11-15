'use strict';

// Sidebar V2 (AC-52, AC-54, D-29, D-42, D-44 a D-47): el `<script>` de
// `src/Sidebar.html` corre en un DOM falso (`tests/helpers/fake-dom.js`) con
// un `google.script.run` falso que registra cada llamada. Solo datos
// ficticios; nada sale del proceso.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSidebar } = require('./helpers/fake-dom');

const TOKEN = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TOKEN_2 = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const TEST_TOKEN = '2c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f';
const USER = 'operador@example.test';
const GUIDANCE =
  'No se pudo confirmar el resultado. Revisá la columna Resultado (ENVIANDO / REVISAR) antes de volver a enviar';

function panelState() {
  return {
    sheets: [
      { id: 101, name: 'Campaña otoño' },
      { id: 202, name: 'Otra pestaña' },
    ],
    drafts: [{ id: 'draft-1', subject: 'Hola {{First Name}}', date: '2026-11-09T10:00:00.000Z' }],
    senders: [USER, 'alias@example.test'],
    current: { sheetId: 202, draftId: 'draft-1', from: 'alias@example.test', replyTo: 'respuestas@example.test', campaignName: 'Otoño 2026' },
  };
}

function inMinutes(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function sendView(overrides = {}) {
  return {
    kind: 'send',
    campaign: 'Otoño 2026',
    sheetName: 'Campaña otoño',
    subject: 'Hola {{First Name}}',
    from: USER,
    replyTo: '',
    count: 3,
    commonAttachments: ['condiciones.pdf'],
    rows: [
      { rowNumber: 2, email: 'alpha@example.test', attachmentNames: ['a.pdf'] },
      { rowNumber: 3, email: 'beta@example.test', attachmentNames: [] },
      { rowNumber: 4, email: 'gamma@example.test', attachmentNames: ['c.pdf', 'd.pdf'] },
    ],
    invalidCount: 1,
    excludedCount: 2,
    overwriteRows: [],
    consentRequired: false,
    consentText: '',
    warning: 'Se enviarán 3 correos reales. Esta acción no se puede deshacer.',
    expiresAtIso: inMinutes(10),
    ...overrides,
  };
}

function testView(overrides = {}) {
  return {
    kind: 'test',
    campaign: 'Otoño 2026',
    sheetName: 'Campaña otoño',
    subject: 'Hola {{First Name}}',
    from: USER,
    replyTo: '',
    to: USER,
    count: 1,
    commonAttachments: [],
    rows: [{ rowNumber: 2, email: 'alpha@example.test', attachmentNames: [] }],
    invalidCount: 0,
    excludedCount: 0,
    overwriteRows: [],
    consentRequired: false,
    consentText: '',
    warning: 'Se enviará 1 correo a tu cuenta (' + USER + ') con el asunto precedido por [PRUEBA].',
    expiresAtIso: inMinutes(10),
    ...overrides,
  };
}

const CONSENT_ROWS = [{ rowNumber: 3, columns: ['Campaña'] }];
const CONSENT_TEXT =
  'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 1 fila: fila 3 (Campaña)';

function counts(overrides = {}) {
  return { total: 3, processed: 0, sent: 0, skipped: 0, review: 0, pending: 3, ...overrides };
}

function sendResult(overrides = {}) {
  return {
    ok: true,
    kind: 'send',
    campaign: 'Otoño 2026',
    counts: counts({ processed: 3, sent: 2, skipped: 1, pending: 0 }),
    rows: [
      { rowNumber: 2, recipient: 'alpha@example.test', result: 'Email Sent', detail: 'Aceptado por Gmail' },
      { rowNumber: 3, recipient: 'beta@example.test', result: 'OMITIDA', detail: 'Cambió después de la confirmación' },
      { rowNumber: 4, recipient: 'gamma@example.test', result: 'Email Sent', detail: 'Aceptado por Gmail' },
    ],
    stoppedReason: '',
    summaryLines: ['Campaña: Otoño 2026', '2 correos aceptados por Gmail', 'Filas procesadas: 3 de 3'],
    ...overrides,
  };
}

function loaded() {
  const dom = loadSidebar();
  dom.resolve(dom.calls[0], panelState());
  return dom;
}

function preparedSend(view = sendView(), token = TOKEN) {
  const dom = loaded();
  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), { ok: true, errors: [], token, view });
  dom.setChecked('send-filter-ack', true);
  return dom;
}

function preparedTest(view = testView(), token = TEST_TOKEN) {
  const dom = loaded();
  dom.setValue('test-row', '2');
  dom.click('review-test');
  dom.resolve(dom.lastCall('prepareTestSend'), { ok: true, errors: [], token, view });
  return dom;
}

function optionsOf(dom, id) {
  return dom.childrenOf(id).map((option) => ({ text: option.textContent, value: option.value }));
}

// --- Carga ---------------------------------------------------------------------

test('AC-52: al cargar solo llama a getPanelState, sin temporizadores', () => {
  const dom = loadSidebar();

  assert.deepEqual(
    dom.calls.map((call) => [call.name, call.args]),
    [['getPanelState', []]]
  );
  assert.deepEqual(dom.pendingTimers(), []);
  assert.equal(typeof dom.MailMergePanel, 'object');
});

test('AC-52: getPanelState llena los selects con new Option y el nombre de campaña con current.campaignName', () => {
  const dom = loaded();

  assert.deepEqual(optionsOf(dom, 'sheet').slice(1), [
    { text: 'Campaña otoño', value: '101' },
    { text: 'Otra pestaña', value: '202' },
  ]);
  assert.equal(dom.byId('sheet').value, '202');
  assert.equal(dom.byId('draft').value, 'draft-1');
  assert.ok(optionsOf(dom, 'draft')[1].text.startsWith('Hola {{First Name}}'));
  assert.deepEqual(optionsOf(dom, 'from').slice(1), [
    { text: USER, value: USER },
    { text: 'alias@example.test', value: 'alias@example.test' },
  ]);
  assert.equal(dom.byId('from').value, 'alias@example.test');
  assert.equal(dom.byId('reply-to').value, 'respuestas@example.test');
  assert.equal(dom.byId('campaign-name').value, 'Otoño 2026');
  assert.ok(dom.childrenOf('sheet').every((option) => option.tagName === 'OPTION'));
  assert.equal(dom.created.length, 0, 'las opciones se crean con new Option, no con createElement');
  assert.equal(dom.byId('save').disabled, false);
});

test('AC-52: un fallo de getPanelState se muestra como mensaje', () => {
  const dom = loadSidebar();
  dom.fail(dom.calls[0], new Error('Sin acceso a la hoja'));

  assert.match(dom.text('config-message'), /Sin acceso a la hoja/);
});

test('AC-52 / D-39: Guardar llama a saveConfig con sheetId, draftId, from, replyTo y campaignName', () => {
  const dom = loaded();
  dom.setValue('sheet', '101');
  dom.setValue('reply-to', '  ');
  dom.setValue('campaign-name', '  Primavera  ');

  dom.click('save');

  const call = dom.lastCall('saveConfig');
  assert.deepEqual(call.args, [
    { sheetId: '101', draftId: 'draft-1', from: 'alias@example.test', replyTo: '', campaignName: 'Primavera' },
  ]);
  assert.equal(dom.byId('save').disabled, true, 'una operación por vez');
  dom.resolve(call, { sheetId: 101, draftId: 'draft-1', from: 'alias@example.test', replyTo: '', campaignName: 'Primavera' });
  assert.equal(dom.byId('save').disabled, false);
  assert.match(dom.text('config-message'), /guardada/);
});

test('AC-52: Guardar sin pestaña elegida no llama al servidor; un error de saveConfig se muestra', () => {
  const dom = loaded();
  dom.setValue('sheet', '');
  dom.click('save');
  assert.equal(dom.callsTo('saveConfig').length, 0);
  assert.match(dom.text('config-message'), /Elegí/);

  dom.setValue('sheet', '101');
  dom.click('save');
  dom.fail(dom.lastCall('saveConfig'), new Error('El nombre de campaña no puede superar 80 caracteres.'));
  assert.match(dom.text('config-message'), /80 caracteres/);
  assert.equal(dom.byId('save').disabled, false);
});

// --- Envío: confirmación y ejecución -------------------------------------------

test('AC-52: "Enviar N correos" deshabilitado hasta un prepareSendPending exitoso; luego muestra N', () => {
  const dom = loaded();
  assert.equal(dom.byId('execute-send').disabled, true);
  assert.equal(dom.isVisible('send-confirmation'), false);
  assert.equal(dom.click('execute-send'), false);
  assert.equal(dom.click('execute-send', { force: true }), true);
  assert.equal(dom.callsTo('executeSendPending').length, 0);

  dom.click('review-send');
  const prepare = dom.lastCall('prepareSendPending');
  assert.deepEqual(prepare.args, []);
  assert.equal(dom.byId('review-send').disabled, true);
  dom.resolve(prepare, { ok: false, errors: ['No hay correos para enviar'], token: '', view: null });
  assert.equal(dom.byId('execute-send').disabled, true);
  assert.equal(dom.isVisible('send-confirmation'), false);
  assert.match(dom.text('send-message'), /No hay correos para enviar/);

  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), { ok: true, errors: [], token: TOKEN, view: sendView() });
  assert.equal(dom.isVisible('send-confirmation'), true);
  assert.equal(dom.byId('execute-send').disabled, true);
  dom.setChecked('send-filter-ack', true);
  assert.equal(dom.byId('execute-send').disabled, false);
  assert.equal(dom.text('execute-send'), 'Enviar 3 correos');
  assert.equal(dom.isVisible('send-consent-box'), false);
});

test('D-42: la confirmación de envío lista cada fila con destinatario y adjuntos, más los adjuntos comunes', () => {
  const dom = preparedSend();
  const text = dom.text('send-view');

  assert.ok(text.includes('Se enviarán 3 correos reales. Esta acción no se puede deshacer.'));
  assert.ok(text.includes('Fila 2 → alpha@example.test: a.pdf'));
  assert.ok(text.includes('Fila 3 → beta@example.test'));
  assert.ok(text.includes('Fila 4 → gamma@example.test: c.pdf, d.pdf'));
  assert.ok(text.includes('condiciones.pdf'));
  assert.ok(text.includes('Otoño 2026'));
});

test('AC-52 / D-45: el clic llama a executeSendPending con exactamente el token recibido, una sola vez', () => {
  const dom = preparedSend();

  dom.click('execute-send');
  dom.click('execute-send');
  dom.click('execute-send', { force: true });
  dom.MailMergePanel.executeSend();

  const executes = dom.callsTo('executeSendPending');
  assert.equal(executes.length, 1);
  assert.deepEqual(executes[0].args, [TOKEN, false, true]);
  assert.equal(typeof executes[0].args[1], 'boolean');
  assert.equal(dom.byId('execute-send').disabled, true);
  assert.equal(dom.byId('review-send').disabled, true, 'sin otra operación mientras se envía');
});

test('D-29: mientras executeSendPending está pendiente hay un solo temporizador de 2000 ms y un solo getSendProgress a la vez', () => {
  const dom = preparedSend();
  dom.click('execute-send');

  assert.deepEqual(dom.pendingTimers().map((timer) => timer.ms), [2000]);
  assert.equal(dom.callsTo('getSendProgress').length, 0);

  dom.runNextTimer();
  assert.equal(dom.callsTo('getSendProgress').length, 1);
  assert.deepEqual(dom.lastCall('getSendProgress').args, [TOKEN]);
  assert.deepEqual(dom.pendingTimers(), [], 'la siguiente se agenda recién cuando vuelve la anterior');

  dom.resolve(dom.lastCall('getSendProgress'), { found: false, progress: null });
  assert.equal(dom.text('progress-status'), 'Esperando el inicio del envío…');
  assert.deepEqual(dom.pendingTimers().map((timer) => timer.ms), [2000]);

  dom.runNextTimer();
  assert.equal(dom.callsTo('getSendProgress').length, 2);
  dom.resolve(dom.lastCall('getSendProgress'), {
    found: true,
    progress: {
      state: 'EN_CURSO',
      kind: 'send',
      campaign: 'Otoño 2026',
      counts: counts({ processed: 2, sent: 2, review: 1, pending: 1 }),
      rows: [
        { rowNumber: 2, result: 'Email Sent', detail: 'Aceptado por Gmail' },
        { rowNumber: 3, result: 'REVISAR', detail: 'La fila se desplazó; enviado a [dirección]' },
      ],
      rowsTruncated: false,
      stoppedReason: '',
    },
  });

  assert.equal(dom.text('count-total'), '3');
  assert.equal(dom.text('count-processed'), '2');
  assert.equal(dom.text('count-sent'), '2');
  assert.equal(dom.text('count-skipped'), '0');
  assert.equal(dom.text('count-review'), '1');
  assert.equal(dom.text('count-pending'), '1');
  assert.equal(dom.byId('progress-bar').max, 3);
  assert.equal(dom.byId('progress-bar').value, 2);
  assert.deepEqual(dom.tableRows('results-body'), [
    ['2', 'alpha@example.test', 'Email Sent', 'Aceptado por Gmail'],
    ['3', 'beta@example.test', 'REVISAR', 'La fila se desplazó; enviado a [dirección]'],
  ]);
  assert.deepEqual(dom.pendingTimers().map((timer) => timer.ms), [2000]);

  // Una falla del sondeo no detiene el sondeo ni lo duplica.
  dom.runNextTimer();
  dom.fail(dom.lastCall('getSendProgress'), new Error('Tiempo de espera agotado'));
  assert.deepEqual(dom.pendingTimers().map((timer) => timer.ms), [2000]);
  assert.equal(dom.callsTo('executeSendPending').length, 1);
});

test('AC-52 / D-29: al responder executeSendPending se detiene el sondeo y se pintan la tabla final y el resumen', () => {
  const dom = preparedSend();
  dom.click('execute-send');
  dom.runNextTimer();
  const inFlight = dom.lastCall('getSendProgress');

  dom.resolve(dom.lastCall('executeSendPending'), sendResult());

  assert.deepEqual(dom.pendingTimers(), []);
  assert.deepEqual(dom.tableRows('results-body'), [
    ['2', 'alpha@example.test', 'Email Sent', 'Aceptado por Gmail'],
    ['3', 'beta@example.test', 'OMITIDA', 'Cambió después de la confirmación'],
    ['4', 'gamma@example.test', 'Email Sent', 'Aceptado por Gmail'],
  ]);
  assert.ok(dom.text('summary').includes('2 correos aceptados por Gmail'));
  assert.ok(dom.text('summary').includes('Filas procesadas: 3 de 3'));
  assert.equal(dom.text('count-sent'), '2');
  assert.equal(dom.text('count-skipped'), '1');
  assert.equal(dom.byId('progress-bar').value, 3);
  assert.equal(dom.isVisible('send-confirmation'), false);
  assert.equal(dom.isVisible('progress-guidance'), false);

  // La respuesta tardía del sondeo no repinta ni agenda nada.
  dom.resolve(inFlight, { found: true, progress: { state: 'EN_CURSO', counts: counts(), rows: [], stoppedReason: '' } });
  assert.deepEqual(dom.pendingTimers(), []);
  assert.equal(dom.text('count-sent'), '2');
  const before = dom.calls.length;
  assert.equal(dom.click('execute-send'), false);
  assert.equal(dom.calls.length, before);
  assert.equal(dom.byId('review-send').disabled, false);
});

test('D-45: el motivo de corte del resultado se muestra', () => {
  const dom = preparedSend();
  dom.click('execute-send');
  dom.resolve(
    dom.lastCall('executeSendPending'),
    sendResult({ stoppedReason: 'Se agotó la cuota diaria de envíos de Gmail; las filas restantes siguen pendientes' })
  );

  assert.match(dom.text('stopped-reason'), /Se agotó la cuota diaria/);
  assert.equal(dom.isVisible('stopped-reason'), true);
});

test('AC-52 / D-45: una falla de executeSendPending muestra el último progreso y la guía exacta, sin volver a llamar', () => {
  const dom = preparedSend();
  dom.click('execute-send');
  dom.runNextTimer();
  dom.resolve(dom.lastCall('getSendProgress'), {
    found: true,
    progress: {
      state: 'EN_CURSO',
      kind: 'send',
      campaign: 'Otoño 2026',
      counts: counts({ processed: 1, sent: 1, pending: 2 }),
      rows: [{ rowNumber: 2, result: 'Email Sent', detail: 'Aceptado por Gmail' }],
      rowsTruncated: false,
      stoppedReason: '',
    },
  });
  assert.equal(dom.pendingTimers().length, 1);

  dom.fail(dom.lastCall('executeSendPending'), new Error('Se excedió el tiempo máximo de ejecución'));

  assert.deepEqual(dom.pendingTimers(), []);
  assert.equal(dom.isVisible('progress-guidance'), true);
  assert.equal(dom.text('progress-guidance'), GUIDANCE);
  assert.equal(dom.text('count-processed'), '1');
  assert.deepEqual(dom.tableRows('results-body'), [['2', 'alpha@example.test', 'Email Sent', 'Aceptado por Gmail']]);
  assert.equal(dom.isVisible('send-confirmation'), false);
  assert.equal(dom.byId('execute-send').disabled, true);
  dom.click('execute-send', { force: true });
  dom.MailMergePanel.executeSend();
  assert.equal(dom.callsTo('executeSendPending').length, 1);

  // Volver a enviar exige un prepareSendPending nuevo con su propio token.
  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), { ok: true, errors: [], token: TOKEN_2, view: sendView() });
  dom.setChecked('send-filter-ack', true);
  dom.click('execute-send');
  const executes = dom.callsTo('executeSendPending');
  assert.equal(executes.length, 2);
  assert.deepEqual(executes[1].args, [TOKEN_2, false, true]);
  assert.equal(dom.isVisible('progress-guidance'), false);
});

test('D-45: lock no disponible → la sidebar vuelve al estado inicial con el motivo', () => {
  const dom = preparedSend();
  dom.click('execute-send');
  dom.resolve(
    dom.lastCall('executeSendPending'),
    sendResult({
      ok: false,
      counts: counts({ total: 0, pending: 0 }),
      rows: [],
      stoppedReason: 'Hay otra ejecución en curso; reintentá en unos minutos',
      summaryLines: ['El envío no se inició: Hay otra ejecución en curso; reintentá en unos minutos'],
    })
  );

  assert.deepEqual(dom.pendingTimers(), []);
  assert.equal(dom.isVisible('send-confirmation'), false);
  assert.equal(dom.isVisible('progress-section'), false);
  assert.match(dom.text('send-message'), /Hay otra ejecución en curso/);
  assert.equal(dom.byId('review-send').disabled, false);
  assert.equal(dom.byId('execute-send').disabled, true);
  assert.equal(dom.callsTo('executeSendPending').length, 1);
});

test('AC-52: Cancelar llama a cancelConfirmation con el token y oculta la confirmación', () => {
  const dom = preparedSend();

  dom.click('cancel-send');

  assert.deepEqual(dom.lastCall('cancelConfirmation').args, [TOKEN]);
  assert.equal(dom.isVisible('send-confirmation'), false);
  assert.equal(dom.byId('execute-send').disabled, true);
  dom.click('execute-send', { force: true });
  assert.equal(dom.callsTo('executeSendPending').length, 0);
  dom.resolve(dom.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(dom.byId('review-send').disabled, false);
});

test('AC-52: el botón de confirmación se deshabilita al vencer expiresAtIso', () => {
  const dom = preparedSend(sendView({ expiresAtIso: inMinutes(-1) }));

  assert.equal(dom.pendingTimers().length, 1);
  dom.runNextTimer();

  assert.equal(dom.byId('execute-send').disabled, true);
  assert.match(dom.text('send-message'), /venció/);
  dom.click('execute-send', { force: true });
  assert.equal(dom.callsTo('executeSendPending').length, 0);
  assert.equal(dom.byId('review-send').disabled, false, 'se puede volver a revisar');
});

// --- Consentimiento de sobrescritura (D-47) -----------------------------------

test('AC-54 / D-47: con consentRequired la casilla aparece sin marcar y habilita el envío solo marcada', () => {
  const dom = preparedSend(sendView({ overwriteRows: CONSENT_ROWS, consentRequired: true, consentText: CONSENT_TEXT }));

  assert.equal(dom.isVisible('send-consent-box'), true);
  assert.equal(dom.byId('send-consent').checked, false);
  assert.equal(dom.text('send-consent-text'), CONSENT_TEXT);
  assert.ok(dom.text('send-consent-rows').includes('fila 3 (Campaña)'));
  assert.equal(dom.byId('execute-send').disabled, true);

  dom.click('execute-send', { force: true });
  dom.MailMergePanel.executeSend();
  assert.equal(dom.callsTo('executeSendPending').length, 0);

  dom.setChecked('send-consent', true);
  assert.equal(dom.byId('execute-send').disabled, false);
  dom.setChecked('send-consent', false);
  assert.equal(dom.byId('execute-send').disabled, true);
  dom.setChecked('send-consent', true);

  dom.click('execute-send');
  const executes = dom.callsTo('executeSendPending');
  assert.equal(executes.length, 1);
  assert.deepEqual(executes[0].args, [TOKEN, true, true]);
});

test('AC-54 / D-47: sin consentRequired no hay casilla y la llamada lleva false', () => {
  const dom = preparedSend();

  assert.equal(dom.isVisible('send-consent-box'), false);
  dom.click('execute-send');
  assert.deepEqual(dom.lastCall('executeSendPending').args, [TOKEN, false, true]);
});

test('AC-54 / D-47: una confirmación nueva vuelve a mostrar la casilla sin marcar', () => {
  const dom = preparedSend(sendView({ overwriteRows: CONSENT_ROWS, consentRequired: true, consentText: CONSENT_TEXT }));
  dom.setChecked('send-consent', true);
  dom.click('cancel-send');
  assert.equal(dom.byId('review-send').disabled, true, 'una operación por vez en la sección');
  dom.resolve(dom.lastCall('cancelConfirmation'), { ok: true });

  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), {
    ok: true,
    errors: [],
    token: TOKEN_2,
    view: sendView({ overwriteRows: CONSENT_ROWS, consentRequired: true, consentText: CONSENT_TEXT }),
  });

  assert.equal(dom.byId('send-consent').checked, false);
  assert.equal(dom.byId('execute-send').disabled, true);
});

test('AC-54 / D-47: en la prueba, la casilla también es obligatoria y executeTestSend lleva el consentimiento', () => {
  const dom = preparedTest(
    testView({
      overwriteRows: [{ rowNumber: 2, columns: ['Fecha', 'Detalle'] }],
      consentRequired: true,
      consentText: 'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 1 fila: fila 2 (Fecha, Detalle)',
    })
  );

  assert.equal(dom.isVisible('test-consent-box'), true);
  assert.equal(dom.byId('test-consent').checked, false);
  assert.ok(dom.text('test-consent-rows').includes('fila 2 (Fecha, Detalle)'));
  assert.equal(dom.byId('execute-test').disabled, true);
  dom.click('execute-test', { force: true });
  assert.equal(dom.callsTo('executeTestSend').length, 0);

  dom.setChecked('test-consent', true);
  dom.click('execute-test');
  assert.deepEqual(dom.lastCall('executeTestSend').args, [TEST_TOKEN, true]);
});

test('AC-54 / D-47: en la prueba sin consentRequired no hay casilla y executeTestSend lleva false', () => {
  const dom = preparedTest();

  assert.equal(dom.isVisible('test-consent-box'), false);
  dom.click('execute-test');
  assert.deepEqual(dom.lastCall('executeTestSend').args, [TEST_TOKEN, false]);
});

// --- Prueba -------------------------------------------------------------------

test('AC-52: Revisar prueba con la fila 2 llama a prepareTestSend; Enviar prueba llama una sola vez a executeTestSend', () => {
  const dom = loaded();
  assert.equal(dom.byId('execute-test').disabled, true);

  dom.setValue('test-row', '');
  dom.click('review-test');
  assert.equal(dom.callsTo('prepareTestSend').length, 0);
  assert.match(dom.text('test-message'), /fila/);

  dom.setValue('test-row', ' 2 ');
  dom.click('review-test');
  assert.deepEqual(dom.lastCall('prepareTestSend').args, ['2']);
  dom.resolve(dom.lastCall('prepareTestSend'), { ok: true, errors: [], token: TEST_TOKEN, view: testView() });

  assert.equal(dom.isVisible('test-confirmation'), true);
  assert.ok(dom.text('test-view').includes(USER));
  dom.click('execute-test');
  dom.click('execute-test', { force: true });
  dom.MailMergePanel.executeTest();

  const executes = dom.callsTo('executeTestSend');
  assert.equal(executes.length, 1);
  assert.deepEqual(executes[0].args, [TEST_TOKEN, false]);
});

test('D-46: durante la prueba, Destinatario sale de view.to; el resultado final se repinta con sus filas', () => {
  const dom = preparedTest();
  dom.click('execute-test');
  assert.deepEqual(dom.pendingTimers().map((timer) => timer.ms), [2000]);
  dom.runNextTimer();
  assert.deepEqual(dom.lastCall('getSendProgress').args, [TEST_TOKEN]);
  dom.resolve(dom.lastCall('getSendProgress'), {
    found: true,
    progress: {
      state: 'EN_CURSO',
      kind: 'test',
      campaign: 'Otoño 2026',
      counts: { total: 1, processed: 0, sent: 0, skipped: 0, review: 0, pending: 1 },
      rows: [{ rowNumber: 2, result: 'ENVIANDO', detail: 'Envío iniciado' }],
      rowsTruncated: false,
      stoppedReason: '',
    },
  });
  assert.deepEqual(dom.tableRows('results-body'), [['2', USER, 'ENVIANDO', 'Envío iniciado']]);

  dom.resolve(dom.lastCall('executeTestSend'), {
    ok: true,
    kind: 'test',
    campaign: 'Otoño 2026',
    counts: { total: 1, processed: 1, sent: 1, skipped: 0, review: 0, pending: 0 },
    rows: [{ rowNumber: 2, recipient: USER, result: 'Email Sent', detail: 'PRUEBA enviada a tu cuenta (' + USER + ')' }],
    stoppedReason: '',
    summaryLines: ['1 correo aceptado por Gmail'],
  });
  assert.deepEqual(dom.pendingTimers(), []);
  assert.deepEqual(dom.tableRows('results-body'), [
    ['2', USER, 'Email Sent', 'PRUEBA enviada a tu cuenta (' + USER + ')'],
  ]);
  assert.equal(dom.isVisible('test-confirmation'), false);
});

test('AC-52: Cancelar la prueba llama a cancelConfirmation con su token', () => {
  const dom = preparedTest();
  dom.click('cancel-test');

  assert.deepEqual(dom.lastCall('cancelConfirmation').args, [TEST_TOKEN]);
  assert.equal(dom.isVisible('test-confirmation'), false);
});

test('AC-52: un rechazo de prepareTestSend muestra el motivo sin confirmación', () => {
  const dom = loaded();
  dom.setValue('test-row', '7');
  dom.click('review-test');
  dom.resolve(dom.lastCall('prepareTestSend'), {
    ok: false,
    errors: ['La fila 7 no se puede probar (resultado: Email Sent)'],
    token: '',
    view: null,
  });

  assert.match(dom.text('test-message'), /La fila 7 no se puede probar/);
  assert.equal(dom.isVisible('test-confirmation'), false);
  assert.equal(dom.byId('execute-test').disabled, true);
});

// --- Validación ---------------------------------------------------------------

function validationView(overrides = {}) {
  return {
    ok: true,
    globalErrors: [],
    setup: null,
    sheetName: 'Campaña otoño',
    subject: 'Hola {{First Name}}',
    from: USER,
    replyTo: '',
    quotaRemaining: 95,
    counts: { valid: 2, invalid: 1, excluded: 1 },
    excludedByReason: [{ reason: 'resultado: Email Sent', count: 1 }],
    commonAttachments: [],
    rows: [
      { rowNumber: 2, email: 'alpha@example.test', attachmentNames: ['a.pdf'] },
      { rowNumber: 3, email: 'beta@example.test', attachmentNames: [] },
    ],
    moreRows: 0,
    invalidRows: [{ rowNumber: 5, reasons: ['Email Address inválido'] }],
    moreInvalid: 0,
    overwriteRows: [],
    ...overrides,
  };
}

test('AC-52: Validar llama a validateCampaign y muestra filas válidas, inválidas y exclusiones', () => {
  const dom = loaded();
  dom.click('validate');
  assert.deepEqual(dom.lastCall('validateCampaign').args, []);
  assert.equal(dom.byId('validate').disabled, true);
  dom.resolve(dom.lastCall('validateCampaign'), validationView());

  const text = dom.text('validation-result');
  assert.ok(text.includes('Fila 2 → alpha@example.test: a.pdf'));
  assert.ok(text.includes('Fila 5: Email Address inválido'));
  assert.ok(text.includes('resultado: Email Sent'));
  assert.ok(text.includes('95'));
  assert.equal(dom.isVisible('setup-box'), false);
  assert.equal(dom.byId('validate').disabled, false);
});

test('AC-54 / D-47: en la ValidationView, overwriteRows se muestra como aviso sin casilla', () => {
  const dom = loaded();
  dom.click('validate');
  dom.resolve(dom.lastCall('validateCampaign'), validationView({ overwriteRows: CONSENT_ROWS }));

  assert.ok(dom.text('validation-result').includes('fila 3 (Campaña)'));
  assert.equal(dom.created.includes('input'), false, 'la validación no crea casillas');
  assert.equal(dom.isVisible('send-consent-box'), false);
});

test('D-35: Validación con setup.needed muestra renombres, agregados y Preparar columnas; el clic aplica y vuelve a validar', () => {
  const dom = loaded();
  dom.click('validate');
  dom.resolve(
    dom.lastCall('validateCampaign'),
    validationView({
      ok: false,
      globalErrors: ['La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"'],
      setup: {
        needed: true,
        headerKey: '["Email Address","Mail Merge Status","Scheduled Date"]',
        renames: [
          { column: 1, from: 'Mail Merge Status', to: 'Resultado' },
          { column: 2, from: 'Scheduled Date', to: 'Fecha' },
        ],
        appends: [
          { column: 3, name: 'Campaña' },
          { column: 4, name: 'Detalle' },
        ],
        errors: [],
        blockedRows: [],
      },
      counts: { valid: 0, invalid: 0, excluded: 0 },
      excludedByReason: [],
      rows: [],
      invalidRows: [],
    })
  );

  assert.equal(dom.isVisible('setup-box'), true);
  const setupText = dom.text('setup-list');
  assert.ok(setupText.includes('Mail Merge Status'));
  assert.ok(setupText.includes('Resultado'));
  assert.ok(setupText.includes('Scheduled Date'));
  assert.ok(setupText.includes('Campaña'));
  assert.ok(setupText.includes('Detalle'));
  assert.ok(dom.text('validation-result').includes('encabezados de la versión anterior'));
  assert.equal(dom.byId('apply-setup').disabled, false);

  dom.click('apply-setup');
  const apply = dom.lastCall('applyColumnSetup');
  assert.deepEqual(apply.args, ['["Email Address","Mail Merge Status","Scheduled Date"]']);
  assert.equal(dom.callsTo('validateCampaign').length, 1);
  dom.resolve(apply, { ok: true, errors: [], applied: { renames: [{}, {}], appends: [{}, {}] } });
  assert.equal(dom.callsTo('validateCampaign').length, 2);

  dom.resolve(dom.lastCall('validateCampaign'), validationView());
  assert.equal(dom.isVisible('setup-box'), false);
});

test('D-34: un plan con bloqueos lista los errores y no habilita Preparar columnas; un rechazo del servidor se muestra', () => {
  const dom = loaded();
  dom.click('validate');
  dom.resolve(
    dom.lastCall('validateCampaign'),
    validationView({
      ok: false,
      globalErrors: ['Faltan columnas'],
      setup: {
        needed: true,
        headerKey: '["Email Address","Mail Merge Status","Scheduled Date"]',
        renames: [],
        appends: [],
        errors: ['La fila 4 tiene Scheduled Date con valor y el estado vacío'],
        blockedRows: [4],
      },
    })
  );
  assert.ok(dom.text('setup-list').includes('La fila 4 tiene Scheduled Date'));
  assert.equal(dom.byId('apply-setup').disabled, true);

  const dom2 = loaded();
  dom2.click('validate');
  dom2.resolve(
    dom2.lastCall('validateCampaign'),
    validationView({
      ok: false,
      globalErrors: ['Faltan columnas'],
      setup: { needed: true, headerKey: '["Email Address"]', renames: [], appends: [{ column: 1, name: 'Resultado' }], errors: [], blockedRows: [] },
    })
  );
  dom2.click('apply-setup');
  dom2.resolve(dom2.lastCall('applyColumnSetup'), {
    ok: false,
    errors: ['La fila de encabezados cambió; volvé a validar'],
    applied: { renames: [], appends: [] },
  });
  assert.match(dom2.text('validation-message'), /La fila de encabezados cambió/);
  assert.equal(dom2.callsTo('validateCampaign').length, 1);
});

// --- Datos del servidor como texto (D-44) --------------------------------------

test('D-44: un texto del servidor con marcado se muestra literal, sin crear elementos', () => {
  const dom = loaded();
  dom.click('validate');
  dom.resolve(
    dom.lastCall('validateCampaign'),
    validationView({ sheetName: '<b>x</b>', rows: [{ rowNumber: 2, email: '<b>x</b>', attachmentNames: ['<img src=y>'] }] })
  );
  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), {
    ok: true,
    errors: [],
    token: TOKEN,
    view: sendView({ warning: '<b>x</b>', campaign: '<script>z</script>' }),
  });

  assert.ok(dom.text('validation-result').includes('<b>x</b>'));
  assert.ok(dom.text('validation-result').includes('<img src=y>'));
  assert.ok(dom.text('send-view').includes('<b>x</b>'));
  assert.ok(dom.text('send-view').includes('<script>z</script>'));
  for (const tag of ['b', 'img', 'script']) {
    assert.equal(dom.created.includes(tag), false, `no se creó <${tag}>`);
  }
});

test('Cerrar llama a google.script.host.close', () => {
  const dom = loaded();
  dom.click('close');
  assert.equal(dom.hostCloseCount(), 1);
});

// --- El DOM falso hace cumplir el subconjunto permitido ------------------------

test('fake-dom: document y los elementos lanzan fuera del subconjunto permitido', () => {
  const page = (code) => `<div id="box"></div><script>${code}</script>`;

  assert.throws(() => loadSidebar({ html: page('document.querySelector("#box");') }), /document\.querySelector/);
  assert.throws(
    () => loadSidebar({ html: page('document.getElementById("box").inner' + 'HTML = "<b>x</b>";') }),
    /no admite asignar/
  );
  assert.throws(() => loadSidebar({ html: page('document.getElementById("box").style;') }), /no expone "style"/);
  assert.throws(() => loadSidebar({ html: page('google.script.run.noExiste();') }), /no es una función pública/);
  assert.throws(
    () => loadSidebar({ html: page('document.getElementById("box").addEventListener("submit", function () {});') }),
    /evento no permitido/
  );

  // D-50: solo atributos aria-* y role; ni classList, ni dataset, ni SVG, ni eventos no listados.
  for (const name of ['href', 'onclick', 'style', 'data-x']) {
    assert.throws(
      () => loadSidebar({ html: page('document.getElementById("box").setAttribute("' + name + '", "x");') }),
      /atributo no permitido/
    );
  }
  assert.throws(() => loadSidebar({ html: page('document.getElementById("box").classList;') }), /no expone "classList"/);
  assert.throws(() => loadSidebar({ html: page('document.getElementById("box").dataset;') }), /no expone "dataset"/);
  assert.throws(
    () => loadSidebar({ html: page('document.createElementNS("http://www.w3.org/2000/svg", "svg");') }),
    /document\.createElementNS/
  );
  assert.throws(
    () => loadSidebar({ html: page('document.getElementById("box").addEventListener("input", function () {});') }),
    /evento no permitido/
  );

  // D-50: aria-* y role se escriben, se leen y se borran; el foco queda registrado.
  const dom = loadSidebar({
    html: page(
      'var box = document.getElementById("box"); box.setAttribute("aria-expanded", "true");' +
        ' var read = box.getAttribute("aria-expanded"); box.focus();'
    ),
  });
  assert.equal(dom.context.read, 'true');
  assert.equal(dom.attribute('box', 'aria-expanded'), 'true');
  assert.equal(dom.focusedId(), 'box');
  dom.byId('box').removeAttribute('aria-expanded');
  assert.equal(dom.byId('box').getAttribute('aria-expanded'), null);
  dom.byId('box').blur();
  assert.equal(dom.focusedId(), '');

  // D-50: los aria-*/role estáticos del marcado actual se conservan.
  const sidebar = loadSidebar();
  assert.equal(sidebar.attribute('config-message', 'role'), 'status');
  assert.equal(sidebar.attribute('config-message', 'aria-live'), 'polite');
});


test('P0-2: la casilla de filtros es obligatoria en cada nueva confirmación y no puede saltarse el bloqueo de UI', () => {
  const dom = loaded();
  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), { ok: true, errors: [], token: TOKEN, view: sendView() });
  assert.equal(dom.byId('send-filter-ack').checked, false);
  assert.equal(dom.byId('execute-send').disabled, true);
  dom.click('execute-send', { force: true });
  assert.equal(dom.callsTo('executeSendPending').length, 0);
  dom.setChecked('send-filter-ack', true);
  assert.equal(dom.byId('execute-send').disabled, false);
  dom.click('execute-send');
  assert.deepEqual(dom.lastCall('executeSendPending').args, [TOKEN, false, true]);
});
