'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const { createCampaignFixture, LOG_SHEET_ID, CAMPAIGN_SHEET_ID, DRAFT_ID, USER_EMAIL, ALIAS_EMAIL } = require('./fixtures/campaign');

const WARNING_3 = 'Se enviarán 3 correos reales. Esta acción no se puede deshacer.';
const REVIEW_ROW_2 = 'Fila 2 → alpha@example.test: alpha-notice.pdf, Alpha Letter';
const REVIEW_COMMON = 'Adjuntos comunes: common-terms.pdf';

// `ui` falso: registra cada diálogo y devuelve respuestas configurables.
function createFakeUi(options = {}) {
  const ui = {
    alerts: [],
    confirms: [],
    prompts: [],
    sidebars: 0,
    alert(title, text) {
      ui.alerts.push({ title, text });
    },
    confirm(title, text) {
      ui.confirms.push({ title, text });
      return options.confirm === true;
    },
    prompt(title, text) {
      ui.prompts.push({ title, text });
      return options.prompt === undefined ? null : options.prompt;
    },
    showSidebar() {
      ui.sidebars++;
    },
  };
  return ui;
}

// Contexto con `createServices_` y `createUi_` reemplazados por falsos: las
// declaraciones de función de un script son propiedades del objeto global
// del contexto, así que `menuX()` y las funciones de la sidebar las resuelven.
function setupUi(options = {}, uiOptions = {}) {
  const ctx = loadAppsScript();
  const fixture = createCampaignFixture();
  const fake = createFakeDeps(fixture, options);
  const ui = createFakeUi(uiOptions);
  ctx.createServices_ = () => fake.deps;
  ctx.createUi_ = () => ui;
  return { ctx, fixture, fake, ui };
}

function assertNoEffects(fake) {
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(fake.calls.logEntries.length, 0);
}

// Servicio de Google falso que falla y registra cualquier acceso.
function forbiddenService(name, accessed) {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (typeof prop === 'string') {
          accessed.push(name + '.' + prop);
        }
        return () => {
          throw new Error(name + ' no debería usarse en onOpen');
        };
      },
    }
  );
}

test('onOpen agrega el menú Mail Merge con los cinco ítems y no usa servicios de datos', () => {
  const accessed = [];
  const menus = [];
  const SpreadsheetApp = {
    getUi() {
      return {
        createMenu(title) {
          const menu = { title, items: [], added: false };
          menus.push(menu);
          const builder = {
            addItem(caption, functionName) {
              menu.items.push([caption, functionName]);
              return builder;
            },
            addSeparator() {
              return builder;
            },
            addToUi() {
              menu.added = true;
            },
          };
          return builder;
        },
      };
    },
    getActiveSpreadsheet() {
      accessed.push('SpreadsheetApp.getActiveSpreadsheet');
      throw new Error('onOpen no debería leer la hoja');
    },
    flush() {
      accessed.push('SpreadsheetApp.flush');
    },
  };
  const globals = { SpreadsheetApp };
  for (const name of ['GmailApp', 'DriveApp', 'LockService', 'MailApp', 'PropertiesService', 'Session', 'Utilities', 'HtmlService']) {
    globals[name] = forbiddenService(name, accessed);
  }
  const ctx = loadAppsScript(globals);

  ctx.onOpen();

  assert.equal(menus.length, 1);
  assert.equal(menus[0].title, 'Mail Merge');
  assert.equal(menus[0].added, true);
  assert.deepEqual(menus[0].items, [
    ['Configurar campaña…', 'menuConfigure'],
    ['Validar', 'menuValidate'],
    ['Enviar prueba…', 'menuTestSend'],
    ['Enviar pendientes…', 'menuSendPending'],
    ['Ver registro', 'menuShowLog'],
  ]);
  for (const [, functionName] of menus[0].items) {
    assert.equal(typeof ctx[functionName], 'function', functionName);
  }
  assert.deepEqual(accessed, []);
});

