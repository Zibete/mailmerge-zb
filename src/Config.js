/**
 * Constantes compartidas del Mail Merge.
 *
 * Los valores de encabezados y estados son literales de compatibilidad con los
 * operadores y con las hojas existentes: no se traducen. Los encabezados V2
 * (`Fecha`, `Campaña`, `Resultado`, `Detalle`) son literales de compatibilidad
 * aprobados en D-31, que reemplaza a D-01 en lo que respecta a encabezados;
 * `Mail Merge Status` y `Scheduled Date` quedan como encabezados heredados que
 * solo reconoce la migración.
 * Ningún archivo usa estas constantes en su nivel superior, por lo que el
 * orden de carga de los archivos no importa.
 */

// Encabezados que el código reconoce en la fila 1 de la pestaña de la campaña.
// `Fecha`, `Campaña`, `Resultado` y `Detalle` son las columnas gestionadas: las
// escribe el script durante el envío (D-31).
const HEADERS = {
  EMAIL: 'Email Address',
  ATTACHMENTS: 'File Attachments',
  DATE: 'Fecha',
  CAMPAIGN: 'Campaña',
  RESULT: 'Resultado',
  DETAIL: 'Detalle',
};

// Columnas gestionadas en el orden en que la migración las agrega: `Resultado`
// primero, para que toda migración interrumpida ya la tenga (D-33, D-34 d).
const MANAGED_HEADERS = [HEADERS.RESULT, HEADERS.DATE, HEADERS.CAMPAIGN, HEADERS.DETAIL];

// Encabezados de la V1, que solo reconoce la migración (D-31). Su presencia en
// la pestaña hace fallar la validación hasta usar "Preparar columnas".
const LEGACY_HEADERS = {
  STATUS: 'Mail Merge Status',
  SCHEDULED: 'Scheduled Date',
};

// Valores de `Resultado`. Solo una fila con `Resultado` vacío es elegible.
// `ENVIANDO` es el claim persistido antes de llamar a Gmail; `REVISAR` marca
// un resultado ambiguo que requiere revisión manual.
const STATUS = {
  SKIP: 'SKIP',
  SENT: 'Email Sent',
  SENDING: 'ENVIANDO',
  REVIEW: 'REVISAR',
};

// Prefijo del asunto en el envío de prueba.
const TEST_SUBJECT_PREFIX = '[PRUEBA] ';

// Límites configurables (D-11). Nunca se repiten como números en la lógica.
const LIMITS = {
  // 20 MB: por debajo del límite de 25 MB de adjuntos totales por mensaje de
  // Gmail, con margen para el aumento de tamaño por la codificación.
  MAX_TOTAL_ATTACHMENT_BYTES: 20 * 1024 * 1024,
  // 200 KB: el menor límite de cuerpo por mensaje de la página de cuotas
  // (cuentas de consumo; Workspace admite 400 KB). Se controla sobre el HTML
  // más el texto plano renderizados, antes del claim (D-21).
  MAX_BODY_BYTES: 200 * 1024,
  // 4,5 minutos: por debajo del límite de 6 minutos por ejecución, con margen
  // para terminar la fila en curso, escribir su resultado y devolver el
  // resumen. Se mide desde el inicio de la llamada que envía
  // (`executeConfirmed_`), porque la confirmación ocurre en otra ejecución
  // (D-30, reemplaza D-12).
  MAX_RUNTIME_MS: 270000,
  // 10 segundos de espera del lock: suficiente para una ejecución que está
  // por liberarlo, sin dejar al operador esperando ante un envío en curso.
  LOCK_WAIT_MS: 10000,
  // 10 minutos de vigencia de una confirmación (D-26): alcanzan para revisar
  // hasta MAX_CONFIRM_ROWS filas y acotan la ventana entre lo que el operador
  // vio y lo que se envía. Muy por debajo del vencimiento máximo de 6 horas de
  // CacheService.
  CONFIRM_TTL_MS: 600000,
  // 30 minutos de vida del registro de progreso (D-29): cubren una ejecución
  // completa (6 minutos como máximo) con amplio margen para que la sidebar lea
  // el resultado final aunque el sondeo se demore.
  PROGRESS_TTL_MS: 1800000,
  // 500 filas por confirmación (D-41): mantiene el snapshot y el progreso por
  // debajo del límite de 100 KB por valor de CacheService. Una ejecución de
  // 4,5 minutos envía bastante menos; las filas restantes siguen pendientes.
  MAX_CONFIRM_ROWS: 500,
  // 90 KB por valor guardado en la caché (D-41): margen de 10 KB sobre el
  // límite de 100 KB por valor de CacheService. Se mide en bytes UTF-8.
  MAX_CACHE_VALUE_BYTES: 90 * 1024,
  // 300 caracteres de `Detalle` (D-38): un motivo resumido en una línea, que se
  // lee en la celda sin volverla ilegible ni registrar más de lo necesario.
  MAX_DETAIL_CHARS: 300,
  // 80 caracteres de nombre de campaña (D-39): suficiente para un nombre
  // descriptivo y corto de escribir en la columna `Campaña` de cada fila.
  MAX_CAMPAIGN_NAME_CHARS: 80,
};

// Pestaña de registro de la V1 (D-17). Transitorio: la siguen usando `Ui.js` y
// `Services.js` hasta que el panel V2 la reemplace por las columnas gestionadas.
const LOG_SHEET_NAME = 'Registro Mail Merge';
const LOG_HEADERS = ['Fecha', 'Campaña', 'Pestaña', 'Fila', 'Destinatario', 'Resultado', 'Detalle'];

// Claves de la configuración de campaña en las propiedades del usuario (D-08,
// D-39).
const PROPERTY_KEYS = {
  SHEET_ID: 'MM_SHEET_ID',
  DRAFT_ID: 'MM_DRAFT_ID',
  FROM: 'MM_FROM',
  REPLY_TO: 'MM_REPLY_TO',
  CAMPAIGN_NAME: 'MM_CAMPAIGN_NAME',
};

// Prefijos de las claves en `CacheService.getUserCache()`: snapshot de
// confirmación (D-26) y registro de progreso (D-29), seguidos del token.
const CACHE_PREFIX = {
  CONFIRMATION: 'MM_CONF_',
  PROGRESS: 'MM_PROG_',
};

// Tipos nativos de Google que se exportan a PDF como adjunto (D-10). Cualquier
// otro tipo nativo bloquea la fila.
const GOOGLE_EXPORTABLE_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
];
