'use strict';

// Vista previa local de la sidebar (plan `plans/2026-11-14_eclipse-console-ui.md`,
// D-59). Herramienta manual: `node tools/preview-sidebar.js [estado]` lee
// `src/Sidebar.html`, le inserta antes del `<script>` real un falso de
// `google.script.run` con vistas ficticias (`tests/fixtures/sidebar-views.js`) y
// escribe `tmp/sidebar-preview.html` (carpeta ignorada por Git). No modifica
// `src/`, no se sube a Apps Script y no usa red ni cuentas de Google.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SIDEBAR = path.join(ROOT, 'src', 'Sidebar.html');
const OUT_DIR = path.join(ROOT, 'tmp');
const OUT_FILE = path.join(OUT_DIR, 'sidebar-preview.html');

const fixtures = require(path.join(ROOT, 'tests', 'fixtures', 'sidebar-views.js'));

const STATES = [
  'inicial',
  'sin-borradores',
  'configurada',
  'setup',
  'bloqueada',
  'lista',
  'prueba',
  'envio',
  'consentimiento',
  'enviando',
  'terminada',
  'revisar',
  'incierta',
  'lista-500',
];

const requested = process.argv[2];
if (requested !== undefined && !STATES.includes(requested)) {
  console.error('Estado desconocido: "' + requested + '". Estados: ' + STATES.join(', '));
  process.exit(1);
}
const defaultState = requested || 'configurada';

// `expiresAtIso` no se congela: se guarda en minutos relativos y el script de la
// vista previa arma la fecha al cargar.
function relativeExpiry(view) {
  const copy = { ...view, expiresInMinutes: Math.round((Date.parse(view.expiresAtIso) - Date.now()) / 60000) };
  delete copy.expiresAtIso;
  return copy;
}

// 500 filas ficticias (dominio example.test) para medir el panel con listas largas.
function bigRows(count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      rowNumber: i + 2,
      email: 'destinatario' + (i + 1) + '@example.test',
      attachmentNames: i % 7 === 0 ? ['adjunto-' + (i + 1) + '.pdf'] : [],
    });
  }
  return rows;
}

function buildData() {
  const big = 500;
  const validation500 = fixtures.validationView('ok', {
    counts: { valid: big, invalid: 0, excluded: 0 },
    excludedByReason: [],
    rows: bigRows(big),
    invalidRows: [],
  });
  const confirmation500 = (kind) =>
    relativeExpiry(
      fixtures.confirmationView(kind, 'ok', {
        count: big,
        rows: bigRows(big),
        invalidCount: 0,
        excludedCount: 0,
        warning: 'Se enviarán ' + big + ' correos reales. Esta acción no se puede deshacer.',
      })
    );
  return {
    states: STATES,
    defaultState,
    tokens: { send: fixtures.TOKEN, test: fixtures.TEST_TOKEN },
    panel: {
      normal: fixtures.panelState(),
      inicial: fixtures.panelState({ current: null }),
      sinBorradores: fixtures.panelState({ current: null, drafts: [] }),
    },
    validation: {
      ok: fixtures.validationView('ok'),
      setup: fixtures.validationView('setup'),
      bloqueada: fixtures.validationView('bloqueada'),
      consentimiento: fixtures.validationView('consentimiento'),
      grande: validation500,
    },
    confirmation: {
      send: {
        ok: relativeExpiry(fixtures.confirmationView('send', 'ok')),
        consentimiento: relativeExpiry(fixtures.confirmationView('send', 'consentimiento')),
        grande: confirmation500('send'),
      },
      test: {
        ok: relativeExpiry(fixtures.confirmationView('test', 'ok')),
        consentimiento: relativeExpiry(fixtures.confirmationView('test', 'consentimiento')),
        grande: confirmation500('test'),
      },
    },
    result: {
      ok: fixtures.sendResult('ok'),
      conciliar: fixtures.sendResult('conciliar'),
      prueba: fixtures.sendResult('prueba'),
    },
    progress: {
      sinIniciar: fixtures.progress('sin-iniciar'),
      parcial: fixtures.progress('parcial'),
      enCurso: fixtures.progress('en-curso'),
      prueba: fixtures.progress('prueba'),
    },
  };
}