test('createUi_ envuelve SpreadsheetApp.getUi: alert, confirm Sí/No, prompt Aceptar/Cancelar y sidebar', () => {
  const calls = [];
  let nextButton = 'YES';
  let nextPrompt = { button: 'OK', text: ' 3 ' };
  const fakeUi = {
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    alert(title, text, buttons) {
      calls.push(['alert', title, text, buttons]);
      return buttons === 'YES_NO' ? nextButton : 'OK';
    },
    prompt(title, text, buttons) {
      calls.push(['prompt', title, text, buttons]);
      return {
        getSelectedButton: () => nextPrompt.button,
        getResponseText: () => nextPrompt.text,
      };
    },
    showSidebar(output) {
      calls.push(['showSidebar', output.file, output.title]);
    },
  };
  const HtmlService = {
    createHtmlOutputFromFile(file) {
      calls.push(['createHtmlOutputFromFile', file]);
      const output = {
        file,
        title: '',
        setTitle(title) {
          output.title = title;
          return output;
        },
      };
      return output;
    },
  };
  const ctx = loadAppsScript({ SpreadsheetApp: { getUi: () => fakeUi }, HtmlService });
  const ui = ctx.createUi_();

  ui.alert('Título', 'Texto');
  assert.deepEqual(calls.pop(), ['alert', 'Título', 'Texto', 'OK']);

  assert.equal(ui.confirm('Confirmar', '¿Seguro?'), true);
  assert.equal(calls.pop()[3], 'YES_NO');
  nextButton = 'NO';
  assert.equal(ui.confirm('Confirmar', '¿Seguro?'), false);
  nextButton = 'CLOSE';
  assert.equal(ui.confirm('Confirmar', '¿Seguro?'), false);

  assert.equal(ui.prompt('Fila', '¿Qué fila?'), ' 3 ');
  assert.equal(calls.pop()[3], 'OK_CANCEL');
  nextPrompt = { button: 'CANCEL', text: '3' };
  assert.equal(ui.prompt('Fila', '¿Qué fila?'), null);
  nextPrompt = { button: 'CLOSE', text: '3' };
  assert.equal(ui.prompt('Fila', '¿Qué fila?'), null);

  calls.length = 0;
  ctx.menuConfigure();
  assert.deepEqual(calls[0], ['createHtmlOutputFromFile', 'Sidebar']);
  assert.equal(calls[1][0], 'showSidebar');
  assert.equal(calls[1][1], 'Sidebar');
});

test('AC-27: runValidate_ muestra un alert y no envía, no escribe estado ni registro', () => {
  const { ctx, fake, ui } = setupUi();

  ctx.runValidate_(fake.deps, ui);

  assert.equal(ui.alerts.length, 1);
  assert.equal(ui.confirms.length, 0);
  assertNoEffects(fake);
  assert.match(ui.alerts[0].text, /Filas válidas: 3/);
});

test('D-23 (AC-27): el alert de Validar incluye la revisión por fila', () => {
  const { ctx, ui } = setupUi();

  ctx.menuValidate();

  assert.equal(ui.alerts.length, 1);
  assert.ok(ui.alerts[0].text.includes(REVIEW_COMMON));
  assert.ok(ui.alerts[0].text.includes(REVIEW_ROW_2));
  assert.equal(ui.alerts[0].text.includes('drive.google.com'), false);
});

test('AC-17: runSendPending_ con confirm falso no envía ni escribe estado', () => {
  const { ctx, fake, ui } = setupUi({}, { confirm: false });

  ctx.runSendPending_(fake.deps, ui);

  assert.equal(ui.confirms.length, 1);
  assertNoEffects(fake);
  assert.equal(fake.calls.lockCalls.length, 0);
  assert.equal(fake.getCell(2, 'Mail Merge Status'), '');
});

test('AC-17 / D-23: el texto de confirm tiene la advertencia, la cantidad de filas y la revisión por fila', () => {
  const { ctx, fake, ui } = setupUi({}, { confirm: false });

  ctx.runSendPending_(fake.deps, ui);

  const text = ui.confirms[0].text;
  assert.ok(text.includes(WARNING_3), text);
  assert.ok(text.includes('Filas a enviar: 3'), text);
  assert.ok(text.includes('Pestaña: Recipients'), text);
  assert.ok(text.includes('Notice {{Reference}}'), text);
  assert.ok(text.includes('Remitente: ' + USER_EMAIL), text);
  assert.ok(text.includes(REVIEW_COMMON), text);
  assert.ok(text.includes(REVIEW_ROW_2), text);
  assert.ok(text.includes('Fila 3 → beta@example.test: beta-notice.pdf'), text);
  assert.ok(text.includes('Fila 4 → gamma@example.test (sin adjuntos propios)'), text);
  assert.equal(text.includes('drive.google.com'), false);
  assert.equal(text.includes('docs.google.com'), false);
});

