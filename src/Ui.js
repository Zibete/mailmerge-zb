/**
 * Menú, diálogos y funciones públicas de la sidebar. Los manejadores de menú
 * solo conectan `createServices_()` y `createUi_()` con los controladores
 * `run*_`, que reciben `deps` y `ui` para poder probarse con falsos.
 */

const MENU_TITLE_ = 'Mail Merge';

// Ítems del menú: texto visible y función pública que ejecuta.
const MENU_ITEMS_ = [
  ['Configurar campaña…', 'menuConfigure'],
  ['Validar', 'menuValidate'],
  ['Enviar prueba…', 'menuTestSend'],
  ['Enviar pendientes…', 'menuSendPending'],
  ['Ver registro', 'menuShowLog'],
];

const UI_TEXT_ = {
  VALIDATE_TITLE: 'Validar campaña',
  TEST_TITLE: 'Enviar prueba',
  TEST_BAD_ROW: 'Indicá un número de fila entero, 2 o mayor. No se envió nada.',
  SEND_TITLE: 'Enviar pendientes',
  CONFIRM_TITLE: 'Confirmar envío',
  RESULT_TITLE: 'Resultado del envío',
  NOTHING_TO_SEND: 'No hay correos para enviar. No se envió nada.',
  LOG_TITLE: 'Ver registro',
  NO_LOG: 'Todavía no hay registro.',
  SIDEBAR_TITLE: 'Configurar campaña',
};

/**
 * Agrega el menú `Mail Merge`. No lee datos ni envía nada.
 */
function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu(MENU_TITLE_);
  MENU_ITEMS_.forEach(function (item) {
    menu.addItem(item[0], item[1]);
  });
  menu.addToUi();
}

function menuConfigure() {
  createUi_().showSidebar();
}

function menuValidate() {
  runValidate_(createServices_(), createUi_());
}

function menuTestSend() {
  runTestSendFromUi_(createServices_(), createUi_());
}

function menuSendPending() {
  runSendPending_(createServices_(), createUi_());
}

function menuShowLog() {
  if (!createServices_().sheets.showLogSheet()) {
    createUi_().alert(UI_TEXT_.LOG_TITLE, UI_TEXT_.NO_LOG);
  }
}

/**
 * Envuelve `SpreadsheetApp.getUi()` con la interfaz mínima que usan los
 * controladores: `alert`, `confirm` (Sí/No → booleano), `prompt` (texto o
 * `null` si se cancela) y `showSidebar`.
 */
function createUi_() {
  const ui = SpreadsheetApp.getUi();
  return {
    alert: function (title, text) {
      ui.alert(title, text, ui.ButtonSet.OK);
    },
    confirm: function (title, text) {
      return ui.alert(title, text, ui.ButtonSet.YES_NO) === ui.Button.YES;
    },
    prompt: function (title, text) {
      const response = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
      return response.getSelectedButton() === ui.Button.OK ? response.getResponseText() : null;
    },
    showSidebar: function () {
      ui.showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle(UI_TEXT_.SIDEBAR_TITLE));
    },
  };
}

/**
 * `Validar`: informe de solo lectura (AC-27). Nunca envía ni escribe.
 */
function runValidate_(deps, ui) {
  const report = buildPreflight_(deps, deps.props.getConfig());
  ui.alert(UI_TEXT_.VALIDATE_TITLE, formatPreflightReport_(report));
}

/**
 * `Enviar prueba…`: pide la fila (entero ≥ 2) y envía la prueba a la cuenta
 * propia (D-06, D-07). Cancelar el diálogo no hace nada.
 */
function runTestSendFromUi_(deps, ui) {
  // El texto usa `TEST_SUBJECT_PREFIX` (de `Config.js`) recién al ejecutarse,
  // nunca en el nivel superior: el orden de carga de los archivos no importa.
  const answer = ui.prompt(
    UI_TEXT_.TEST_TITLE,
    'Número de fila a probar (2 o mayor). La prueba se envía a tu propia cuenta, con el asunto ' +
      'precedido por "' + TEST_SUBJECT_PREFIX.trim() + '", y no cambia el estado de la fila.'
  );
  if (answer === null || answer === undefined) {
    return;
  }
  const text = String(answer).trim();
  if (!/^\d+$/.test(text) || Number(text) < 2) {
    ui.alert(UI_TEXT_.TEST_TITLE, UI_TEXT_.TEST_BAD_ROW);
    return;
  }
  const rowNumber = Number(text);
  const result = runTestSend_(deps, deps.props.getConfig(), rowNumber);

  const lines = [];
  if (result.ok) {
    lines.push(
      'Gmail aceptó el envío de prueba de la fila ' + rowNumber + ' a ' + sanitizeHeaderValue_(result.to) + '.',
      'El estado de la fila no cambió.'
    );
  } else {
    lines.push('No se envió la prueba de la fila ' + rowNumber + ':');
    result.errors.forEach(function (error) {
      lines.push('- ' + sanitizeHeaderValue_(error));
    });
  }
  if (result.logErrors > 0) {
    lines.push('', 'Atención: no se pudo escribir la entrada del registro.');
  }
  ui.alert(UI_TEXT_.TEST_TITLE, lines.join('\n'));
}

/**
 * `Enviar pendientes…`: Fase A (validación y confirmación, sin lock) y, solo
 * si el operador responde "Sí", Fase B (envío con lock y checkpoint por fila).
 * El presupuesto de tiempo se mide desde antes del diálogo (D-12).
 */
