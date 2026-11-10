'use strict';

// DOM mínimo para ejecutar el `<script>` inline de `src/Sidebar.html` en un
// contexto `vm` (plan V2, "Detalle del código > Sidebar").
//
// Solo implementa la API que la sidebar puede usar: `document.getElementById`,
// `document.createElement`, `appendChild`, `removeChild`, `firstChild`,
// `textContent`, `value`, `checked`, `max`, `disabled`, `hidden`,
// `className`, `addEventListener` (`click` y `change`), `new Option`,
// `select.add`, `setTimeout` y `clearTimeout`. Cualquier otra propiedad de
// `document` o de un elemento lanza (con un `Proxy`), para que la sidebar no
// salga de ese subconjunto (por ejemplo, nada de HTML crudo ni de selectores).
//
// Los elementos con `id` del marcado se crean con su etiqueta y su anidamiento
// (cada uno cuelga del ancestro con `id` más cercano), sus atributos `type`,
// `class`, `value`, `max`, `hidden` y `disabled`, y su texto si no contiene
// otras etiquetas. `google.script.run` es un falso encadenable que registra
// cada llamada (`{ name, args, state }`) y deja resolverla o hacerla fallar;
// solo acepta los nombres de las funciones públicas de `src/Ui.js`. Los
// temporizadores quedan en una cola manual.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');
const VOID_TAGS = ['area', 'base', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr'];
const ELEMENT_READ = [
  'tagName',
  'id',
  'type',
  'textContent',
  'value',
  'checked',
  'max',
  'disabled',
  'hidden',
  'className',
  'appendChild',
  'removeChild',
  'firstChild',
  'addEventListener',
];
const ELEMENT_WRITE = ['textContent', 'value', 'checked', 'max', 'disabled', 'hidden', 'className'];
const EVENT_TYPES = ['click', 'change'];

// Nombres de las funciones públicas de `src/Ui.js` (las que no terminan en `_`).
function publicServerFunctions() {
  const code = fs.readFileSync(path.join(SRC_DIR, 'Ui.js'), 'utf8');
  const names = [];
  const pattern = /^function\s+([A-Za-z]\w*)\s*\(/gm;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    if (!match[1].endsWith('_')) {
      names.push(match[1]);
    }
  }
  return names;
}

function attribute(attrs, name) {
  const match = new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"').exec(attrs);
  return match ? match[1] : null;
}

function hasBooleanAttribute(attrs, name) {
  return new RegExp('\\s' + name + '(?=[\\s/>=]|$)').test(attrs);
}

function extractScript(html) {
  const matches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  if (matches.length !== 1) {
    throw new Error(`Sidebar: se esperaba un solo <script>, hay ${matches.length}`);
  }
  if (/\ssrc\s*=/.test(matches[0][1])) {
    throw new Error('Sidebar: el <script> no puede cargar recursos externos');
  }
  return matches[0][2];
}

function loadSidebar(options = {}) {
  const html = options.html !== undefined ? options.html : fs.readFileSync(path.join(SRC_DIR, 'Sidebar.html'), 'utf8');
  const script = extractScript(html);
  const serverFunctions = options.serverFunctions || publicServerFunctions();

  const internals = new WeakMap(); // proxy → nodo interno
  const byIdMap = new Map();
  const created = [];

  // --- Nodos ----------------------------------------------------------------

  function textNode(text) {
    const node = { kind: 'text', text: String(text), parent: null };
    node.proxy = new Proxy(node, {
      get(target, prop) {
        if (typeof prop === 'symbol') {
          return undefined;
        }
        throw new Error(`Sidebar: el nodo de texto no expone "${String(prop)}"`);
      },
      set(target, prop) {
        throw new Error(`Sidebar: el nodo de texto no admite "${String(prop)}"`);
      },
    });
    internals.set(node.proxy, node);
    return node;
  }

  function textOf(node) {
    if (node.kind === 'text') {
      return node.text;
    }
    return node.children.map(textOf).join('');
  }

  function detach(node) {
    if (node.parent) {
      node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = null;
    }
  }

  function options_(node) {
    return node.children.filter((child) => child.kind === 'element' && child.tagName === 'OPTION');
  }

  function dispatch(node, type) {
    const event = { type, target: node.proxy, preventDefault() {} };
    for (const listener of node.listeners[type] || []) {
      listener.call(node.proxy, event);
    }
  }

  function makeElement(tag, init = {}) {
    const tagName = String(tag).toUpperCase();
    const node = {
      kind: 'element',
      tagName,
      id: init.id || '',
      type: init.type || (tagName === 'INPUT' ? 'text' : tagName === 'BUTTON' ? 'submit' : ''),
      className: init.className || '',
      disabled: Boolean(init.disabled),
      hidden: Boolean(init.hidden),
      checked: false,
      max: init.max !== undefined ? Number(init.max) : 1,
      rawValue: init.value !== undefined ? String(init.value) : tagName === 'PROGRESS' ? 0 : '',
      selectedIndex: -1,
      children: [],
      parent: null,
      listeners: {},
    };

    const api = {
      appendChild(child) {
        const inner = internals.get(child);
        if (!inner) {
          throw new Error('Sidebar: appendChild recibió algo que no es un nodo');
        }
        detach(inner);
        inner.parent = node;
        node.children.push(inner);
        if (node.tagName === 'SELECT' && inner.tagName === 'OPTION' && node.selectedIndex === -1) {
          node.selectedIndex = 0;
        }
        return child;
      },
      removeChild(child) {
        const inner = internals.get(child);
        if (!inner || inner.parent !== node) {
          throw new Error('Sidebar: removeChild de un nodo que no es hijo');
        }
        const isOption = inner.tagName === 'OPTION';
        detach(inner);
        if (node.tagName === 'SELECT' && isOption) {
          const count = options_(node).length;
          node.selectedIndex = count === 0 ? -1 : Math.min(node.selectedIndex, count - 1);
        }
        return child;
      },
      addEventListener(type, listener) {
        if (EVENT_TYPES.indexOf(type) === -1) {
          throw new Error(`Sidebar: evento no permitido "${type}"`);
        }
        if (typeof listener !== 'function') {
          throw new Error('Sidebar: addEventListener sin función');
        }
        (node.listeners[type] = node.listeners[type] || []).push(listener);
      },
      add(option) {
        if (node.tagName !== 'SELECT') {
          throw new Error('Sidebar: add solo existe en <select>');
        }
        return api.appendChild(option);
      },
    };

    function getValue() {
      if (node.tagName === 'SELECT') {
        const list = options_(node);
        return node.selectedIndex >= 0 && node.selectedIndex < list.length ? list[node.selectedIndex].rawValue : '';
      }
      if (node.tagName === 'PROGRESS') {
        return Number(node.rawValue);
      }
      return node.rawValue;
    }

    function setValue(value) {
      if (node.tagName === 'SELECT') {
        node.selectedIndex = options_(node).findIndex((option) => option.rawValue === String(value));
        return;
      }
      node.rawValue = node.tagName === 'PROGRESS' ? Number(value) : String(value);
    }

    node.proxy = new Proxy(node, {
      get(target, prop) {
        if (typeof prop === 'symbol') {
          return undefined;
        }
        if (ELEMENT_READ.indexOf(prop) === -1 && !(prop === 'add' && node.tagName === 'SELECT')) {
          throw new Error(`Sidebar: el elemento no expone "${prop}" (fuera del subconjunto permitido)`);
        }
        switch (prop) {
          case 'textContent':
            return textOf(node);
          case 'value':
            return getValue();
          case 'firstChild':
            return node.children.length > 0 ? node.children[0].proxy : null;
          case 'appendChild':
          case 'removeChild':
          case 'addEventListener':
          case 'add':
            return api[prop];
          default:
            return node[prop];
        }
      },
      set(target, prop, value) {
        if (ELEMENT_WRITE.indexOf(prop) === -1) {
          throw new Error(`Sidebar: el elemento no admite asignar "${String(prop)}"`);
        }
        switch (prop) {
          case 'textContent': {
            for (const child of node.children.slice()) {
              detach(child);
            }
            const text = value === null || value === undefined ? '' : String(value);
            if (text !== '') {
              const child = textNode(text);
              child.parent = node;
              node.children.push(child);
            }
            return true;
          }
          case 'value':
            setValue(value);
            return true;
          case 'checked':
          case 'disabled':
          case 'hidden':
            node[prop] = Boolean(value);
            return true;
          case 'max':
            node.max = Number(value);
            return true;
          case 'className':
            node.className = String(value);
            return true;
          default:
            return false;
        }
      },
    });
    internals.set(node.proxy, node);
    return node;
  }

  // --- Marcado estático -------------------------------------------------------

  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const stack = []; // { tag, node | null }
  const tokens = /<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let token;
  while ((token = tokens.exec(body)) !== null) {
    if (token[3] !== undefined) {
      const text = token[3].replace(/\s+/g, ' ').trim();
      const top = stack[stack.length - 1];
      if (text !== '' && top && top.node) {
        const child = textNode(text);
        child.parent = top.node;
        top.node.children.push(child);
      }
      continue;
    }
    const tag = token[1].toLowerCase();
    const attrs = token[2] || '';
    if (token[0].startsWith('</')) {
      while (stack.length > 0) {
        const popped = stack.pop();
        if (popped.tag === tag) {
          break;
        }
      }
      continue;
    }
    if (tag === '!doctype') {
      continue;
    }
    let node = null;
    const id = attribute(attrs, 'id');
    if (id !== null) {
      if (byIdMap.has(id)) {
        throw new Error(`Sidebar: id duplicado "${id}"`);
      }
      node = makeElement(tag, {
        id,
        type: attribute(attrs, 'type') || undefined,
        className: attribute(attrs, 'class') || '',
        value: attribute(attrs, 'value') === null ? undefined : attribute(attrs, 'value'),
        max: attribute(attrs, 'max') === null ? undefined : attribute(attrs, 'max'),
        hidden: hasBooleanAttribute(attrs, 'hidden'),
        disabled: hasBooleanAttribute(attrs, 'disabled'),
      });
      if (hasBooleanAttribute(attrs, 'checked')) {
        node.checked = true;
      }
      const parent = [...stack].reverse().find((entry) => entry.node);
      if (parent) {
        node.parent = parent.node;
        parent.node.children.push(node);
      }
      byIdMap.set(id, node);
    }
    if (VOID_TAGS.indexOf(tag) === -1 && !/\/\s*$/.test(attrs)) {
      stack.push({ tag, node });
    }
  }

  // --- document, Option y temporizadores --------------------------------------

  const documentApi = {
    getElementById(id) {
      const node = byIdMap.get(String(id));
      return node ? node.proxy : null;
    },
    createElement(tag) {
      if (!/^[a-z][a-z0-9]*$/.test(String(tag))) {
        throw new Error(`Sidebar: etiqueta inválida "${tag}"`);
      }
      created.push(String(tag));
      return makeElement(tag).proxy;
    },
  };
  const document = new Proxy(documentApi, {
    get(target, prop) {
      if (typeof prop === 'symbol') {
        return undefined;
      }
      if (prop === 'getElementById' || prop === 'createElement') {
        return target[prop];
      }
      throw new Error(`Sidebar: document.${prop} no está permitido`);
    },
    set(target, prop) {
      throw new Error(`Sidebar: no se puede asignar document.${String(prop)}`);
    },
  });

  function Option(text, value) {
    const node = makeElement('option');
    const label = text === undefined || text === null ? '' : String(text);
    if (label !== '') {
      const child = textNode(label);
      child.parent = node;
      node.children.push(child);
    }
    node.rawValue = value === undefined ? label : String(value);
    return node.proxy;
  }

  const timerQueue = [];
  let nextTimerId = 1;
  function setTimeoutFake(fn, ms) {
    if (typeof fn !== 'function') {
      throw new Error('Sidebar: setTimeout sin función');
    }
    const id = nextTimerId++;
    timerQueue.push({ id, fn, ms: Number(ms) || 0 });
    return id;
  }
  function clearTimeoutFake(id) {
    const index = timerQueue.findIndex((timer) => timer.id === id);
    if (index !== -1) {
      timerQueue.splice(index, 1);
    }
  }
  function pendingTimers() {
    return timerQueue.map((timer) => ({ id: timer.id, ms: timer.ms }));
  }
  function runNextTimer() {
    const timer = timerQueue.shift();
    if (!timer) {
      throw new Error('No hay temporizadores pendientes');
    }
    timer.fn();
    return { id: timer.id, ms: timer.ms };
  }

  // --- google.script.run falso ------------------------------------------------

  const calls = [];
  let hostCloseCount = 0;
  let ctx = null;

  // `google.script.run` transporta solo JSON: los argumentos se copian y los
  // valores de respuesta se reconstruyen dentro del contexto de la sidebar.
  function toSidebarRealm(value) {
    if (value === undefined) {
      return undefined;
    }
    return vm.runInContext('JSON.parse', ctx)(JSON.stringify(value));
  }

  function makeRunner(handlers) {
    return new Proxy(
      {},
      {
        get(target, prop) {
          if (typeof prop === 'symbol') {
            return undefined;
          }
          if (prop === 'withSuccessHandler' || prop === 'withFailureHandler') {
            return function (fn) {
              if (typeof fn !== 'function') {
                throw new Error(`Sidebar: ${prop} sin función`);
              }
              const key = prop === 'withSuccessHandler' ? 'success' : 'failure';
              return makeRunner({ ...handlers, [key]: fn });
            };
          }
          if (serverFunctions.indexOf(prop) === -1) {
            throw new Error(`Sidebar: "${prop}" no es una función pública de src/Ui.js`);
          }
          return function (...args) {
            const record = {
              name: prop,
              args: JSON.parse(JSON.stringify(args)),
              state: 'pending',
              success: handlers.success || null,
              failure: handlers.failure || null,
            };
            calls.push(record);
          };
        },
      }
    );
  }

  function resolve(call, value) {
    if (!call || call.state !== 'pending') {
      throw new Error('resolve: la llamada no está pendiente');
    }
    call.state = 'resolved';
    if (call.success) {
      call.success(toSidebarRealm(value));
    }
  }

  function fail(call, error) {
    if (!call || call.state !== 'pending') {
      throw new Error('fail: la llamada no está pendiente');
    }
    call.state = 'failed';
    if (call.failure) {
      const message = error && error.message ? error.message : String(error);
      call.failure(vm.runInContext('(function (m) { return new Error(m); })', ctx)(message));
    }
  }

  const google = {
    script: {
      get run() {
        return makeRunner({});
      },
      host: {
        close() {
          hostCloseCount++;
        },
      },
    },
  };

  ctx = vm.createContext({
    document,
    google,
    Option,
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
  });
  vm.runInContext(script, ctx, { filename: 'Sidebar.html' });

  // --- Helpers de los tests ---------------------------------------------------

  function nodeOf(target) {
    const node = typeof target === 'string' ? byIdMap.get(target) : internals.get(target);
    if (!node) {
      throw new Error(`No existe el elemento ${String(target)}`);
    }
    return node;
  }

  function byId(id) {
    return nodeOf(id).proxy;
  }

  function click(id, opts = {}) {
    const node = nodeOf(id);
    if (node.disabled && !opts.force) {
      return false; // como en el navegador, un botón deshabilitado no recibe clics
    }
    dispatch(node, 'click');
    return true;
  }

  function setValue(id, value) {
    const node = nodeOf(id);
    node.proxy.value = value;
    dispatch(node, 'change');
  }

  function setChecked(id, checked) {
    const node = nodeOf(id);
    node.checked = Boolean(checked);
    dispatch(node, 'change');
  }

  function text(id) {
    return textOf(nodeOf(id));
  }

  // Hijos elemento (sin nodos de texto), como proxies.
  function childrenOf(target) {
    return nodeOf(target)
      .children.filter((child) => child.kind === 'element')
      .map((child) => child.proxy);
  }

  // Textos de las celdas de cada fila de un `<tbody>`.
  function tableRows(id) {
    return nodeOf(id)
      .children.filter((child) => child.kind === 'element')
      .map((row) => row.children.filter((cell) => cell.kind === 'element').map(textOf));
  }

  // Visible si ni el elemento ni sus ancestros están ocultos.
  function isVisible(id) {
    for (let node = nodeOf(id); node; node = node.parent) {
      if (node.hidden) {
        return false;
      }
    }
    return true;
  }

  function callsTo(name) {
    return calls.filter((call) => call.name === name);
  }

  function lastCall(name) {
    const list = callsTo(name);
    return list[list.length - 1];
  }

  function pendingCalls() {
    return calls.filter((call) => call.state === 'pending');
  }

  return {
    document,
    calls,
    timers: { pending: pendingTimers, runNext: runNextTimer },
    MailMergePanel: ctx.MailMergePanel,
    context: ctx,
    created,
    byId,
    click,
    setValue,
    setChecked,
    text,
    childrenOf,
    tableRows,
    isVisible,
    callsTo,
    lastCall,
    pendingCalls,
    resolve,
    fail,
    pendingTimers,
    runNextTimer,
    hostCloseCount: () => hostCloseCount,
  };
}

module.exports = { loadSidebar, publicServerFunctions };
