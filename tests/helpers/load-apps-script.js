'use strict';

// Cargador de los scripts de Apps Script para los tests de Node.
// Ejecuta todos los `src/*.js` en un único contexto `vm`, que reproduce el
// espacio global compartido de Apps Script (funciones y constantes visibles
// entre archivos). Cada llamada crea un contexto nuevo, para que un test que
// mute una constante (por ejemplo `LIMITS`) no afecte a otros.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');

function loadAppsScript(extraGlobals = {}) {
  const ctx = vm.createContext({ ...extraGlobals });
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort();
  for (const name of files) {
    const filename = path.join(SRC_DIR, name);
    const code = fs.readFileSync(filename, 'utf8');
    vm.runInContext(code, ctx, { filename });
  }
  return ctx;
}

// Lee una constante de nivel superior (`const`), que no queda como propiedad
// del objeto global del contexto sino en su entorno léxico.
function getConst(ctx, name) {
  return vm.runInContext(name, ctx);
}

function toPlainMaps(x) {
  const tag = Object.prototype.toString.call(x);
  if (tag === '[object Map]') {
    return Array.from(x.entries()).map(([k, v]) => [toPlainMaps(k), toPlainMaps(v)]);
  }
  if (Array.isArray(x)) {
    return x.map(toPlainMaps);
  }
  if (x !== null && typeof x === 'object' && tag !== '[object Date]') {
    const out = {};
    for (const key of Object.keys(x)) {
      out[key] = toPlainMaps(x[key]);
    }
    return out;
  }
  return x;
}

// Normaliza objetos de otro realm (creados dentro del contexto `vm`) para
// poder compararlos con `assert.deepStrictEqual`. Los `Map` pasan a arrays
// de pares [clave, valor].
function plain(x) {
  const converted = toPlainMaps(x);
  if (converted === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(converted));
}

// `instanceof Date` falla entre realms; se compara por la etiqueta interna.
function isDate(x) {
  return Object.prototype.toString.call(x) === '[object Date]';
}

module.exports = { loadAppsScript, getConst, plain, isDate };