// JSON seguro dentro de un `<script>`: cada `<` pasa a la secuencia de seis
// caracteres barra invertida, u, 0, 0, 3, c (JSON válido que el navegador
// decodifica a `<`), así que un cierre de script literal en un fixture nunca
// corta el bloque.
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Código del navegador: sin plantillas con comillas invertidas ni marcadores de
// interpolación, para poder vivir dentro de este literal.
const PREVIEW_CODE = [
  '(function () {',
  '  var DATA = /*DATA*/;',
  '  var params = new URLSearchParams(location.search);',
  '  var state = params.get("state");',
  '  if (DATA.states.indexOf(state) === -1) { state = DATA.defaultState; }',
  '  var DELAY = 400;',
  '  var big = state === "lista-500";',
  '  var setupDone = false;',
  '  var progressCalls = 0;',
  '  function clone(value) { return JSON.parse(JSON.stringify(value)); }',
  '  function withExpiry(view) {',
  '    var copy = clone(view);',
  '    copy.expiresAtIso = new Date(Date.now() + copy.expiresInMinutes * 60000).toISOString();',
  '    delete copy.expiresInMinutes;',
  '    return copy;',
  '  }',
  '  function panel() {',
  '    if (state === "inicial") { return clone(DATA.panel.inicial); }',
  '    if (state === "sin-borradores") { return clone(DATA.panel.sinBorradores); }',
  '    return clone(DATA.panel.normal);',
  '  }',
  '  function validation() {',
  '    if (big) { return clone(DATA.validation.grande); }',
  '    if (state === "setup" && !setupDone) { return clone(DATA.validation.setup); }',
  '    if (state === "bloqueada") { return clone(DATA.validation.bloqueada); }',
  '    if (state === "consentimiento") { return clone(DATA.validation.consentimiento); }',
  '    return clone(DATA.validation.ok);',
  '  }',
  '  function confirmation(kind) {',
  '    // El falso debe rechazar donde el servidor rechazaría: nunca simular un envío',
  '    // que la validación acaba de bloquear (incluidos encabezados heredados).',
  '    var viewBefore = validation();',
  '    if (state === "inicial" || state === "sin-borradores") {',
  '      return { ok: false, errors: ["Guardá una campaña válida antes de enviar"], token: null, view: null };',
  '    }',
  '    if (!viewBefore.ok || viewBefore.globalErrors.length) {',
  '      return { ok: false, errors: clone(viewBefore.globalErrors), token: null, view: null };',
  '    }',
  '    var set = DATA.confirmation[kind];',
  '    var view = big ? set.grande : state === "consentimiento" ? set.consentimiento : set.ok;',
  '    return { ok: true, errors: [], token: DATA.tokens[kind], view: withExpiry(view) };',
  '  }',
  '  // Devuelve { delay, fail, value } para cada llamada.',
  '  function respond(name, args, kind) {',
  '    switch (name) {',
  '      case "getPanelState": return { value: panel() };',
  '      case "saveConfig": return { value: args[0] || {} };',
  '      case "validateCampaign": return { value: validation() };',
  '      case "applyColumnSetup":',
  '        setupDone = true;',
  '        return { value: { ok: true, errors: [], applied: { renames: [{ column: 2, from: "Mail Merge Status", to: "Resultado" }, { column: 3, from: "Scheduled Date", to: "Fecha" }], appends: [{ column: 4, name: "Campaña" }, { column: 5, name: "Detalle" }] } } };',
  '      case "prepareTestSend": return { value: confirmation("test") };',
  '      case "prepareSendPending": return { value: confirmation("send") };',
  '      case "executeTestSend":',
  '      case "executeSendPending": return execute(name === "executeTestSend");',
  '      case "getSendProgress": return { value: nextProgress() };',
  '      case "cancelConfirmation": return { value: { ok: true } };',
  '      default: return { fail: true, value: { message: "Función no simulada: " + name } };',
  '    }',
  '  }',
  '  function execute(isTest) {',
  '    if (state === "incierta") { return { fail: true, value: { message: "Se perdió la conexión con el servidor" } }; }',
  '    if (state === "enviando") { return { delay: 20000, value: clone(DATA.result.ok) }; }',
  '    if (state === "revisar") { return { value: clone(DATA.result.conciliar) }; }',
  '    return { value: clone(isTest ? DATA.result.prueba : DATA.result.ok) };',
  '  }',
  '  function nextProgress() {',
  '    progressCalls += 1;',
  '    if (state === "terminada" || state === "incierta") { return clone(DATA.progress.sinIniciar); }',
  '    var sequence = [DATA.progress.sinIniciar, DATA.progress.parcial, DATA.progress.enCurso];',
  '    return clone(sequence[Math.min(progressCalls - 1, sequence.length - 1)]);',
  '  }',
  '  function makeRunner() {',
  '    var onSuccess = function () {};',
  '    var onFailure = function () {};',
  '    var runner = new Proxy({}, {',
  '      get: function (target, name) {',
  '        if (name === "withSuccessHandler") {',
  '          return function (fn) { onSuccess = fn; return runner; };',
  '        }',
  '        if (name === "withFailureHandler") {',
  '          return function (fn) { onFailure = fn; return runner; };',
  '        }',
  '        return function () {',
  '          var args = Array.prototype.slice.call(arguments);',
  '          var answer = respond(String(name), args);',
  '          var success = onSuccess;',
  '          var failure = onFailure;',
  '          onSuccess = function () {};',
  '          onFailure = function () {};',
  '          setTimeout(function () {',
  '            if (answer.fail) { failure(answer.value); } else { success(answer.value); }',
  '          }, answer.delay || DELAY);',
  '        };',
  '      }',
  '    });',
  '    return runner;',
  '  }',
  '  window.google = { script: { run: makeRunner(), host: { close: function () {} } } };',
  '  // Barra de estados: fuera del panel de 300 px.',
  '  document.addEventListener("DOMContentLoaded", function () {',
  '    var bar = document.getElementById("preview-bar");',
  '    var title = document.createElement("strong");',
  '    title.textContent = "VISTA PREVIA LOCAL (datos ficticios)";',
  '    bar.appendChild(title);',
  '    var note = document.createElement("p");',
  '    note.textContent = "No es Google ni Apps Script. Estado: " + state + ". El panel de la izquierda mide 300 px.";',
  '    bar.appendChild(note);',
  '    DATA.states.forEach(function (name) {',
  '      var link = document.createElement("a");',
  '      link.href = "?state=" + encodeURIComponent(name);',
  '      link.textContent = name;',
  '      if (name === state) { link.setAttribute("aria-current", "page"); }',
  '      bar.appendChild(link);',
  '    });',
  '  });',
  '})();',
].join('\n');

