'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');
const { createFakeDeps } = require('./helpers/fakes');
const {
  createCampaignFixture,
  createLegacyFixture,
  LOG_SHEET_ID,
  CAMPAIGN_SHEET_ID,
  DRAFT_ID,
  USER_EMAIL,
  ALIAS_EMAIL,
} = require('./fixtures/campaign');

const SRC_DIR = path.join(__dirname, '..', 'src');
const CONF_PREFIX = 'MM_CONF_';
const EMAILS = ['alpha@example.test', 'beta@example.test', 'gamma@example.test'];
const V2_HEADERS = [
  'Email Address',
  'First Name',
  'Reference',
  'File Attachments',
  'Resultado',
  'Fecha',
  'Campaña',
  'Detalle',
];
const WRONG_KIND_MESSAGE = 'La confirmación no corresponde a esta operación; volvé a revisar';
const INVALID_MESSAGE = 'La confirmación venció o no es válida; volvé a revisar';
const CONSENT_MESSAGE = 'Falta el consentimiento para reemplazar Fecha, Campaña o Detalle; volvé a revisar y confirmar';

// Contexto con `createServices_` reemplazado por el falso: las declaraciones
// de función de un script son propiedades del objeto global del contexto, así
// que los envoltorios públicos de `Ui.js` lo resuelven.
function setup(options = {}, fixture = createCampaignFixture()) {
  const ctx = loadAppsScript();
  const fake = createFakeDeps(fixture, options);
  ctx.createServices_ = () => fake.deps;
  return { ctx, fixture, fake };
}

function sheetById(fixture, id) {
  return fixture.sheets.find((sheet) => sheet.id === id);
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
          throw new Error(name + ' no debería usarse aquí');
        };
      },
    }
  );
}

// Globales de Google con todos los servicios de datos prohibidos, más los
// que el test reemplace.
function forbiddenGlobals(accessed, overrides) {
  const globals = {};
  for (const name of [
    'GmailApp',
    'DriveApp',
    'LockService',
    'MailApp',
    'PropertiesService',
    'Session',
    'Utilities',
    'CacheService',
    'HtmlService',
  ]) {
    globals[name] = forbiddenService(name, accessed);
  }
  return { ...globals, ...overrides };
}

// `true` si `value` es igual a su ida y vuelta por JSON: solo `null`,
// booleanos, números finitos, textos, arrays y objetos planos (D-44). Una
// `Date`, un `Map`, una función, un `undefined` o un `NaN` no sobreviven.
function equalsJsonRoundTrip(value) {
  function same(a, b) {
    if (a === null || typeof a !== 'object') {
      return Object.is(a, b);
    }
    const tag = Object.prototype.toString.call(a);
    if (b === null || typeof b !== 'object' || tag !== Object.prototype.toString.call(b)) {
      return false;
    }
    if (tag === '[object Array]') {
      return a.length === b.length && a.every((item, i) => same(item, b[i]));
    }
    if (tag !== '[object Object]') {
      return false;
    }
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => same(a[key], b[key]));
  }
  return value !== undefined && same(value, JSON.parse(JSON.stringify(value)));
}

function assertNoWrites(fake) {
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.equal(fake.calls.headerWrites.length, 0);
  assert.equal(fake.calls.cachePuts.length, 0);
  assert.equal(fake.calls.cacheRemoves.length, 0);
  assert.equal(fake.calls.lockCalls.length, 0);
  assert.equal(fake.calls.configWrites.length, 0);
}

// --- AC-32: todo en la sidebar, sin diálogos -------------------------------

test('AC-32: ningún src/*.js usa Ui.alert, Ui.prompt ni ButtonSet', () => {
  const files = fs.readdirSync(SRC_DIR).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const code = fs.readFileSync(path.join(SRC_DIR, name), 'utf8');
    for (const forbidden of ['.alert(', '.prompt(', 'ButtonSet']) {
      assert.equal(code.includes(forbidden), false, `${name} contiene ${forbidden}`);
    }
  }
});

