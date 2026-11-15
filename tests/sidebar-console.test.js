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
    assert.equal(dom.attribute(`step-${step.n}-toggle`, 'aria-expanded'), 'true');
    assert.equal(body.tagName, 'DIV');
    assert.equal(dom.isVisible(`step-${step.n}-body`), true, `el cuerpo del paso ${step.n} está visible`);
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
