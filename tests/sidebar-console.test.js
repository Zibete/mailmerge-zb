'use strict';

// Eclipse Console (plan `plans/2026-11-14_eclipse-console-ui.md`): estructura
// del Command Center, accesibilidad y contraste de la paleta. El `<script>` de
// `src/Sidebar.html` corre en el DOM falso (`tests/helpers/fake-dom.js`); el
// contraste se calcula sobre el `<style>` real. Solo datos ficticios.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSidebar } = require('./helpers/fake-dom');

const SIDEBAR = path.join(__dirname, '..', 'src', 'Sidebar.html');

function readSidebar() {
  return fs.readFileSync(SIDEBAR, 'utf8');
}

// --- AC-62: contraste WCAG AA de los tokens ---------------------------------

// Tokens `--nombre: #rrggbb` del bloque `:root` del único `<style>`.
function colorTokens(html) {
  const style = /<style\b[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  assert.ok(style, 'src/Sidebar.html tiene <style>');
  const root = /:root\s*\{([^}]*)\}/.exec(style[1]);
  assert.ok(root, 'el <style> define :root');
  const tokens = {};
  for (const match of root[1].matchAll(/--([a-z0-9-]+)\s*:\s*#([0-9a-fA-F]{6})\b/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

// Luminancia relativa y ratio de contraste de WCAG 2.x (SC 1.4.3), sin redondear.
function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const r = channel(parseInt(hex.slice(0, 2), 16));
  const g = channel(parseInt(hex.slice(2, 4), 16));
  const b = channel(parseInt(hex.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('AC-62 / D-51: los tokens de color cumplen WCAG AA', () => {
  const tokens = colorTokens(readSidebar());
  const pairs = [
    ['text', 'bg', 4.5],
    ['text', 'surface', 4.5],
    ['text', 'surface-2', 4.5],
    ['muted', 'bg', 4.5],
    ['muted', 'surface', 4.5],
    ['muted', 'surface-2', 4.5],
    ['warn', 'surface', 4.5],
    ['danger', 'surface', 4.5],
    ['accent-ink', 'accent', 4.5],
    ['accent', 'surface', 3],
  ];
  for (const [fg, bg, minimum] of pairs) {
    assert.ok(tokens[fg], `falta el token --${fg}`);
    assert.ok(tokens[bg], `falta el token --${bg}`);
    const ratio = contrast(tokens[fg], tokens[bg]);
    assert.ok(ratio >= minimum, `--${fg}/--${bg} = ${ratio.toFixed(2)}:1, se exige ${minimum}:1`);
  }
  // Control de la fórmula: #6B7280 sobre --surface no alcanza 4.5:1.
  assert.ok(contrast('6B7280', tokens.surface) < 4.5);
});

// --- Estructura del Command Center (D-54, D-57) -----------------------------

const INVARIANT_IDS = [
  'sheet', 'draft', 'from', 'reply-to', 'campaign-name', 'save', 'config-message',
  'validate', 'validation-message', 'validation-result', 'setup-box', 'setup-list', 'apply-setup',
  'test-row', 'review-test', 'test-message', 'test-confirmation', 'test-view', 'test-consent-box',
  'test-consent', 'test-consent-text', 'test-consent-rows', 'execute-test', 'cancel-test',
  'review-send', 'send-message', 'send-confirmation', 'send-view', 'send-filter-ack',
  'send-consent-box', 'send-consent', 'send-consent-text', 'send-consent-rows', 'execute-send',
  'cancel-send', 'progress-section', 'progress-status', 'count-total', 'count-processed',
  'count-sent', 'count-skipped', 'count-review', 'count-pending', 'progress-bar',
  'progress-guidance', 'stopped-reason', 'summary', 'progress-truncated', 'results-body', 'close',
  'section-campaign', 'section-validation', 'section-test', 'section-send',
];

const STEPS = [
  { n: 1, section: 'section-campaign', title: 'Campaña' },
  { n: 2, section: 'section-validation', title: 'Validación' },
  { n: 3, section: 'section-test', title: 'Prueba' },
  { n: 4, section: 'section-send', title: 'Envío' },
];

test('D-57 / D-54: los pasos, el riel y la consola existen con aria-controls hacia su cuerpo, sin crear elementos ni temporizadores al cargar', () => {
  const html = readSidebar();
  const dom = loadSidebar();

  for (const id of INVARIANT_IDS) {
    assert.ok(dom.byId(id), `falta el id ${id}`);
  }
  assert.equal(dom.byId('results-body').tagName, 'TBODY');
  assert.equal(dom.byId('progress-bar').tagName, 'PROGRESS');
  assert.equal(dom.text('close'), 'Cerrar');

  for (const step of STEPS) {
    const toggle = dom.byId(`step-${step.n}-toggle`);
    const body = dom.byId(`step-${step.n}-body`);
    assert.equal(toggle.tagName, 'BUTTON');
    assert.equal(toggle.type, 'button');
    assert.equal(dom.attribute(`step-${step.n}-toggle`, 'aria-controls'), `step-${step.n}-body`);
    // Desde el paso 3 del plan el acordeón abre un solo paso al cargar (D-57):
    // aria-expanded acompaña la visibilidad de cada cuerpo.
    assert.equal(
      dom.attribute(`step-${step.n}-toggle`, 'aria-expanded'),
      dom.isVisible(`step-${step.n}-body`) ? 'true' : 'false'
    );
    assert.equal(body.tagName, 'DIV');
    assert.equal(dom.byId(`step-${step.n}-summary`).tagName, 'SPAN');
    assert.equal(dom.byId(`step-${step.n}-chip`).tagName, 'SPAN');
    // El cuerpo y la cabecera viven dentro de la sección del paso.
    const sectionChildren = dom.childrenOf(step.section).map((child) => child.id);
    assert.ok(sectionChildren.includes(`step-${step.n}-toggle`), `step-${step.n}-toggle dentro de ${step.section}`);
    assert.ok(sectionChildren.includes(`step-${step.n}-body`), `step-${step.n}-body dentro de ${step.section}`);
    // El título literal está dentro del botón del paso.
    const markup = new RegExp(`id="step-${step.n}-toggle"[^>]*>[\\s\\S]*?</button>`).exec(html);
    assert.ok(markup && markup[0].includes(step.title), `el toggle del paso ${step.n} muestra "${step.title}"`);
  }

  for (let n = 1; n <= 4; n++) {
    assert.ok(dom.byId(`rail-${n}`), `falta rail-${n}`);
  }
  assert.equal(dom.byId('console-title').tagName, 'H2');
  assert.equal(dom.text('console-title'), 'Progreso y resultados');
  assert.match(html, /<h2 id="console-title" tabindex="-1">Progreso y resultados<\/h2>/);
  assert.ok(dom.childrenOf('progress-section').some((child) => child.id === 'console-title'));

  // Todos los botones del marcado declaran type="button".
  for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
    assert.match(match[1], /\stype="button"/, `botón sin type="button": ${match[0]}`);
  }

  assert.equal(dom.created.length, 0, 'la carga no crea elementos');
  assert.deepEqual(dom.pendingTimers(), [], 'la carga no deja temporizadores');
  assert.equal(dom.callsTo('getPanelState').length, 1);
});

// --- Fases y Command Center (AC-56, D-56, D-57) -----------------------------

const views = require('./fixtures/sidebar-views');

const STEP_IDS = [1, 2, 3, 4];

function openSteps(dom) {
  return STEP_IDS.filter((n) => dom.isVisible(`step-${n}-body`));
}

function isPrimary(dom, id) {
  return dom.byId(id).className.split(' ').includes('btn--primary');
}

function loaded(panel = views.panelState()) {
  const dom = loadSidebar();
  dom.resolve(dom.calls[0], panel);
  return dom;
}

function validated(variant = 'ok', dom = loaded()) {
  dom.click('validate');
  dom.resolve(dom.lastCall('validateCampaign'), views.validationView(variant));
  return dom;
}

function withSendConfirmation(dom, view = views.confirmationView('send'), token = views.TOKEN) {
  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), { ok: true, errors: [], token, view });
  dom.setChecked('send-filter-ack', true);
  return dom;
}

function withTestConfirmation(dom, view = views.confirmationView('test')) {
  dom.setValue('test-row', '2');
  dom.click('review-test');
  dom.resolve(dom.lastCall('prepareTestSend'), { ok: true, errors: [], token: views.TEST_TOKEN, view });
  return dom;
}

function finishedSend(result = views.sendResult('ok')) {
  const dom = withSendConfirmation(validated('ok'));
  dom.click('execute-send');
  dom.resolve(dom.lastCall('executeSendPending'), result);
  return dom;
}

test('AC-56 / D-56: al cargar sin configuración la fase es sin-configurar, el paso 1 está abierto y Guardar es el primario', () => {
  const dom = loadSidebar();
  assert.equal(dom.MailMergePanel.phase(), 'sin-configurar', 'antes de la respuesta de getPanelState');
  dom.resolve(dom.calls[0], views.panelState({ current: null }));

  assert.equal(dom.MailMergePanel.phase(), 'sin-configurar');
  assert.deepEqual(openSteps(dom), [1]);
  assert.equal(dom.isVisible('step-2-body'), false);
  assert.equal(isPrimary(dom, 'save'), true);
  assert.equal(isPrimary(dom, 'validate'), false);
  assert.equal(dom.attribute('step-1-toggle', 'aria-expanded'), 'true');
  assert.equal(dom.attribute('step-2-toggle', 'aria-expanded'), 'false');
  assert.equal(dom.attribute('rail-1', 'aria-current'), 'step');
  assert.equal(dom.text('step-1-chip'), 'Sin guardar');
  assert.equal(dom.text('step-2-chip'), 'Pendiente');
  assert.equal(dom.isVisible('skip-test'), false);
  assert.equal(dom.text('status-live'), 'Paso 1: Campaña');
  assert.equal(dom.attribute('status-live', 'role'), 'status');
  assert.equal(dom.attribute('status-live', 'aria-live'), 'polite');
  assert.equal(dom.created.length, 0, 'la carga no crea elementos');
  assert.deepEqual(dom.pendingTimers(), [], 'la carga no deja temporizadores');
  assert.equal(dom.calls.length, 1);

  // Sin borradores o con getPanelState fallido la fase sigue siendo sin-configurar.
  const noDrafts = loaded(views.panelState({ drafts: [] }));
  assert.equal(noDrafts.MailMergePanel.phase(), 'sin-configurar');
  const failed = loadSidebar();
  failed.fail(failed.calls[0], new Error('Sin acceso a la hoja'));
  assert.equal(failed.MailMergePanel.phase(), 'sin-configurar');
  assert.deepEqual(openSteps(failed), [1]);
});

test('AC-56 / D-56: con configuración guardada la fase es configurada y Validar es el primario', () => {
  const dom = loaded();

  assert.equal(dom.MailMergePanel.phase(), 'configurada');
  assert.deepEqual(openSteps(dom), [2]);
  assert.equal(dom.focusedId(), 'step-2-toggle');
  assert.equal(isPrimary(dom, 'validate'), true);
  assert.equal(isPrimary(dom, 'save'), false);
  assert.equal(dom.byId('save').className, 'btn');
  assert.equal(dom.text('step-1-summary'), 'Otoño 2026');
  assert.equal(dom.text('step-1-chip'), 'Lista');
  assert.equal(dom.text('step-2-chip'), 'Pendiente');
  assert.equal(dom.text('step-2-summary'), '');

  // Vaciar un select vuelve a sin-configurar sin esperar otra acción.
  dom.setValue('draft', '');
  assert.equal(dom.MailMergePanel.phase(), 'sin-configurar');
  assert.deepEqual(openSteps(dom), [1]);
  dom.setValue('draft', 'draft-1');
  assert.equal(dom.MailMergePanel.phase(), 'configurada');

  // Primera apertura: guardar con éxito pasa a configurada.
  const fresh = loaded(views.panelState({ current: null }));
  fresh.setValue('sheet', '101');
  fresh.setValue('draft', 'draft-1');
  fresh.setValue('from', views.USER);
  fresh.setValue('campaign-name', 'Primavera');
  assert.equal(fresh.MailMergePanel.phase(), 'sin-configurar', 'sin guardar todavía');
  fresh.click('save');
  fresh.resolve(fresh.lastCall('saveConfig'), { sheetId: 101, draftId: 'draft-1', from: views.USER, replyTo: '', campaignName: 'Primavera' });
  assert.equal(fresh.MailMergePanel.phase(), 'configurada');
  assert.equal(fresh.text('step-1-summary'), 'Primavera');
  assert.equal(fresh.text('step-1-chip'), 'Lista');
});

test('AC-56 / D-57: una validación correcta abre el paso 3 con foco y resume el paso 2', () => {
  const dom = validated('ok');

  assert.equal(dom.MailMergePanel.phase(), 'lista');
  assert.equal(dom.isVisible('step-3-body'), true);
  assert.deepEqual(openSteps(dom), [3]);
  assert.equal(dom.focusedId(), 'step-3-toggle');
  assert.equal(dom.text('step-2-summary'), '2 elegibles · 1 errores');
  assert.equal(dom.text('step-2-chip'), 'Lista');
  assert.equal(isPrimary(dom, 'review-test'), true);
  assert.equal(isPrimary(dom, 'validate'), false);
  assert.equal(dom.isVisible('skip-test'), true);
  assert.equal(dom.text('skip-test'), 'Ir a Envío');
  assert.equal(isPrimary(dom, 'skip-test'), false);

  const before = dom.calls.length;
  dom.click('skip-test');
  assert.equal(dom.calls.length, before, 'Ir a Envío no llama al servidor');
  assert.deepEqual(openSteps(dom), [4]);
  assert.equal(dom.focusedId(), 'step-4-toggle');
  assert.equal(dom.MailMergePanel.phase(), 'lista');

  // Guardar de nuevo borra la validación: fase configurada y paso 2 pendiente.
  dom.click('save');
  dom.resolve(dom.lastCall('saveConfig'), { sheetId: 202, draftId: 'draft-1', from: 'alias@example.test', replyTo: '', campaignName: 'Otoño 2026' });
  assert.equal(dom.MailMergePanel.phase(), 'configurada');
  assert.equal(dom.text('step-2-chip'), 'Pendiente');
  assert.equal(dom.text('step-2-summary'), '');
  assert.equal(dom.isVisible('skip-test'), false);
});

test('AC-56 / D-57: el toggle de un paso cerrado lo abre y el del paso con confirmación viva está deshabilitado', () => {
  const dom = loaded();
  assert.equal(dom.byId('step-3-toggle').disabled, false);
  assert.equal(dom.byId('step-4-toggle').disabled, false);

  assert.equal(dom.click('step-1-toggle'), true);
  assert.deepEqual(openSteps(dom), [1]);
  assert.equal(dom.MailMergePanel.phase(), 'configurada', 'el acordeón no cambia la fase');

  withSendConfirmation(dom);
  assert.equal(dom.MailMergePanel.phase(), 'revisando-envio');
  assert.equal(dom.byId('step-4-toggle').disabled, true);
  assert.equal(dom.byId('step-3-toggle').disabled, false);
  assert.deepEqual(openSteps(dom), [4]);

  const before = dom.calls.length;
  dom.click('step-1-toggle');
  assert.deepEqual(openSteps(dom), [1, 4], 'el paso con confirmación viva no se cierra');
  dom.click('step-2-toggle');
  assert.deepEqual(openSteps(dom), [2, 4]);
  assert.equal(dom.click('step-4-toggle'), false, 'toggle deshabilitado');
  assert.equal(dom.calls.length, before, 'el acordeón no llama al servidor');
  assert.equal(dom.isVisible('send-confirmation'), true);

  // Con la prueba viva también, su toggle queda deshabilitado.
  dom.click('step-3-toggle');
  withTestConfirmation(dom);
  assert.equal(dom.byId('step-3-toggle').disabled, true);
  assert.equal(dom.MailMergePanel.phase(), 'revisando-envio', 'el envío vivo precede a la prueba viva');
  assert.deepEqual(openSteps(dom), [3, 4]);
});

test('AC-56 / D-56: preparar columnas, bloqueada, revisando-envio, enviando, terminada e incierta se derivan del estado', () => {
  const cases = [
    { name: 'preparar-columnas', build: () => validated('setup'), open: [2], primary: 'apply-setup', chips: { 2: 'Preparar' } },
    { name: 'preparar-columnas', build: () => validated('setup-bloqueado'), open: [2], primary: 'apply-setup', chips: { 2: 'Preparar' } },
    { name: 'bloqueada', build: () => validated('bloqueada'), open: [2], primary: 'validate', chips: { 2: 'Bloqueada' } },
    {
      name: 'lista',
      build: () => validated('ok'),
      open: [3],
      primary: 'review-test',
      chips: { 1: 'Lista', 2: 'Lista', 3: 'Pendiente', 4: 'Pendiente' },
    },
    {
      name: 'revisando-prueba',
      build: () => withTestConfirmation(validated('ok')),
      open: [3],
      primary: 'execute-test',
      chips: { 3: 'Revisión' },
    },
    {
      name: 'revisando-envio',
      build: () => withSendConfirmation(validated('ok')),
      open: [4],
      primary: 'execute-send',
      chips: { 2: 'Lista', 4: 'Revisión' },
      summaries: { 4: '3 correos' },
    },
    {
      name: 'enviando',
      build: () => {
        const dom = withSendConfirmation(validated('ok'));
        dom.click('execute-send');
        return dom;
      },
      open: [],
      primary: null,
      chips: { 4: 'Enviando' },
      summaries: { 4: '3 correos' },
      focus: 'console-title',
    },
    {
      name: 'terminada',
      build: () => finishedSend(),
      open: [],
      primary: null,
      chips: { 4: 'Hecha' },
      summaries: { 4: '2 correos' },
      focus: 'console-title',
    },
    {
      name: 'terminada',
      build: () => {
        const dom = withTestConfirmation(validated('ok'));
        dom.click('execute-test');
        dom.resolve(dom.lastCall('executeTestSend'), views.sendResult('prueba'));
        return dom;
      },
      open: [],
      primary: null,
      chips: { 3: 'Hecha', 4: 'Pendiente' },
      summaries: { 3: 'fila 2 enviada' },
    },
    {
      name: 'incierta',
      build: () => {
        const dom = withSendConfirmation(validated('ok'));
        dom.click('execute-send');
        dom.fail(dom.lastCall('executeSendPending'), new Error('Se excedió el tiempo máximo de ejecución'));
        return dom;
      },
      open: [],
      primary: null,
      chips: {},
      focus: 'console-title',
    },
    {
      // Rechazo de execute… (ok: false): la fase sale del estado restante y el
      // paso de origen queda abierto, con foco, junto a su mensaje.
      name: 'lista',
      build: () => finishedSend(views.sendResult('rechazo')),
      open: [4],
      primary: 'review-test',
      chips: { 4: 'Pendiente' },
      focus: 'step-4-toggle',
    },
  ];
  const CANDIDATES = ['save', 'validate', 'apply-setup', 'review-test', 'skip-test', 'execute-test', 'cancel-test', 'review-send', 'execute-send', 'cancel-send', 'close'];

  for (const entry of cases) {
    const dom = entry.build();
    const label = `caso ${entry.name}`;
    assert.equal(dom.MailMergePanel.phase(), entry.name, label);
    assert.deepEqual(openSteps(dom), entry.open, `${label}: pasos abiertos`);
    assert.deepEqual(CANDIDATES.filter((id) => isPrimary(dom, id)), entry.primary ? [entry.primary] : [], `${label}: botón primario`);
    for (const [n, chip] of Object.entries(entry.chips)) {
      assert.equal(dom.text(`step-${n}-chip`), chip, `${label}: chip del paso ${n}`);
    }
    for (const [n, summary] of Object.entries(entry.summaries || {})) {
      assert.equal(dom.text(`step-${n}-summary`), summary, `${label}: resumen del paso ${n}`);
    }
    if (entry.focus) {
      assert.equal(dom.focusedId(), entry.focus, `${label}: foco`);
    }
    // Los botones de envío conservan btn--send; cancelar y cerrar, su clase.
    assert.ok(dom.byId('execute-send').className.split(' ').includes('btn--send'), `${label}: execute-send`);
    assert.ok(dom.byId('execute-test').className.split(' ').includes('btn--send'), `${label}: execute-test`);
    assert.equal(dom.byId('cancel-send').className, 'btn btn--ghost', label);
    assert.equal(dom.byId('cancel-test').className, 'btn btn--ghost', label);
    assert.equal(dom.byId('close').className, 'btn btn--ghost btn--sm', label);
  }
  // En terminada con filas pendientes, Revisar envío queda como acción secundaria.
  assert.equal(finishedSend().byId('review-send').className, 'btn');
});

test('D-56: las fases no cambian disabled de ningún botón respecto de refreshControls', () => {
  const BUTTONS = ['save', 'validate', 'apply-setup', 'review-test', 'execute-test', 'cancel-test', 'review-send', 'execute-send', 'cancel-send'];
  // true = deshabilitado, según las reglas de refreshControls() (busy, running,
  // setupHeaderKey, confirmaciones vivas y canExecute).
  const IDLE = [false, false, true, false, true, true, false, true, true];
  const cases = [
    { phase: 'sin-configurar', build: () => loaded(views.panelState({ current: null })), disabled: IDLE },
    { phase: 'configurada', build: () => loaded(), disabled: IDLE },
    { phase: 'preparar-columnas', build: () => validated('setup'), disabled: [false, false, false, false, true, true, false, true, true] },
    { phase: 'preparar-columnas', build: () => validated('setup-bloqueado'), disabled: IDLE },
    { phase: 'bloqueada', build: () => validated('bloqueada'), disabled: IDLE },
    { phase: 'lista', build: () => validated('ok'), disabled: IDLE },
    {
      phase: 'revisando-prueba',
      build: () => withTestConfirmation(validated('ok')),
      disabled: [false, false, true, true, false, false, false, true, true],
    },
    {
      phase: 'revisando-envio',
      build: () => withSendConfirmation(validated('ok')),
      disabled: [false, false, true, false, true, true, true, false, false],
    },
    {
      phase: 'enviando',
      build: () => {
        const dom = withSendConfirmation(validated('ok'));
        dom.click('execute-send');
        return dom;
      },
      disabled: [true, true, true, true, true, true, true, true, true],
    },
    { phase: 'terminada', build: () => finishedSend(), disabled: IDLE },
    {
      phase: 'incierta',
      build: () => {
        const dom = withSendConfirmation(validated('ok'));
        dom.click('execute-send');
        dom.fail(dom.lastCall('executeSendPending'), new Error('Sin respuesta'));
        return dom;
      },
      disabled: IDLE,
    },
  ];

  for (const entry of cases) {
    const dom = entry.build();
    assert.equal(dom.MailMergePanel.phase(), entry.phase);
    assert.deepEqual(
      Object.fromEntries(BUTTONS.map((id) => [id, dom.byId(id).disabled])),
      Object.fromEntries(BUTTONS.map((id, i) => [id, entry.disabled[i]])),
      `fase ${entry.phase}`
    );
  }
});

test('AC-56 / D-57: cancelar o vencer una confirmación deja abierto el paso de origen con su mensaje', () => {
  // Cancelar sin resultado previo: vuelve a la fase anterior (lista).
  const cancelled = withSendConfirmation(validated('ok'));
  cancelled.click('cancel-send');
  cancelled.resolve(cancelled.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(cancelled.MailMergePanel.phase(), 'lista');
  assert.deepEqual(openSteps(cancelled), [4]);
  assert.equal(cancelled.text('send-message'), 'Confirmación cancelada; no se envió nada.');
  assert.equal(cancelled.byId('step-4-toggle').disabled, false);
  assert.equal(cancelled.text('step-4-chip'), 'Pendiente');

  // Cancelar la prueba: el paso 3 queda abierto.
  const cancelledTest = withTestConfirmation(validated('ok'));
  cancelledTest.click('cancel-test');
  cancelledTest.resolve(cancelledTest.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(cancelledTest.MailMergePanel.phase(), 'lista');
  assert.deepEqual(openSteps(cancelledTest), [3]);
  assert.equal(cancelledTest.text('test-message'), 'Confirmación cancelada; no se envió nada.');

  // Vencer sin resultado previo: chip Vencida, mensaje y toggle habilitado.
  const expired = withSendConfirmation(validated('ok'), views.confirmationView('send', 'vencida'));
  assert.equal(expired.MailMergePanel.phase(), 'revisando-envio');
  expired.runNextTimer();
  assert.equal(expired.MailMergePanel.phase(), 'lista');
  assert.deepEqual(openSteps(expired), [4]);
  assert.match(expired.text('send-message'), /venció/);
  assert.equal(expired.text('step-4-chip'), 'Vencida');
  assert.equal(expired.byId('step-4-toggle').disabled, false);

  // Con un resultado previo, cancelar y vencer vuelven a terminada sin cerrar el paso 4.
  const again = withSendConfirmation(finishedSend(), views.confirmationView('send'), views.TOKEN_2);
  assert.equal(again.MailMergePanel.phase(), 'revisando-envio');
  assert.deepEqual(openSteps(again), [4]);
  again.click('cancel-send');
  again.resolve(again.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(again.MailMergePanel.phase(), 'terminada');
  assert.deepEqual(openSteps(again), [4]);
  assert.equal(again.text('send-message'), 'Confirmación cancelada; no se envió nada.');
  assert.equal(again.isVisible('progress-section'), true);

  const expiredAgain = withSendConfirmation(finishedSend(), views.confirmationView('send', 'vencida'), views.TOKEN_2);
  expiredAgain.runNextTimer();
  assert.equal(expiredAgain.MailMergePanel.phase(), 'terminada');
  assert.deepEqual(openSteps(expiredAgain), [4]);
  assert.match(expiredAgain.text('send-message'), /venció/);
});

test('AC-61 / D-50: aria-expanded y aria-current se actualizan y el foco sigue al paso abierto', () => {
  const dom = loaded();
  const expanded = () => STEP_IDS.map((n) => dom.attribute(`step-${n}-toggle`, 'aria-expanded'));
  const current = () => STEP_IDS.map((n) => dom.attribute(`rail-${n}`, 'aria-current'));
  const railClass = (n) => dom.byId(`rail-${n}`).className;

  assert.deepEqual(expanded(), ['false', 'true', 'false', 'false']);
  assert.deepEqual(current(), [null, 'step', null, null]);
  assert.equal(railClass(1), 'rail__dot is-done');
  assert.equal(railClass(2), 'rail__dot is-current');
  assert.equal(railClass(3), 'rail__dot is-locked');
  assert.equal(dom.focusedId(), 'step-2-toggle');

  validated('ok', dom);
  assert.deepEqual(expanded(), ['false', 'false', 'true', 'false']);
  assert.deepEqual(current(), [null, null, 'step', null]);
  assert.equal(railClass(2), 'rail__dot is-done');
  assert.equal(railClass(4), 'rail__dot is-locked');
  assert.equal(dom.focusedId(), 'step-3-toggle');
  assert.equal(dom.text('status-live'), 'Paso 3: Prueba');

  // Abrir a mano no mueve el foco ni cambia la etapa del riel.
  dom.click('step-1-toggle');
  assert.deepEqual(expanded(), ['true', 'false', 'false', 'false']);
  assert.deepEqual(current(), [null, null, 'step', null]);
  assert.equal(dom.focusedId(), 'step-3-toggle');
  assert.equal(dom.byId('step-1-toggle').className, 'step__toggle is-open');
  assert.equal(dom.byId('step-3-toggle').className, 'step__toggle');

  // Una confirmación de envío abre el paso 4 con foco y lo marca como actual.
  withSendConfirmation(dom);
  assert.deepEqual(expanded(), ['false', 'false', 'false', 'true']);
  assert.deepEqual(current(), [null, null, null, 'step']);
  assert.equal(dom.focusedId(), 'send-gate', 'el foco va a la compuerta: el toggle del paso está deshabilitado');
  assert.equal(dom.text('status-live'), 'Confirmación lista: 3 destinatarios');

  // Terminado: la consola recibe el foco y el riel queda completo.
  dom.click('execute-send');
  dom.resolve(dom.lastCall('executeSendPending'), views.sendResult('ok'));
  assert.deepEqual(expanded(), ['false', 'false', 'false', 'false']);
  assert.deepEqual(current(), [null, null, null, null]);
  assert.ok(STEP_IDS.every((n) => railClass(n) === 'rail__dot is-done'));
  assert.equal(dom.focusedId(), 'console-title');
});

// --- Preflight Radar (AC-57, D-58) ------------------------------------------

const RADAR_HINTS = ['hint-setup', 'hint-setup-blocked', 'hint-quota-unknown', 'hint-quota-short', 'hint-all-excluded', 'hint-overwrite'];

// Una validación correcta cierra el paso 2 (abre el 3): se reabre a mano para
// mirar el radar, como haría el operador.
function radar(variant, dom = loaded()) {
  validated(variant, dom);
  if (!dom.isVisible('step-2-body')) {
    dom.click('step-2-toggle');
  }
  return dom;
}

function visibleRadarHints(dom) {
  return RADAR_HINTS.filter((id) => dom.isVisible(id));
}

test('AC-57: los tiles muestran válidas, con errores, excluidas y cuota exactamente como la ValidationView', () => {
  const dom = radar('ok');
  assert.equal(dom.text('tile-valid-value'), '2');
  assert.equal(dom.text('tile-invalid-value'), '1');
  assert.equal(dom.text('tile-excluded-value'), '1');
  assert.equal(dom.text('tile-quota-value'), '95');
  assert.equal(dom.isVisible('validation-result'), true);
  assert.deepEqual(visibleRadarHints(dom), []);

  // Barra segmentada: clase fija más ancho discreto, texto con el conteo, sin style.
  assert.equal(dom.byId('meter-valid').className, 'meter__seg meter__seg--valid w-5');
  assert.equal(dom.byId('meter-invalid').className, 'meter__seg meter__seg--invalid w-3');
  assert.equal(dom.byId('meter-excluded').className, 'meter__seg meter__seg--excluded w-3');
  assert.equal(dom.text('meter-valid'), '2');
  assert.equal(dom.text('meter-invalid'), '1');
  assert.equal(dom.text('meter-excluded'), '1');
  assert.ok(dom.text('validation-lines').includes('Cuota diaria restante de Gmail: 95'));
  assert.ok(dom.text('validation-result').includes('Cuota diaria restante de Gmail: 95'));

  // Sin filas, la barra queda en w-0.
  const empty = radar('setup');
  assert.equal(empty.byId('meter-valid').className, 'meter__seg meter__seg--valid w-0');
  assert.equal(empty.byId('meter-excluded').className, 'meter__seg meter__seg--excluded w-0');

  // Cuota desconocida.
  const unknown = radar('cuota-nula');
  assert.equal(unknown.text('tile-quota-value'), 'no disponible');
  assert.equal(unknown.isVisible('hint-quota-unknown'), true);
  assert.equal(unknown.isVisible('hint-quota-short'), false);
  assert.deepEqual(visibleRadarHints(unknown), ['hint-quota-unknown']);
  assert.ok(unknown.text('validation-lines').includes('Cuota diaria restante de Gmail: no disponible'));
});

test('AC-57 / D-58: cuota menor que las filas válidas muestra hint-quota-short con el número', () => {
  const dom = radar('cuota-corta');
  assert.equal(dom.text('tile-quota-value'), '1');
  assert.equal(dom.isVisible('hint-quota-short'), true);
  assert.equal(dom.text('hint-quota-short-n'), '1');
  assert.equal(dom.isVisible('hint-quota-unknown'), false);
  assert.deepEqual(visibleRadarHints(dom), ['hint-quota-short']);

  // Con cuota suficiente, la ayuda se oculta al revalidar.
  dom.click('validate');
  dom.resolve(dom.lastCall('validateCampaign'), views.validationView('ok'));
  assert.equal(dom.isVisible('hint-quota-short'), false);
});

test('AC-57 / D-58: todas las filas excluidas muestra hint-all-excluded', () => {
  const dom = radar('todo-excluido');
  assert.equal(dom.MailMergePanel.phase(), 'bloqueada');
  assert.equal(dom.isVisible('hint-all-excluded'), true);
  assert.deepEqual(visibleRadarHints(dom), ['hint-all-excluded']);
  assert.equal(dom.text('tile-excluded-value'), '4');
  assert.equal(dom.byId('meter-excluded').className, 'meter__seg meter__seg--excluded w-10');
  assert.ok(dom.text('group-excluded').includes('resultado: Email Sent: 3'));

  // Con errores globales no se muestra (la causa es otra).
  const blocked = radar('bloqueada');
  assert.equal(blocked.isVisible('hint-all-excluded'), false);
});

test('AC-57: los grupos de exclusiones, errores y filas se pliegan por botón con aria-expanded y sin ocultar nada en la confirmación', () => {
  const dom = radar('ok');
  assert.equal(dom.byId('toggle-excluded').tagName, 'BUTTON');
  assert.equal(dom.attribute('toggle-excluded', 'aria-expanded'), 'false');
  assert.equal(dom.attribute('toggle-invalid', 'aria-expanded'), 'true');
  assert.equal(dom.attribute('toggle-rows', 'aria-expanded'), 'true');
  assert.equal(dom.isVisible('group-excluded'), false);
  assert.equal(dom.isVisible('group-invalid'), true);
  assert.equal(dom.isVisible('group-rows'), true);
  assert.equal(dom.text('toggle-excluded-count'), '1');
  assert.equal(dom.text('toggle-invalid-count'), '1');
  assert.equal(dom.text('toggle-rows-count'), '2');
  assert.ok(dom.text('group-rows').includes('Fila 2 → alpha@example.test: a.pdf'));
  assert.ok(dom.text('group-invalid').includes('Fila 5: Email Address inválido'));

  const before = dom.calls.length;
  dom.click('toggle-excluded');
  assert.equal(dom.attribute('toggle-excluded', 'aria-expanded'), 'true');
  assert.equal(dom.isVisible('group-excluded'), true);
  dom.click('toggle-rows');
  assert.equal(dom.attribute('toggle-rows', 'aria-expanded'), 'false');
  assert.equal(dom.isVisible('group-rows'), false);
  dom.click('toggle-rows');
  assert.equal(dom.isVisible('group-rows'), true);
  assert.equal(dom.calls.length, before, 'plegar no llama al servidor');
  assert.equal(dom.MailMergePanel.phase(), 'lista', 'plegar no cambia la fase');

  // Revalidar restaura el estado por defecto.
  dom.click('validate');
  dom.resolve(dom.lastCall('validateCampaign'), views.validationView('ok'));
  assert.equal(dom.attribute('toggle-excluded', 'aria-expanded'), 'false');
  assert.equal(dom.isVisible('group-excluded'), false);

  // Grupos sin contenido ocultan también su botón.
  const empty = radar('setup');
  assert.equal(empty.isVisible('toggle-excluded'), false);
  assert.equal(empty.isVisible('toggle-invalid'), false);
  assert.equal(empty.isVisible('toggle-rows'), false);

  // En la confirmación no hay grupos colapsables y la lista completa se ve.
  const html = readSidebar();
  const sendMarkup = /<div id="send-view"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  assert.ok(sendMarkup && !/toggle-/.test(sendMarkup[1]), 'send-view no contiene toggles');
  withSendConfirmation(dom);
  assert.equal(dom.isVisible('send-view'), true);
  assert.ok(dom.text('send-view').includes('alpha@example.test'));
  assert.ok(dom.text('send-view').includes('gamma@example.test'));
  assert.equal(dom.created.includes('input'), false);
});

test('AC-57 / D-35: el plan de columnas se muestra como diff y Preparar columnas sigue llamando a applyColumnSetup con headerKey', () => {
  const dom = radar('setup');
  const diff = dom.text('setup-list');
  assert.ok(diff.includes('~ Renombrar "Mail Merge Status" → "Resultado" (columna B)'));
  assert.ok(diff.includes('~ Renombrar "Scheduled Date" → "Fecha" (columna C)'));
  assert.ok(diff.includes('+ Agregar "Campaña" (columna D)'));
  assert.ok(diff.includes('+ Agregar "Detalle" (columna E)'));
  assert.equal(dom.isVisible('setup-box'), true);
  assert.deepEqual(visibleRadarHints(dom), ['hint-setup']);
  assert.equal(dom.byId('apply-setup').disabled, false);

  dom.click('apply-setup');
  assert.deepEqual(dom.lastCall('applyColumnSetup').args, ['["Email Address","Mail Merge Status","Scheduled Date"]']);
  dom.resolve(dom.lastCall('applyColumnSetup'), { ok: true, errors: [], applied: { renames: [{}, {}], appends: [{}, {}] } });
  assert.equal(dom.callsTo('validateCampaign').length, 2, 'revalida tras preparar');
  dom.resolve(dom.lastCall('validateCampaign'), views.validationView('ok'));
  assert.equal(dom.isVisible('setup-box'), false);
  assert.equal(dom.isVisible('hint-setup'), false);

  const blocked = radar('setup-bloqueado');
  assert.ok(blocked.text('setup-list').includes('! La fila 4 tiene Scheduled Date con valor y el estado vacío'));
  assert.deepEqual(visibleRadarHints(blocked), ['hint-setup-blocked']);
  assert.equal(blocked.byId('apply-setup').disabled, true);
  assert.equal(blocked.MailMergePanel.phase(), 'preparar-columnas');
});

test('AC-54 / D-47 (regresión): overwriteRows sigue siendo un aviso sin casilla y la validación no crea inputs', () => {
  const dom = radar('sobrescritura');
  assert.ok(dom.text('validation-result').includes('fila 3 (Campaña)'));
  assert.ok(dom.text('validation-result').includes('fila 2 (Fecha, Detalle)'));
  assert.equal(dom.created.includes('input'), false, 'la validación no crea casillas');
  assert.equal(dom.isVisible('send-consent-box'), false);
  assert.deepEqual(visibleRadarHints(dom), ['hint-overwrite']);

  const clean = radar('ok');
  assert.equal(clean.isVisible('hint-overwrite'), false);
});

test('AC-57: el mensaje de validación con problemas informa los conteos', () => {
  const blocked = radar('bloqueada');
  assert.equal(blocked.text('validation-message'), 'La validación encontró problemas: 1 globales · 1 filas con errores');
  assert.equal(blocked.byId('validation-message').className, 'message error');

  const ok = radar('ok');
  assert.equal(ok.text('validation-message'), 'Validación sin errores globales.');
  assert.equal(ok.byId('validation-message').className, 'message ok');
});

test('AC-57: revalidar no desprende los elementos estáticos del radar', () => {
  const dom = radar('ok');
  assert.ok(dom.text('validation-result').includes('alpha@example.test'));

  dom.click('validate');
  dom.resolve(
    dom.lastCall('validateCampaign'),
    views.validationView('ok', {
      sheetName: 'Otra hoja',
      quotaRemaining: 7,
      counts: { valid: 1, invalid: 0, excluded: 0 },
      excludedByReason: [],
      rows: [{ rowNumber: 9, email: 'zeta@example.test', attachmentNames: [] }],
      invalidRows: [],
    })
  );

  // Solo quedan filas y tiles de la segunda validación.
  const result = dom.text('validation-result');
  assert.ok(result.includes('zeta@example.test'));
  assert.ok(!result.includes('alpha@example.test'));
  assert.ok(!result.includes('Fila 5'));
  assert.ok(result.includes('Otra hoja'));
  assert.equal(dom.text('tile-valid-value'), '1');
  assert.equal(dom.text('tile-invalid-value'), '0');
  assert.equal(dom.text('tile-quota-value'), '7');
  assert.equal(dom.text('group-invalid'), '');
  assert.equal(dom.text('group-excluded'), '');
  assert.ok(dom.text('group-rows').includes('Fila 9 → zeta@example.test'));

  // Los elementos estáticos siguen dentro de validation-result: el marcado
  // los contiene y el script solo vacía validation-lines y group-*.
  const html = readSidebar();
  const block = /<div id="validation-result"[\s\S]*?<div id="setup-box"/.exec(html);
  assert.ok(block, 'validation-result precede a setup-box');
  for (const id of ['tile-valid-value', 'meter-valid', 'validation-lines', 'group-excluded', 'group-invalid', 'group-rows', 'toggle-excluded', 'toggle-invalid', 'toggle-rows']) {
    assert.ok(block[0].includes(`id="${id}"`), `${id} vive dentro de validation-result`);
  }
  assert.ok(!/clear\(el\.validationResult\)/.test(html), 'validation-result no se vacía');
  assert.ok(!/innerHTML/.test(html));
  assert.equal((html.match(/setTimeout\(/g) || []).length, 2);
});

// --- Safe Send Review (AC-58) -----------------------------------------------

// Confirmación recién preparada: no marca ninguna casilla (a diferencia de
// `withSendConfirmation`, que ya tilda la de filtros).
function preparedSend(dom, view = views.confirmationView('send'), token = views.TOKEN) {
  dom.click('review-send');
  dom.resolve(dom.lastCall('prepareSendPending'), { ok: true, errors: [], token, view });
  return dom;
}

function preparedTest(dom, view = views.confirmationView('test'), token = views.TEST_TOKEN) {
  dom.setValue('test-row', '2');
  dom.click('review-test');
  dom.resolve(dom.lastCall('prepareTestSend'), { ok: true, errors: [], token, view });
  return dom;
}

test('AC-58: la confirmación de envío muestra el aviso, el resumen, la lista completa con fin de lista y las compuertas desmarcadas', () => {
  const dom = preparedSend(validated('ok'));
  const view = dom.text('send-view');

  assert.ok(view.includes('Se enviarán 3 correos reales. Esta acción no se puede deshacer.'));
  assert.ok(view.includes('Otoño 2026'));
  assert.ok(view.includes('Fila 2 → alpha@example.test: a.pdf'));
  assert.ok(view.includes('Fila 4 → gamma@example.test: c.pdf, d.pdf'));
  assert.ok(view.includes('condiciones.pdf'));
  assert.ok(view.endsWith('── fin de la lista (3) ──'));
  assert.ok(!/toggle-/.test(/<div id="send-view"[^>]*>([\s\S]*?)<\/div>/.exec(readSidebar())[1]), 'sin grupos colapsables');

  // El fieldset de verificación contiene las casillas, siempre desmarcadas.
  assert.equal(dom.byId('send-filter-ack').checked, false);
  assert.equal(dom.byId('send-consent').checked, false);
  assert.equal(dom.byId('execute-send').disabled, true);
  assert.equal(dom.text('send-gate-status'), 'Falta: marcar la casilla de filtros');
  assert.equal(dom.text('test-gate-status'), '');
  dom.setChecked('send-filter-ack', true);
  assert.equal(dom.text('send-gate-status'), '');
  assert.equal(dom.byId('execute-send').disabled, false);
  dom.setChecked('send-filter-ack', false);
  assert.equal(dom.text('send-gate-status'), 'Falta: marcar la casilla de filtros');
  assert.equal(dom.byId('execute-send').disabled, true);

  // Con consentimiento hacen falta las dos casillas.
  const consent = preparedSend(validated('ok'), views.confirmationView('send', 'consentimiento'));
  assert.equal(consent.text('send-gate-status'), 'Falta: marcar las 2 casillas');
  consent.setChecked('send-filter-ack', true);
  assert.equal(consent.text('send-gate-status'), 'Falta: marcar el consentimiento');
  assert.equal(consent.byId('execute-send').disabled, true);
  consent.setChecked('send-consent', true);
  assert.equal(consent.text('send-gate-status'), '');
  assert.equal(consent.byId('execute-send').disabled, false);
  consent.setChecked('send-filter-ack', false);
  assert.equal(consent.text('send-gate-status'), 'Falta: marcar la casilla de filtros');

  // Sin confirmación viva, el estado de la compuerta queda vacío.
  consent.click('cancel-send');
  consent.resolve(consent.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(consent.text('send-gate-status'), '');

  // El resumen se construye solo con createElement + textContent.
  assert.ok(dom.created.includes('dl'));
  assert.ok(dom.created.includes('span'), 'los adjuntos comunes son chips');
});

test('AC-58 / D-53: el vencimiento se muestra como hora fija y al vencer el chip dice Vencida y el toggle se rehabilita', () => {
  const dom = preparedSend(validated('ok'));

  assert.match(dom.text('send-expiry'), /^Vence a las \d\d:\d\d \(10 min\)$/);
  assert.ok(!dom.text('send-confirmation').includes('La confirmación vence'));
  assert.equal(dom.pendingTimers().length, 1, 'un solo temporizador tras preparar');
  assert.equal(dom.byId('step-4-toggle').disabled, true);
  dom.setChecked('send-filter-ack', true);
  assert.equal(dom.byId('execute-send').disabled, false);

  dom.runNextTimer();
  assert.equal(dom.text('step-4-chip'), 'Vencida');
  assert.equal(dom.byId('step-4-toggle').disabled, false);
  assert.equal(dom.byId('execute-send').disabled, true);
  assert.match(dom.text('send-message'), /venció/);
  assert.equal(dom.text('send-gate-status'), '');
  assert.equal(dom.byId('send-filter-ack').checked, false, 'al vencer la casilla queda desmarcada');
  assert.equal(dom.pendingTimers().length, 0);

  const test = preparedTest(validated('ok'));
  assert.match(test.text('test-expiry'), /^Vence a las \d\d:\d\d \(10 min\)$/);
  test.runNextTimer();
  assert.equal(test.text('step-3-chip'), 'Vencida');
  assert.equal(test.byId('step-3-toggle').disabled, false);
  assert.equal(test.byId('execute-test').disabled, true);
});

test('AC-58 / P0-2 / AC-54 (regresión): las casillas nacen desmarcadas en cada confirmación nueva y el botón conserva el texto Enviar N correos', () => {
  const dom = preparedSend(validated('ok'), views.confirmationView('send', 'consentimiento'));
  assert.equal(dom.text('execute-send'), 'Enviar 3 correos');
  dom.setChecked('send-filter-ack', true);
  dom.setChecked('send-consent', true);
  assert.equal(dom.byId('execute-send').disabled, false);

  dom.click('cancel-send');
  dom.resolve(dom.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(dom.byId('send-filter-ack').checked, false);
  assert.equal(dom.byId('send-consent').checked, false);

  const single = views.confirmationView('send', 'consentimiento', {
    count: 1,
    rows: [{ rowNumber: 2, email: 'alpha@example.test', attachmentNames: [] }],
  });
  preparedSend(dom, single, views.TOKEN_2);
  assert.equal(dom.byId('send-filter-ack').checked, false, 'nace desmarcada');
  assert.equal(dom.byId('send-consent').checked, false, 'nace desmarcada');
  assert.equal(dom.byId('execute-send').disabled, true);
  assert.equal(dom.text('execute-send'), 'Enviar 1 correo');
  assert.equal(dom.byId('execute-send').className, 'btn btn--primary btn--send');
  assert.equal(dom.text('send-gate-status'), 'Falta: marcar las 2 casillas');

  // Al vencer también quedan desmarcadas en la confirmación siguiente.
  dom.setChecked('send-filter-ack', true);
  dom.setChecked('send-consent', true);
  dom.runNextTimer();
  preparedSend(dom, views.confirmationView('send', 'consentimiento'), views.TOKEN);
  assert.equal(dom.byId('send-filter-ack').checked, false);
  assert.equal(dom.byId('send-consent').checked, false);
});

test('AC-58: la confirmación de prueba muestra Para: con la cuenta y su compuerta de consentimiento cuando corresponde', () => {
  const plain = preparedTest(validated('ok'));
  assert.ok(plain.text('test-view').includes('Para: ' + views.USER));
  assert.ok(plain.text('test-view').includes('Se enviará 1 correo a tu cuenta'));
  assert.ok(plain.text('test-view').endsWith('── fin de la lista (1) ──'));
  assert.equal(plain.text('execute-test'), 'Enviar prueba');
  assert.equal(plain.byId('execute-test').className, 'btn btn--primary btn--send');
  assert.equal(plain.isVisible('test-consent-box'), false);
  assert.equal(plain.text('test-gate-status'), '');
  assert.equal(plain.byId('execute-test').disabled, false);

  const consent = preparedTest(validated('ok'), views.confirmationView('test', 'consentimiento'));
  assert.equal(consent.isVisible('test-consent-box'), true);
  assert.equal(consent.byId('test-consent').checked, false);
  assert.equal(consent.byId('execute-test').disabled, true);
  assert.equal(consent.text('test-gate-status'), 'Falta: marcar el consentimiento');
  assert.ok(consent.text('test-consent-text').includes('fila 2 (Fecha, Detalle)'));
  consent.setChecked('test-consent', true);
  assert.equal(consent.text('test-gate-status'), '');
  assert.equal(consent.byId('execute-test').disabled, false);
  assert.equal(consent.text('send-gate-status'), '');
});

test('AC-58: la confirmación recibe el foco en su compuerta porque el toggle del paso está deshabilitado', () => {
  const send = preparedSend(validated('ok'));
  assert.equal(send.byId('step-4-toggle').disabled, true);
  assert.equal(send.focusedId(), 'send-gate');
  assert.match(readSidebar(), /<fieldset id="send-gate" class="gate" tabindex="-1">\s*<legend>Verificación<\/legend>/);

  const test = preparedTest(validated('ok'));
  assert.equal(test.byId('step-3-toggle').disabled, true);
  assert.equal(test.focusedId(), 'test-gate');
  assert.match(readSidebar(), /<fieldset id="test-gate" class="gate" tabindex="-1">\s*<legend>Verificación<\/legend>/);
});

test('AC-58: hint-filter-views se muestra solo en revisando-envio y hint-consent solo con consentRequired', () => {
  const dom = validated('ok');
  assert.equal(dom.isVisible('hint-filter-views'), false);
  assert.equal(dom.isVisible('hint-consent'), false);

  preparedSend(dom);
  assert.equal(dom.MailMergePanel.phase(), 'revisando-envio');
  assert.equal(dom.isVisible('hint-filter-views'), true);
  assert.match(dom.text('hint-filter-views'), /Las vistas de filtro NO excluyen filas del envío\./);
  assert.equal(dom.isVisible('hint-consent'), false);
  dom.click('cancel-send');
  dom.resolve(dom.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(dom.isVisible('hint-filter-views'), false);

  preparedSend(dom, views.confirmationView('send', 'consentimiento'), views.TOKEN_2);
  assert.equal(dom.isVisible('hint-filter-views'), true);
  assert.equal(dom.isVisible('hint-consent'), true);
  assert.match(dom.text('hint-consent'), /no se pueden recuperar desde esta herramienta/);
  dom.click('cancel-send');
  dom.resolve(dom.lastCall('cancelConfirmation'), { ok: true });
  assert.equal(dom.isVisible('hint-filter-views'), false);
  assert.equal(dom.isVisible('hint-consent'), false);
});

// --- Observaciones del paso 3: anuncio y rechazo ----------------------------

test('AC-56 / D-57: el rechazo de una prueba vuelve al paso 3 con el motivo', () => {
  const dom = preparedTest(validated('ok'));
  dom.click('execute-test');
  const rejection = views.sendResult('rechazo', { kind: 'test', summaryLines: ['La prueba no se inició: la confirmación venció'] });
  dom.resolve(dom.lastCall('executeTestSend'), rejection);

  assert.equal(dom.isVisible('step-3-body'), true);
  assert.equal(dom.text('test-message'), rejection.summaryLines[0]);
  assert.equal(dom.isVisible('progress-section'), false);
  assert.equal(dom.focusedId(), 'step-3-toggle');
  assert.equal(dom.MailMergePanel.phase(), 'lista');
  assert.equal(dom.byId('step-3-toggle').disabled, false);
  assert.ok(dom.text('status-live').startsWith('Prueba rechazada'));
  assert.ok(dom.text('status-live').includes(rejection.summaryLines[0]));
});

test('AC-56 / D-57: el rechazo de un envío anuncia el motivo en status-live', () => {
  const dom = preparedSend(validated('ok'));
  dom.setChecked('send-filter-ack', true);
  dom.click('execute-send');
  const rejection = views.sendResult('rechazo');
  dom.resolve(dom.lastCall('executeSendPending'), rejection);

  assert.ok(dom.text('status-live').startsWith('Envío rechazado'));
  assert.ok(dom.text('status-live').includes(rejection.summaryLines[0]));
  assert.equal(dom.text('send-message'), rejection.summaryLines[0]);
  assert.equal(dom.isVisible('step-4-body'), true);
  assert.equal(dom.focusedId(), 'step-4-toggle');
  assert.equal(dom.MailMergePanel.phase(), 'lista');
});