test('AC-32: src/Sidebar.html no usa innerHTML ni alert, confirm o prompt', () => {
  const html = fs.readFileSync(path.join(SRC_DIR, 'Sidebar.html'), 'utf8');

  assert.equal(html.includes('innerHTML'), false);
  assert.doesNotMatch(html, /\b(alert|confirm|prompt)\s*\(/);
});

test('AC-32: onOpen agrega solo "Abrir Mail Merge" y no usa servicios de datos', () => {
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
  const ctx = loadAppsScript(forbiddenGlobals(accessed, { SpreadsheetApp }));

  ctx.onOpen();

  assert.equal(menus.length, 1);
  assert.equal(menus[0].title, 'Mail Merge');
  assert.equal(menus[0].added, true);
  assert.deepEqual(menus[0].items, [['Abrir Mail Merge', 'menuOpenPanel']]);
  assert.equal(typeof ctx.menuOpenPanel, 'function');
  assert.deepEqual(accessed, []);
});

test('D-25: menuOpenPanel abre la sidebar "Sidebar" con el título "Mail Merge" una sola vez', () => {
  const accessed = [];
  const calls = [];
  const SpreadsheetApp = {
    getUi() {
      return {
        showSidebar(output) {
          calls.push(['showSidebar', output.file, output.title]);
        },
      };
    },
    getActiveSpreadsheet() {
      accessed.push('SpreadsheetApp.getActiveSpreadsheet');
      throw new Error('abrir el panel no debería leer la hoja');
    },
  };
  const HtmlService = {
    createHtmlOutputFromFile(file) {
      calls.push(['createHtmlOutputFromFile', file]);
      const output = {
        file,
        title: '',
        setTitle(title) {
          calls.push(['setTitle', title]);
          output.title = title;
          return output;
        },
      };
      return output;
    },
  };
  const ctx = loadAppsScript(forbiddenGlobals(accessed, { SpreadsheetApp, HtmlService }));

  ctx.menuOpenPanel();

  assert.deepEqual(calls, [
    ['createHtmlOutputFromFile', 'Sidebar'],
    ['setTitle', 'Mail Merge'],
    ['showSidebar', 'Sidebar', 'Mail Merge'],
  ]);
  assert.deepEqual(accessed, []);
});

test('AC-32 / AC-52: src/Sidebar.html usa getPanelState, executeSendPending, getSendProgress, cancelConfirmation, withFailureHandler y new Option', () => {
  const html = fs.readFileSync(path.join(SRC_DIR, 'Sidebar.html'), 'utf8');

  assert.ok(html.includes('getPanelState()'));
  assert.equal(html.includes('getConfigOptions'), false);
  assert.ok(html.includes('saveConfig('));
  assert.ok(html.includes('executeSendPending('));
  assert.ok(html.includes('getSendProgress('));
  assert.ok(html.includes('cancelConfirmation('));
  assert.ok(html.includes('withFailureHandler'));
  assert.ok(html.includes('new Option('));
});

// --- AC-33: validar es de solo lectura -------------------------------------

test('AC-33: validateCampaign_ no envía ni escribe hoja, caché, configuración ni toma el lock; lista todas las filas válidas', () => {
  const { ctx, fake } = setup();

  const view = plain(ctx.validateCampaign_(fake.deps));

  assertNoWrites(fake);
  assert.equal(view.ok, true, JSON.stringify(view.globalErrors));
  assert.deepEqual(view.counts, { valid: 3, invalid: 0, excluded: 0 });
  assert.deepEqual(
    view.rows.map((row) => [row.rowNumber, row.email]),
    [
      [2, EMAILS[0]],
      [3, EMAILS[1]],
      [4, EMAILS[2]],
    ]
  );
  assert.equal(view.moreRows, 0);
  assert.equal(view.setup, null);
});

test('AC-33: el envoltorio validateCampaign() devuelve la misma vista sin efectos', () => {
  const { ctx, fake } = setup();

  const view = plain(ctx.validateCampaign());

  assertNoWrites(fake);
  assert.deepEqual(view, plain(ctx.validateCampaign_(fake.deps)));
});

// --- getPanelState_ y saveConfig_ (portados de la V1 + D-39, D-32) ---------

const VALID_INPUT = { sheetId: '101', draftId: DRAFT_ID, from: USER_EMAIL, replyTo: '' };

test('getPanelState_ lista pestañas, borradores y remitentes y la configuración actual, sin efectos', () => {
  const { ctx, fake } = setup();

  const state = plain(ctx.getPanelState_(fake.deps));

  assert.deepEqual(state.sheets, [{ id: CAMPAIGN_SHEET_ID, name: 'Recipients' }]);
  assert.deepEqual(state.senders, [USER_EMAIL, ALIAS_EMAIL]);
  assert.deepEqual(state.drafts, [{ id: DRAFT_ID, subject: 'Notice {{Reference}}', date: '2026-11-01T10:00:00.000Z' }]);
  assert.deepEqual(state.current, {
    sheetId: CAMPAIGN_SHEET_ID,
    draftId: DRAFT_ID,
    from: USER_EMAIL,
    replyTo: '',
    campaignName: '',
  });
  assertNoWrites(fake);
});

test('getPanelState_ sin configuración guardada devuelve current: null', () => {
  const { ctx, fixture, fake } = setup();
  fixture.config = null;

  assert.equal(plain(ctx.getPanelState_(fake.deps)).current, null);
});

test('saveConfig_ guarda sheetId numérico a partir del texto del select', () => {
  const { ctx, fake } = setup();

  const saved = plain(
    ctx.saveConfig_(fake.deps, { sheetId: '101', draftId: DRAFT_ID, from: ALIAS_EMAIL, replyTo: ' respuestas@example.test ' })
  );

  const expected = {
    sheetId: 101,
    draftId: DRAFT_ID,
    from: ALIAS_EMAIL,
    replyTo: 'respuestas@example.test',
    campaignName: '',
  };
  assert.equal(fake.calls.configWrites.length, 1);
  assert.deepEqual(plain(fake.calls.configWrites[0]), expected);
  assert.equal(typeof fake.calls.configWrites[0].sheetId, 'number');
  assert.deepEqual(saved, expected);
});

test('saveConfig_ acepta Reply-To vacío', () => {
  const { ctx, fake } = setup();

  ctx.saveConfig_(fake.deps, VALID_INPUT);

  assert.equal(fake.calls.configWrites.length, 1);
  assert.equal(fake.calls.configWrites[0].replyTo, '');
});

const REJECTIONS = [
  ['R-02: pestaña inexistente', { sheetId: '999' }, /pestaña/i],
  ['R-02: sheetId no numérico', { sheetId: 'x' }, /pestaña/i],
  ['R-02: sheetId vacío', { sheetId: '' }, /pestaña/i],
  ['R-02: borrador ajeno', { draftId: 'draft-ajeno' }, /borrador/i],
  ['R-04: alias no autorizado', { from: 'intruso@example.test' }, /remitente/i],
  ['R-04: Reply-To inválido', { replyTo: 'no es un correo' }, /Reply-To/],
  ['R-04: Reply-To con dos direcciones', { replyTo: 'a@example.test, b@example.test' }, /Reply-To/],
];

for (const [title, patch, pattern] of REJECTIONS) {
  test(`saveConfig_ rechaza ${title} sin llamar a setConfig`, () => {
    const { ctx, fake } = setup();

    assert.throws(() => ctx.saveConfig_(fake.deps, { ...VALID_INPUT, ...patch }), pattern);
    assert.equal(fake.calls.configWrites.length, 0);
  });
}

test('AC-46 / D-39: saveConfig_ guarda el nombre de campaña saneado (sin CR/LF ni tabulaciones, recortado)', () => {
  const { ctx, fake } = setup();

  const saved = plain(ctx.saveConfig_(fake.deps, { ...VALID_INPUT, campaignName: '  Aviso\r\nde\tnoviembre  ' }));

  assert.equal(saved.campaignName, 'Aviso de noviembre');
  assert.equal(fake.calls.configWrites[0].campaignName, 'Aviso de noviembre');
  assert.equal(plain(ctx.getPanelState_(fake.deps)).current.campaignName, 'Aviso de noviembre');
});

test('AC-46 / D-39: saveConfig_ acepta 80 caracteres y rechaza 81 sin llamar a setConfig', () => {
  const { ctx, fake } = setup();

  assert.throws(() => ctx.saveConfig_(fake.deps, { ...VALID_INPUT, campaignName: 'x'.repeat(81) }), /80 caracteres/);
  assert.equal(fake.calls.configWrites.length, 0);

  // El límite se mide después de recortar.
  ctx.saveConfig_(fake.deps, { ...VALID_INPUT, campaignName: ' ' + 'x'.repeat(80) + ' ' });
  assert.equal(fake.calls.configWrites.length, 1);
  assert.equal(fake.calls.configWrites[0].campaignName, 'x'.repeat(80));
});

test('AC-46 / D-39: saveConfig_ con nombre vacío, en blanco o ausente guarda campaignName: ""', () => {
  for (const campaignName of [undefined, null, '', '   ', '\r\n']) {
    const { ctx, fake } = setup();
    const input = { ...VALID_INPUT };
    if (campaignName !== undefined) {
      input.campaignName = campaignName;
    }

    const saved = plain(ctx.saveConfig_(fake.deps, input));

    assert.equal(saved.campaignName, '', JSON.stringify(campaignName));
    assert.equal(fake.calls.configWrites[0].campaignName, '');
    assert.equal(plain(ctx.getPanelState_(fake.deps)).current.campaignName, '');
  }
});

test('AC-51 / D-32: getPanelState_ no ofrece "Registro Mail Merge" y saveConfig_ la rechaza', () => {
  const { ctx, fake } = setup();

  const names = plain(ctx.getPanelState_(fake.deps)).sheets.map((sheet) => sheet.name);
  assert.equal(names.includes('Registro Mail Merge'), false);

  assert.throws(() => ctx.saveConfig_(fake.deps, { ...VALID_INPUT, sheetId: String(LOG_SHEET_ID) }), /registro/i);
  assert.equal(fake.calls.configWrites.length, 0);
});

test('AC-51 / D-32: preparar columnas, la prueba y el envío dejan intacta la pestaña "Registro Mail Merge"', () => {
  const fixture = createLegacyFixture();
  const log = sheetById(fixture, LOG_SHEET_ID);
  log.values.push(['2026-10-01 09:00', 'camp0001', 'Recipients', '5', 'delta@example.test', 'Email Sent', 'Aceptado por Gmail']);
  log.hiddenByUser.push(false);
  log.hiddenByFilter.push(false);
  const before = JSON.parse(JSON.stringify(log));
  const { ctx, fake } = setup({}, fixture);

  const validation = plain(ctx.validateCampaign());
  assert.equal(validation.setup.needed, true);
  assert.equal(plain(ctx.applyColumnSetup(validation.setup.headerKey)).ok, true);
  const trial = plain(ctx.prepareTestSend(2));
  assert.equal(trial.ok, true, JSON.stringify(trial.errors));
  assert.equal(plain(ctx.executeTestSend(trial.token)).ok, true);
  const prep = plain(ctx.prepareSendPending());
  assert.equal(prep.ok, true, JSON.stringify(prep.errors));
  const result = plain(ctx.executeSendPending(prep.token, true, true));
  assert.equal(result.ok, true, JSON.stringify(result));

  assert.equal(fake.calls.sent.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(log)), before);
  assert.equal(fake.calls.cellWrites.some((write) => write.sheetId === LOG_SHEET_ID), false);
  assert.equal(fake.calls.headerWrites.some((write) => write.sheetId === LOG_SHEET_ID), false);
});