test('AC-17: runSendPending_ con confirm verdadero envía y muestra formatSendSummary_', () => {
  const { ctx, fake, ui } = setupUi({}, { confirm: true });

  ctx.menuSendPending();

  assert.equal(ui.confirms.length, 1);
  assert.equal(fake.calls.sent.length, 3);
  assert.deepEqual(
    fake.calls.sent.map((message) => message.to),
    ['alpha@example.test', 'beta@example.test', 'gamma@example.test']
  );
  assert.equal(fake.getCell(2, 'Mail Merge Status'), 'Email Sent');
  assert.equal(ui.alerts.length, 1);
  assert.ok(ui.alerts[0].text.includes('3 correos aceptados por Gmail'), ui.alerts[0].text);
  assert.ok(ui.alerts[0].text.includes('Campaña: camp0001'), ui.alerts[0].text);
});

test('runSendPending_ sin filas válidas solo muestra el informe, sin confirm', () => {
  const { ctx, fake, ui } = setupUi({}, { confirm: true });
  for (const rowNumber of [2, 3, 4]) {
    fake.setCell(rowNumber, 'Mail Merge Status', 'SKIP');
  }

  ctx.runSendPending_(fake.deps, ui);

  assert.equal(ui.confirms.length, 0);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0].text, /Filas válidas: 0/);
  assertNoEffects(fake);
});

test('AC-14: runSendPending_ con errores globales solo muestra el informe, sin confirm', () => {
  const { ctx, fixture, fake, ui } = setupUi({}, { confirm: true });
  fixture.config.from = 'intruso@example.test';

  ctx.runSendPending_(fake.deps, ui);

  assert.equal(ui.confirms.length, 0);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0].text, /no está autorizado/);
  assertNoEffects(fake);
});

for (const answer of [null, 'abc', '1', '2.5', '-3', '']) {
  test(`D-07: runTestSendFromUi_ con respuesta ${JSON.stringify(answer)} no envía`, () => {
    const { ctx, fake, ui } = setupUi({}, { prompt: answer });

    ctx.runTestSendFromUi_(fake.deps, ui);

    assert.equal(ui.prompts.length, 1);
    assertNoEffects(fake);
    if (answer === null) {
      assert.equal(ui.alerts.length, 0);
    } else {
      assert.equal(ui.alerts.length, 1);
      assert.match(ui.alerts[0].text, /número de fila/);
    }
  });
}

test('AC-15: runTestSendFromUi_ con fila 2 envía una prueba y muestra el resultado', () => {
  const { ctx, fake, ui } = setupUi({}, { prompt: ' 2 ' });

  ctx.menuTestSend();

  assert.equal(fake.calls.sent.length, 1);
  assert.equal(fake.calls.sent[0].to, USER_EMAIL);
  assert.equal(fake.calls.sent[0].subject, '[PRUEBA] Notice REF-001');
  assert.equal(fake.calls.statusWrites.length, 0);
  assert.equal(ui.alerts.length, 1);
  assert.ok(ui.alerts[0].text.includes(USER_EMAIL), ui.alerts[0].text);
  assert.ok(ui.alerts[0].text.includes('fila 2'), ui.alerts[0].text);
});

test('AC-16: runTestSendFromUi_ con una fila inválida muestra los errores sin enviar', () => {
  const { ctx, fake, ui } = setupUi({}, { prompt: '99' });

  ctx.runTestSendFromUi_(fake.deps, ui);

  assertNoEffects(fake);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0].text, /No se envió/);
  assert.match(ui.alerts[0].text, /La fila elegida no existe/);
});

test('menuShowLog sin pestaña de registro muestra "Todavía no hay registro."', () => {
  const { ctx, fixture, ui } = setupUi();
  fixture.sheets = fixture.sheets.filter((sheet) => sheet.id !== LOG_SHEET_ID);

  ctx.menuShowLog();

  assert.equal(ui.alerts.length, 1);
  assert.ok(ui.alerts[0].text.includes('Todavía no hay registro.'));
});