function runSendPending_(deps, ui) {
  const startedAt = deps.clock.now();
  const config = deps.props.getConfig();
  const prepared = prepareSend_(deps, config);
  const report = prepared.report;

  if (report.globalErrors.length > 0 || report.valid.length === 0) {
    ui.alert(UI_TEXT_.SEND_TITLE, UI_TEXT_.NOTHING_TO_SEND + '\n\n' + formatPreflightReport_(report));
    return;
  }

  const count = report.valid.length;
  const lines = [
    'Pestaña: ' + sanitizeHeaderValue_(report.sheet.name),
    'Asunto del borrador: ' + sanitizeHeaderValue_(report.template.subject),
    'Remitente: ' + sanitizeHeaderValue_(report.from),
    'Reply-To: ' + (report.replyTo ? sanitizeHeaderValue_(report.replyTo) : '(ninguno)'),
    'Filas a enviar: ' + count,
  ];
  if (report.invalid.length > 0 || report.excluded.length > 0) {
    lines.push(
      'Filas que no se enviarán: ' + report.invalid.length + ' inválidas y ' + report.excluded.length +
        ' excluidas (ver "Validar")'
    );
  }
  lines.push(
    '',
    'Revisá destinatario y adjuntos de cada correo:',
    formatRowReview_(report),
    '',
    (count === 1 ? 'Se enviará 1 correo real.' : 'Se enviarán ' + count + ' correos reales.') +
      ' Esta acción no se puede deshacer.',
    '¿Confirmás el envío?'
  );

  if (!ui.confirm(UI_TEXT_.CONFIRM_TITLE, lines.join('\n'))) {
    return;
  }

  const result = executeSend_(deps, config, prepared, startedAt);
  ui.alert(UI_TEXT_.RESULT_TITLE, formatSendSummary_(result));
}

// Remitentes autorizados: la cuenta que ejecuta y sus alias de Gmail (D-05).
function listSenders_(deps) {
  const userEmail = String(deps.session.userEmail() || '').trim();
  const senders = userEmail === '' ? [] : [userEmail];
  (deps.gmail.getAliases() || []).forEach(function (alias) {
    const value = String(alias || '').trim();
    if (value !== '' && senders.indexOf(value) === -1) {
      senders.push(value);
    }
  });
  return senders;
}

/**
 * Pública: la llama la sidebar. Devuelve las opciones de configuración, sin
 * la pestaña de registro, y la configuración actual. Las fechas de los
 * borradores son texto (google.script.run no transporta `Date`).
 */
function getConfigOptions() {
  const deps = createServices_();
  const sheets = deps.sheets
    .listSheets()
    .filter(function (sheet) {
      return sheet.name !== LOG_SHEET_NAME;
    })
    .map(function (sheet) {
      return { id: sheet.id, name: String(sheet.name) };
    });
  const drafts = deps.gmail.listDrafts().map(function (draft) {
    return { id: String(draft.id), subject: String(draft.subject || ''), date: String(draft.date || '') };
  });
  const current = deps.props.getConfig();
  return {
    sheets: sheets,
    drafts: drafts,
    senders: listSenders_(deps),
    current: current
      ? {
          sheetId: current.sheetId === undefined ? null : current.sheetId,
          draftId: current.draftId || '',
          from: current.from || '',
          replyTo: current.replyTo || '',
        }
      : null,
  };
}

/**
 * Pública: la llama la sidebar. Revalida en el servidor todo lo que llega del
 * formulario (R-02, R-04) y solo entonces guarda; ante cualquier problema
 * lanza un `Error` con mensaje en español, que la sidebar muestra.
 */
function saveConfig(input) {
  const deps = createServices_();
  const source = input || {};

  const sheetIdText = source.sheetId === undefined || source.sheetId === null ? '' : String(source.sheetId).trim();
  if (!/^\d+$/.test(sheetIdText)) {
    throw new Error('Elegí una pestaña válida para la campaña.');
  }
  const sheetId = Number(sheetIdText);
  const sheet = deps.sheets.listSheets().filter(function (item) {
    return item.id === sheetId;
  })[0];
  if (!sheet) {
    throw new Error('La pestaña elegida ya no existe; volvé a abrir la configuración.');
  }
  if (sheet.name === LOG_SHEET_NAME) {
    throw new Error('La pestaña de registro no se puede usar como campaña.');
  }

  const draftId = String(source.draftId || '');
  const draftExists = deps.gmail.listDrafts().some(function (draft) {
    return draft.id === draftId;
  });
  if (draftId === '' || !draftExists) {
    throw new Error('El borrador elegido no existe en tu cuenta de Gmail.');
  }

  const from = String(source.from || '').trim();
  if (from === '' || listSenders_(deps).indexOf(from) === -1) {
    throw new Error('El remitente elegido no está autorizado: usá tu cuenta o uno de tus alias de Gmail.');
  }

  const replyTo = String(source.replyTo || '').trim();
  if (replyTo !== '' && !isValidEmail_(replyTo)) {
    throw new Error('El Reply-To no es una dirección válida (una sola dirección, sin espacios).');
  }

  const config = { sheetId: sheetId, draftId: draftId, from: from, replyTo: replyTo };
  deps.props.setConfig(config);
  return config;
}