// --- D-44: contrato con el cliente -----------------------------------------

test('D-44: el resultado de cada función pública …_ es igual a su ida y vuelta por JSON', () => {
  const { ctx, fake } = setup();
  const results = {};

  results.getPanelState_ = ctx.getPanelState_(fake.deps);
  results.saveConfig_ = ctx.saveConfig_(fake.deps, { ...VALID_INPUT, campaignName: 'Aviso' });
  results.validateCampaign_ = ctx.validateCampaign_(fake.deps);
  results.prepareTestSendRejected = ctx.prepareTestSend_(fake.deps, 99);
  const trial = ctx.prepareTestSend_(fake.deps, 2);
  results.prepareTestSend_ = trial;
  results.executeTestSend_ = ctx.executeTestSend_(fake.deps, trial.token);
  const prep = ctx.prepareSendPending_(fake.deps);
  results.prepareSendPending_ = prep;
  results.getSendProgressMissing = ctx.getSendProgress_(fake.deps, prep.token);
  results.executeSendPending_ = ctx.executeSendPending_(fake.deps, prep.token, undefined, true);
  results.executeSendPendingRejected = ctx.executeSendPending_(fake.deps, prep.token, undefined, true);
  results.getSendProgress_ = ctx.getSendProgress_(fake.deps, prep.token);
  results.cancelConfirmation = ctx.cancelConfirmation(prep.token);

  const legacy = setup({}, createLegacyFixture());
  const key = plain(legacy.ctx.validateCampaign_(legacy.fake.deps)).setup.headerKey;
  results.applyColumnSetup = legacy.ctx.applyColumnSetup(key);

  assert.equal(results.prepareTestSend_.ok, true);
  assert.equal(results.executeSendPending_.ok, true);
  assert.equal(results.getSendProgress_.found, true);
  for (const [name, value] of Object.entries(results)) {
    assert.ok(equalsJsonRoundTrip(value), `${name} no es JSON plano: ${JSON.stringify(value)}`);
  }
});

