'use strict';

// Vistas ficticias de la sidebar (plan `plans/2026-11-14_eclipse-console-ui.md`,
// "Vista previa local (D-59)"): las comparten los tests de Eclipse Console y la
// vista previa local. Son los mismos datos que construye `tests/sidebar.test.js`
// con sus funciones locales (ese archivo no se refactoriza). Cada llamada
// devuelve objetos nuevos; las variantes se nombran por texto y los pasos
// siguientes pueden agregar otras sin cambiar las existentes. Solo direcciones
// `example.test`.

const USER = 'operador@example.test';
const TOKEN = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TOKEN_2 = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const TEST_TOKEN = '2c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f';

const CONSENT_ROWS = [{ rowNumber: 3, columns: ['Campaña'] }];
const CONSENT_TEXT =
  'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 1 fila: fila 3 (Campaña)';
const TEST_CONSENT_ROWS = [{ rowNumber: 2, columns: ['Fecha', 'Detalle'] }];
const TEST_CONSENT_TEXT =
  'Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en 1 fila: fila 2 (Fecha, Detalle)';

function inMinutes(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function unknownVariant(kind, variant) {
  throw new Error(`sidebar-views: variante desconocida de ${kind}: "${variant}"`);
}

// --- PanelState ----------------------------------------------------------------

// `panelState()` tiene configuración guardada; `panelState({ current: null })`
// es la primera apertura y `panelState({ drafts: [] })` la cuenta sin borradores.
function panelState(overrides = {}) {
  return {
    sheets: [
      { id: 101, name: 'Campaña otoño' },
      { id: 202, name: 'Otra pestaña' },
    ],
    drafts: [{ id: 'draft-1', subject: 'Hola {{First Name}}', date: '2026-11-09T10:00:00.000Z' }],
    senders: [USER, 'alias@example.test'],
    current: {
      sheetId: 202,
      draftId: 'draft-1',
      from: 'alias@example.test',
      replyTo: 'respuestas@example.test',
      campaignName: 'Otoño 2026',
    },
    ...overrides,
  };
}

// --- ValidationView ------------------------------------------------------------

function baseValidation() {
  return {
    ok: true,
    globalErrors: [],
    setup: null,
    sheetName: 'Campaña otoño',
    subject: 'Hola {{First Name}}',
    from: USER,
    replyTo: '',
    quotaRemaining: 95,
    counts: { valid: 2, invalid: 1, excluded: 1 },
    excludedByReason: [{ reason: 'resultado: Email Sent', count: 1 }],
    commonAttachments: [],
    rows: [
      { rowNumber: 2, email: 'alpha@example.test', attachmentNames: ['a.pdf'] },
      { rowNumber: 3, email: 'beta@example.test', attachmentNames: [] },
    ],
    moreRows: 0,
    invalidRows: [{ rowNumber: 5, reasons: ['Email Address inválido'] }],
    moreInvalid: 0,
    overwriteRows: [],
  };
}

const SETUP_HEADER_KEY = '["Email Address","Mail Merge Status","Scheduled Date"]';

// Variantes: 'ok', 'setup', 'setup-bloqueado', 'bloqueada', 'consentimiento'.
function validationView(variant = 'ok', overrides = {}) {
  let view;
  switch (variant) {
    case 'ok':
      view = baseValidation();
      break;
    case 'setup':
      view = {
        ...baseValidation(),
        ok: false,
        globalErrors: ['La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"'],
        setup: {
          needed: true,
          headerKey: SETUP_HEADER_KEY,
          renames: [
            { column: 1, from: 'Mail Merge Status', to: 'Resultado' },
            { column: 2, from: 'Scheduled Date', to: 'Fecha' },
          ],
          appends: [
            { column: 3, name: 'Campaña' },
            { column: 4, name: 'Detalle' },
          ],
          errors: [],
          blockedRows: [],
        },
        counts: { valid: 0, invalid: 0, excluded: 0 },
        excludedByReason: [],
        rows: [],
        invalidRows: [],
      };
      break;
    case 'setup-bloqueado':
      view = {
        ...baseValidation(),
        ok: false,
        globalErrors: ['Faltan columnas'],
        setup: {
          needed: true,
          headerKey: SETUP_HEADER_KEY,
          renames: [],
          appends: [],
          errors: ['La fila 4 tiene Scheduled Date con valor y el estado vacío'],
          blockedRows: [4],
        },
      };
      break;
    case 'bloqueada':
      view = {
        ...baseValidation(),
        ok: false,
        globalErrors: ['El borrador usa {{Apellido}}, que no es un encabezado de la pestaña'],
      };
      break;
    case 'consentimiento':
      view = { ...baseValidation(), overwriteRows: CONSENT_ROWS.map((row) => ({ ...row, columns: [...row.columns] })) };
      break;
    default:
      return unknownVariant('validationView', variant);
  }
  return { ...view, ...overrides };
}

// --- ConfirmationView ----------------------------------------------------------

function sendView() {
  return {
    kind: 'send',
    campaign: 'Otoño 2026',
    sheetName: 'Campaña otoño',
    subject: 'Hola {{First Name}}',
    from: USER,
    replyTo: '',
    count: 3,
    commonAttachments: ['condiciones.pdf'],
    rows: [
      { rowNumber: 2, email: 'alpha@example.test', attachmentNames: ['a.pdf'] },
      { rowNumber: 3, email: 'beta@example.test', attachmentNames: [] },
      { rowNumber: 4, email: 'gamma@example.test', attachmentNames: ['c.pdf', 'd.pdf'] },
    ],
    invalidCount: 1,
    excludedCount: 2,
    overwriteRows: [],
    consentRequired: false,
    consentText: '',
    warning: 'Se enviarán 3 correos reales. Esta acción no se puede deshacer.',
    expiresAtIso: inMinutes(10),
  };
}

function testView() {
  return {
    kind: 'test',
    campaign: 'Otoño 2026',
    sheetName: 'Campaña otoño',
    subject: 'Hola {{First Name}}',
    from: USER,
    replyTo: '',
    to: USER,
    count: 1,
    commonAttachments: [],
    rows: [{ rowNumber: 2, email: 'alpha@example.test', attachmentNames: [] }],
    invalidCount: 0,
    excludedCount: 0,
    overwriteRows: [],
    consentRequired: false,
    consentText: '',
    warning: 'Se enviará 1 correo a tu cuenta (' + USER + ') con el asunto precedido por [PRUEBA].',
    expiresAtIso: inMinutes(10),
  };
}

// `kind`: 'send' o 'test'. Variantes: 'ok', 'consentimiento', 'vencida'.
function confirmationView(kind, variant = 'ok', overrides = {}) {
  let view;
  if (kind === 'send') {
    view = sendView();
  } else if (kind === 'test') {
    view = testView();
  } else {
    return unknownVariant('confirmationView (kind)', kind);
  }
  switch (variant) {
    case 'ok':
      break;
    case 'consentimiento':
      view.overwriteRows = (kind === 'send' ? CONSENT_ROWS : TEST_CONSENT_ROWS).map((row) => ({
        ...row,
        columns: [...row.columns],
      }));
      view.consentRequired = true;
      view.consentText = kind === 'send' ? CONSENT_TEXT : TEST_CONSENT_TEXT;
      break;
    case 'vencida':
      view.expiresAtIso = inMinutes(-1);
      break;
    default:
      return unknownVariant('confirmationView', variant);
  }
  return { ...view, ...overrides };
}

// --- Progreso en caché (respuesta de getSendProgress) --------------------------

function counts(overrides = {}) {
  return { total: 3, processed: 0, sent: 0, skipped: 0, review: 0, pending: 3, ...overrides };
}

// Variantes: 'sin-iniciar', 'en-curso', 'parcial', 'prueba'.
function progress(variant = 'en-curso') {
  switch (variant) {
    case 'sin-iniciar':
      return { found: false, progress: null };
    case 'en-curso':
      return {
        found: true,
        progress: {
          state: 'EN_CURSO',
          kind: 'send',
          campaign: 'Otoño 2026',
          counts: counts({ processed: 2, sent: 2, review: 1, pending: 1 }),
          rows: [
            { rowNumber: 2, result: 'Email Sent', detail: 'Aceptado por Gmail' },
            { rowNumber: 3, result: 'REVISAR', detail: 'La fila se desplazó; enviado a [dirección]' },
          ],
          rowsTruncated: false,
          stoppedReason: '',
        },
      };
    case 'parcial':
      return {
        found: true,
        progress: {
          state: 'EN_CURSO',
          kind: 'send',
          campaign: 'Otoño 2026',
          counts: counts({ processed: 1, sent: 1, pending: 2 }),
          rows: [{ rowNumber: 2, result: 'Email Sent', detail: 'Aceptado por Gmail' }],
          rowsTruncated: false,
          stoppedReason: '',
        },
      };
    case 'prueba':
      return {
        found: true,
        progress: {
          state: 'EN_CURSO',
          kind: 'test',
          campaign: 'Otoño 2026',
          counts: { total: 1, processed: 0, sent: 0, skipped: 0, review: 0, pending: 1 },
          rows: [{ rowNumber: 2, result: 'ENVIANDO', detail: 'Envío iniciado' }],
          rowsTruncated: false,
          stoppedReason: '',
        },
      };
    default:
      return unknownVariant('progress', variant);
  }
}

// --- SendResultView ------------------------------------------------------------

// Variantes: 'ok', 'corte', 'rechazo', 'prueba'.
function sendResult(variant = 'ok', overrides = {}) {
  const base = {
    ok: true,
    kind: 'send',
    campaign: 'Otoño 2026',
    counts: counts({ processed: 3, sent: 2, skipped: 1, pending: 0 }),
    rows: [
      { rowNumber: 2, recipient: 'alpha@example.test', result: 'Email Sent', detail: 'Aceptado por Gmail' },
      { rowNumber: 3, recipient: 'beta@example.test', result: 'OMITIDA', detail: 'Cambió después de la confirmación' },
      { rowNumber: 4, recipient: 'gamma@example.test', result: 'Email Sent', detail: 'Aceptado por Gmail' },
    ],
    stoppedReason: '',
    summaryLines: ['Campaña: Otoño 2026', '2 correos aceptados por Gmail', 'Filas procesadas: 3 de 3'],
  };
  let result;
  switch (variant) {
    case 'ok':
      result = base;
      break;
    case 'corte':
      result = {
        ...base,
        stoppedReason: 'Se agotó la cuota diaria de envíos de Gmail; las filas restantes siguen pendientes',
      };
      break;
    case 'rechazo':
      result = {
        ...base,
        ok: false,
        counts: counts({ total: 0, pending: 0 }),
        rows: [],
        stoppedReason: 'Hay otra ejecución en curso; reintentá en unos minutos',
        summaryLines: ['El envío no se inició: Hay otra ejecución en curso; reintentá en unos minutos'],
      };
      break;
    case 'prueba':
      result = {
        ok: true,
        kind: 'test',
        campaign: 'Otoño 2026',
        counts: { total: 1, processed: 1, sent: 1, skipped: 0, review: 0, pending: 0 },
        rows: [
          { rowNumber: 2, recipient: USER, result: 'Email Sent', detail: 'PRUEBA enviada a tu cuenta (' + USER + ')' },
        ],
        stoppedReason: '',
        summaryLines: ['1 correo aceptado por Gmail'],
      };
      break;
    default:
      return unknownVariant('sendResult', variant);
  }
  return { ...result, ...overrides };
}

module.exports = {
  USER,
  TOKEN,
  TOKEN_2,
  TEST_TOKEN,
  CONSENT_ROWS,
  CONSENT_TEXT,
  inMinutes,
  panelState,
  validationView,
  confirmationView,
  progress,
  sendResult,
};
