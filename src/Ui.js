/**
 * Menú y funciones públicas del panel (D-25, D-44). El menú solo abre la
 * sidebar; todo lo demás lo llama la sidebar con `google.script.run`.
 *
 * Cada función pública es un envoltorio de una línea que conecta
 * `createServices_()` con su `…_`, que recibe `deps` y se prueba con falsos.
 * Reciben solo datos mínimos (token, número de fila, formulario de
 * configuración, clave de encabezados y el booleano de consentimiento de
 * D-47) y devuelven JSON plano con los textos saneados (D-44).
 *
 * `applyColumnSetup_` vive en `Setup.js` y `cancelConfirmation_` en
 * `Confirmation.js`: este archivo define sus envoltorios pero no los redefine
 * (todos los archivos comparten el espacio global de Apps Script).
 */

const MENU_TITLE_ = 'Mail Merge';
const MENU_OPEN_PANEL_ = 'Abrir Mail Merge';
const PANEL_TITLE_ = 'Mail Merge';

/**
 * Agrega el menú `Mail Merge` con un solo ítem. No lee datos ni envía nada.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu(MENU_TITLE_).addItem(MENU_OPEN_PANEL_, 'menuOpenPanel').addToUi();
}

function menuOpenPanel() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle(PANEL_TITLE_));
}

// --- Funciones públicas (las llama la sidebar) -----------------------------

function getPanelState() {
  return getPanelState_(createServices_());
}

function saveConfig(input) {
  return saveConfig_(createServices_(), input);
}

function validateCampaign() {
  return validateCampaign_(createServices_());
}

function applyColumnSetup(expectedHeaderKey) {
  return applyColumnSetup_(createServices_(), expectedHeaderKey);
}

function prepareTestSend(rowNumber) {
  return prepareTestSend_(createServices_(), rowNumber);
}

function executeTestSend(token, overwriteConsent) {
  return executeTestSend_(createServices_(), token, overwriteConsent);
}

function prepareSendPending() {
  return prepareSendPending_(createServices_());
}

function executeSendPending(token, overwriteConsent, filterAcknowledged) {
  return executeSendPending_(createServices_(), token, overwriteConsent, filterAcknowledged);
}

function getSendProgress(token) {
  return getSendProgress_(createServices_(), token);
}

function cancelConfirmation(token) {
  return cancelConfirmation_(createServices_(), token);
}

// --- Implementación -------------------------------------------------------

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

// Fecha de un borrador como texto (google.script.run no transporta `Date`):
// una `Date` válida pasa a ISO; cualquier otro valor, a texto.
function draftDateText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value || '');
}

/**
 * Estado inicial del panel: `{ sheets, drafts, senders, current }`. Las
 * pestañas excluyen la de registro V1 (D-32); `current` es la configuración
 * guardada, con `campaignName` (D-39), o `null`. Solo lectura: no lee la
 * pestaña de la campaña.
 */
function getPanelState_(deps) {
  const sheets = deps.sheets
    .listSheets()
    .filter(function (sheet) {
      return sheet.name !== LEGACY_LOG_SHEET_NAME;
    })
    .map(function (sheet) {
      return { id: sheet.id, name: String(sheet.name) };
    });
  const drafts = deps.gmail.listDrafts().map(function (draft) {
    return { id: String(draft.id), subject: String(draft.subject || ''), date: draftDateText_(draft.date) };
  });
  const current = deps.props.getConfig();
  return {
    sheets: sheets,
    drafts: drafts,
    senders: listSenders_(deps),
    current: current
      ? {
          sheetId: current.sheetId === undefined ? null : current.sheetId,
          draftId: String(current.draftId || ''),
          from: String(current.from || ''),
          replyTo: String(current.replyTo || ''),
          campaignName: String(current.campaignName || ''),
        }
      : null,
  };
}

/**
 * Revalida en el servidor todo lo que llega del formulario (R-02, R-04, D-39)
 * y solo entonces guarda; ante cualquier problema lanza un `Error` con
 * mensaje en español, que la sidebar muestra, sin llamar a `setConfig`.
 */
function saveConfig_(deps, input) {
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
    throw new Error('La pestaña elegida ya no existe; volvé a abrir el panel.');
  }
  if (sheet.name === LEGACY_LOG_SHEET_NAME) {
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

  const campaignName =
    source.campaignName === undefined || source.campaignName === null ? '' : sanitizeHeaderValue_(source.campaignName);
  if (campaignName.length > LIMITS.MAX_CAMPAIGN_NAME_CHARS) {
    throw new Error(
      'El nombre de campaña no puede superar ' + LIMITS.MAX_CAMPAIGN_NAME_CHARS + ' caracteres.'
    );
  }

  const config = { sheetId: sheetId, draftId: draftId, from: from, replyTo: replyTo, campaignName: campaignName };
  deps.props.setConfig(config);
  return config;
}

/**
 * `ValidationView` de la campaña configurada. Solo lectura (AC-33): cero
 * envíos y cero escrituras en la hoja, la caché o la configuración, sin lock.
 */
function validateCampaign_(deps) {
  return buildValidationView_(buildPreflight_(deps, deps.props.getConfig()));
}

// Confirmación de la prueba de una fila (D-40). No escribe la hoja.
function prepareTestSend_(deps, rowNumber) {
  return prepareConfirmation_(deps, 'test', rowNumber);
}

// Ejecuta la prueba confirmada; el consentimiento pasa sin convertir (D-47).
function executeTestSend_(deps, token, overwriteConsent) {
  return executeConfirmed_(deps, token, 'test', overwriteConsent);
}

// Confirmación del envío real de las filas pendientes. No escribe la hoja.
function prepareSendPending_(deps) {
  return prepareConfirmation_(deps, 'send');
}

// Ejecuta el envío confirmado; el consentimiento pasa sin convertir (D-47).
function executeSendPending_(deps, token, overwriteConsent, filterAcknowledged) {
  return executeConfirmed_(deps, token, 'send', overwriteConsent, filterAcknowledged);
}

// Progreso publicado del envío (D-29). Solo lee la caché, sin lock.
function getSendProgress_(deps, token) {
  return readProgress_(deps, token);
}