test('D-44: getPanelState_ devuelve las fechas de los borradores como texto, también si llegan como Date', () => {
  const { ctx, fixture, fake } = setup();
  fixture.gmail.drafts[0].date = new Date(Date.UTC(2026, 10, 1, 10, 0, 0));
  fixture.gmail.drafts.push({ ...fixture.gmail.drafts[0], id: 'draft-002', date: '2026-11-02T08:30:00.000Z' });

  const state = ctx.getPanelState_(fake.deps);

  assert.ok(equalsJsonRoundTrip(state));
  assert.deepEqual(
    plain(state.drafts).map((draft) => draft.date),
    ['2026-11-01T10:00:00.000Z', '2026-11-02T08:30:00.000Z']
  );
});

// --- Envoltorios públicos (createServices_ reemplazado por el falso) -------

test('envoltorios: prepareSendPending() + executeSendPending(token) envían los tres correos y getSendProgress lo informa', () => {
  const { ctx, fake } = setup();

  const prep = plain(ctx.prepareSendPending());
  assert.equal(prep.ok, true, JSON.stringify(prep.errors));
  assert.equal(prep.view.count, 3);
  assert.equal(fake.calls.sent.length, 0);

  const result = plain(ctx.executeSendPending(prep.token, undefined, true));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.kind, 'send');
  assert.deepEqual(
    fake.calls.sent.map((message) => message.to),
    EMAILS
  );
  assert.equal(result.counts.sent, 3);
  for (const row of [2, 3, 4]) {
    assert.equal(fake.getCell(row, 'Resultado'), 'Email Sent');
  }

  const progress = plain(ctx.getSendProgress(prep.token));
  assert.equal(progress.found, true);
  assert.equal(progress.progress.state, 'TERMINADO');
  assert.equal(progress.progress.counts.sent, 3);
});