test('menuShowLog con pestaña de registro la activa sin alert', () => {
  const { ctx, ui } = setupUi();

  ctx.menuShowLog();

  assert.equal(ui.alerts.length, 0);
});

test('Sidebar: getConfigOptions excluye el registro, lista remitentes y fechas como texto', () => {
  const { ctx, fake } = setupUi();

  const options = plain(ctx.getConfigOptions());

  assert.deepEqual(options.sheets, [{ id: CAMPAIGN_SHEET_ID, name: 'Recipients' }]);
  assert.deepEqual(options.senders, [USER_EMAIL, ALIAS_EMAIL]);
  assert.equal(options.drafts.length, 1);
  assert.equal(options.drafts[0].id, DRAFT_ID);
  assert.equal(options.drafts[0].subject, 'Notice {{Reference}}');
  assert.equal(typeof options.drafts[0].date, 'string');
  assert.deepEqual(options.current, { sheetId: CAMPAIGN_SHEET_ID, draftId: DRAFT_ID, from: USER_EMAIL, replyTo: '' });
  assertNoEffects(fake);
  assert.equal(fake.calls.configWrites.length, 0);
});

test('Sidebar: saveConfig guarda sheetId numérico a partir del texto del select', () => {
  const { ctx, fake } = setupUi();

  ctx.saveConfig({ sheetId: '101', draftId: DRAFT_ID, from: ALIAS_EMAIL, replyTo: ' respuestas@example.test ' });

  assert.equal(fake.calls.configWrites.length, 1);
  assert.deepEqual(plain(fake.calls.configWrites[0]), {
    sheetId: 101,
    draftId: DRAFT_ID,
    from: ALIAS_EMAIL,
    replyTo: 'respuestas@example.test',
  });
  assert.equal(typeof fake.calls.configWrites[0].sheetId, 'number');
});

test('Sidebar: saveConfig acepta Reply-To vacío', () => {
  const { ctx, fake } = setupUi();

  ctx.saveConfig({ sheetId: '101', draftId: DRAFT_ID, from: USER_EMAIL, replyTo: '' });

  assert.equal(fake.calls.configWrites.length, 1);
  assert.equal(fake.calls.configWrites[0].replyTo, '');
});

const VALID_INPUT = { sheetId: '101', draftId: DRAFT_ID, from: USER_EMAIL, replyTo: '' };
const REJECTIONS = [
  ['R-02: pestaña inexistente', { sheetId: '999' }, /pestaña/i],
  ['R-02: sheetId no numérico', { sheetId: 'x' }, /pestaña/i],
  ['R-02: sheetId vacío', { sheetId: '' }, /pestaña/i],
  ['R-02: pestaña de registro', { sheetId: String(LOG_SHEET_ID) }, /registro/i],
  ['R-02: borrador ajeno', { draftId: 'draft-ajeno' }, /borrador/i],
  ['R-04: alias no autorizado', { from: 'intruso@example.test' }, /remitente/i],
  ['R-04: Reply-To inválido', { replyTo: 'no es un correo' }, /Reply-To/],
  ['R-04: Reply-To con dos direcciones', { replyTo: 'a@example.test, b@example.test' }, /Reply-To/],
];

for (const [title, patch, pattern] of REJECTIONS) {
  test(`Sidebar: saveConfig rechaza ${title} sin llamar a setConfig`, () => {
    const { ctx, fake } = setupUi();

    assert.throws(() => ctx.saveConfig({ ...VALID_INPUT, ...patch }), pattern);
    assert.equal(fake.calls.configWrites.length, 0);
  });
}

test('Sidebar: src/Sidebar.html no usa innerHTML y llama a getConfigOptions y saveConfig', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Sidebar.html'), 'utf8');

  assert.equal(html.includes('innerHTML'), false);
  assert.ok(html.includes('getConfigOptions()'));
  assert.ok(html.includes('saveConfig('));
  assert.ok(html.includes('withFailureHandler'));
  assert.ok(html.includes('new Option('));
});