const PREVIEW_STYLE = [
  'html { background: #e8e8ec; }',
  '#preview-layout { display: flex; align-items: flex-start; gap: 16px; padding: 12px; }',
  '#preview-panel { width: 300px; flex: none; overflow-x: auto; background: var(--bg); outline: 1px solid #888; }',
  '#preview-bar { position: fixed; top: 12px; left: 340px; width: 260px; font: 13px/1.4 system-ui, sans-serif; color: #111; background: #fff8d6; border: 2px solid #b58900; padding: 10px; display: flex; flex-direction: column; gap: 4px; }',
  '#preview-bar p { margin: 0 0 6px; }',
  '#preview-bar a { color: #0645ad; padding: 2px 4px; }',
  '#preview-bar a[aria-current="page"] { font-weight: 700; background: #ffe58a; text-decoration: none; }',
].join('\n');

function build() {
  const html = fs.readFileSync(SIDEBAR, 'utf8');
  const bodyOpen = html.indexOf('<body>');
  const bodyClose = html.lastIndexOf('</body>');
  const scriptOpen = html.indexOf('<script>');
  const headClose = html.indexOf('</head>');
  if (bodyOpen === -1 || bodyClose === -1 || scriptOpen === -1 || headClose === -1 || scriptOpen < bodyOpen) {
    throw new Error('src/Sidebar.html no tiene la estructura esperada (head, body y un script dentro del body)');
  }
  // Un único `<script>` adicional; los datos van como literal JSON dentro de él
  // (el reemplazo usa una función para que `$` en los datos no se interprete).
  const code = PREVIEW_CODE.replace('/*DATA*/', () => embedJson(buildData()));
  const inserted = '<script>\n' + code + '\n</script>\n';
  let out = html;
  // De atrás hacia adelante para no invalidar los índices anteriores.
  out = out.slice(0, bodyClose) + '</div>\n</div>\n' + out.slice(bodyClose);
  out = out.slice(0, scriptOpen) + inserted + out.slice(scriptOpen);
  out =
    out.slice(0, bodyOpen + '<body>'.length) +
    '\n<div id="preview-bar"></div>\n<div id="preview-layout">\n<div id="preview-panel">' +
    out.slice(bodyOpen + '<body>'.length);
  out = out.slice(0, headClose) + '<style>\n' + PREVIEW_STYLE + '\n</style>\n' + out.slice(headClose);
  return out;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, build(), 'utf8');
console.log('Vista previa escrita en ' + path.relative(ROOT, OUT_FILE) + ' (estado por defecto: ' + defaultState + ').');
console.log('Ábrela en un navegador; cambia de estado con la barra o con ?state=<estado>.');