test('envoltorios: executeSendPending con un token de prueba se rechaza sin enviar', () => {
  const { ctx, fake } = setup();

  const trial = plain(ctx.prepareTestSend('2'));
  assert.equal(trial.ok, true, JSON.stringify(trial.errors));
  const result = plain(ctx.executeSendPending(trial.token));

  assert.equal(result.ok, false);
  assert.equal(result.stoppedReason, WRONG_KIND_MESSAGE);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
});

test('envoltorios: cancelConfirmation(token) borra la confirmación y un execute posterior se rechaza', () => {
  const { ctx, fixture, fake } = setup();

  const prep = plain(ctx.prepareSendPending());
  assert.ok(Object.prototype.hasOwnProperty.call(fixture.cache, CONF_PREFIX + prep.token));

  assert.deepEqual(plain(ctx.cancelConfirmation(prep.token)), { ok: true });
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.cache, CONF_PREFIX + prep.token), false);

  const result = plain(ctx.executeSendPending(prep.token, undefined, true));
  assert.equal(result.ok, false);
  assert.equal(result.stoppedReason, INVALID_MESSAGE);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
});

test('envoltorios: applyColumnSetup(headerKey) sobre la hoja V1 deja los encabezados V2', () => {
  const fixture = createLegacyFixture();
  const { ctx, fake } = setup({}, fixture);

  const key = plain(ctx.validateCampaign()).setup.headerKey;
  const result = plain(ctx.applyColumnSetup(key));

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(sheetById(fixture, CAMPAIGN_SHEET_ID).values[0], V2_HEADERS);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);
  assert.equal(plain(ctx.validateCampaign()).ok, true);
});

