'use strict';

// El simulador local no debe inventar un envío exitoso cuando el preflight
// contiene errores. Se prueba su google.script.run ficticio, nunca Gmail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function loadPreview(state) {
  execFileSync(process.execPath, ['tools/preview-sidebar.js', state], { cwd: ROOT, stdio: 'pipe' });
  const html = fs.readFileSync(path.join(ROOT, 'tmp/sidebar-preview.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2, 'solo el falso y el script original');
  const sandbox = {
    URLSearchParams,
    location: { search: '?state=' + state },
    document: { addEventListener() {} },
    window: {},
    setTimeout(callback) { callback(); return 1; },
  };
  vm.runInNewContext(scripts[0][1], sandbox, { filename: 'preview-mock.js' });
  const runner = sandbox.window.google.script.run;
  return function invoke(name, ...args) {
    let response;
    let failure;
    runner.withSuccessHandler((data) => { response = data; })
      .withFailureHandler((error) => { failure = error; })[name](...args);
    assert.equal(failure, undefined, `llamada ${name} no debe fallar por transporte`);
    return JSON.parse(JSON.stringify(response));
  };
}

test('D-59: preflight bloqueado no permite preparar ni simular envíos', () => {
  const invoke = loadPreview('bloqueada');
  assert.equal(invoke('validateCampaign').ok, false);
  for (const name of ['prepareSendPending', 'prepareTestSend']) {
    const result = invoke(name, 2);
    assert.equal(result.ok, false, name);
    assert.equal(result.token == null, true, name);
    assert.ok(result.errors.length > 0, name);
  }
});

test('D-59: encabezados heredados bloquean la preparación hasta aplicar el plan de columnas', () => {
  const invoke = loadPreview('setup');
  assert.equal(invoke('validateCampaign').ok, false);
  assert.equal(invoke('prepareSendPending').ok, false);
  assert.equal(invoke('applyColumnSetup', 'clave-ficticia').ok, true);
  assert.equal(invoke('validateCampaign').ok, true);
  assert.equal(invoke('prepareSendPending').ok, true);
});

test('D-59: vista previa elegible conserva la confirmación con token ficticio', () => {
  const invoke = loadPreview('lista');
  const result = invoke('prepareSendPending');
  assert.equal(result.ok, true);
  assert.equal(typeof result.token, 'string');
  assert.equal(result.view.count > 0, true);
});