test('envoltorios: prepareTestSend("2") + executeTestSend(token) envían un correo a la cuenta propia', () => {
  const { ctx, fake } = setup();

  const trial = plain(ctx.prepareTestSend('2'));
  assert.equal(trial.ok, true, JSON.stringify(trial.errors));
  assert.equal(trial.view.to, USER_EMAIL);
  const result = plain(ctx.executeTestSend(trial.token));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.kind, 'test');
  assert.equal(fake.calls.sent.length, 1);
  assert.equal(fake.calls.sent[0].to, USER_EMAIL);
  assert.equal(fake.calls.sent[0].subject, '[PRUEBA] Notice REF-001');
  assert.equal(fake.getCell(2, 'Resultado'), 'Email Sent');
});

test('D-47: executeSendPending pasa el consentimiento sin alterarlo (solo true vale)', () => {
  const { ctx, fake } = setup();
  fake.setCell(2, 'Detalle', 'nota previa');

  const first = plain(ctx.prepareSendPending());
  assert.equal(first.view.consentRequired, true);
  const rejected = plain(ctx.executeSendPending(first.token, undefined, true));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.stoppedReason, CONSENT_MESSAGE);

  const second = plain(ctx.prepareSendPending());
  const coerced = plain(ctx.executeSendPending(second.token, 'true', true));
  assert.equal(coerced.ok, false);
  assert.equal(coerced.stoppedReason, CONSENT_MESSAGE);
  assert.equal(fake.calls.sent.length, 0);
  assert.equal(fake.calls.cellWrites.length, 0);

  const third = plain(ctx.prepareSendPending());
  const result = plain(ctx.executeSendPending(third.token, true, true));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    fake.calls.sent.map((message) => message.to),
    EMAILS
  );
});

test('D-47: executeTestSend pasa el consentimiento sin alterarlo (solo true vale)', () => {
  const { ctx, fake } = setup();
  fake.setCell(2, 'Campaña', 'campaña anterior');

  const first = plain(ctx.prepareTestSend(2));
  assert.equal(first.view.consentRequired, true);
  const rejected = plain(ctx.executeTestSend(first.token));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.stoppedReason, CONSENT_MESSAGE);
  assert.equal(fake.calls.sent.length, 0);

  const second = plain(ctx.prepareTestSend(2));
  const result = plain(ctx.executeTestSend(second.token, true));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.sent.length, 1);
  assert.equal(fake.calls.sent[0].to, USER_EMAIL);
});

test('envoltorios: getPanelState() y saveConfig(input) usan createServices_()', () => {
  const { ctx, fake } = setup();

  const saved = plain(ctx.saveConfig({ ...VALID_INPUT, campaignName: 'Aviso' }));

  assert.equal(saved.campaignName, 'Aviso');
  assert.equal(fake.calls.configWrites.length, 1);
  assert.equal(plain(ctx.getPanelState()).current.campaignName, 'Aviso');
});
