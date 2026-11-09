/**
 * Constantes compartidas del Mail Merge.
 *
 * Los valores de encabezados y estados son literales de compatibilidad con el
 * complemento anterior y con los operadores: no se traducen (D-01).
 * Ningún archivo usa estas constantes en su nivel superior, por lo que el
 * orden de carga de los archivos no importa.
 */

// Encabezados que el código reconoce en la fila 1 de la pestaña de la campaña.
const HEADERS = {
  EMAIL: 'Email Address',
  ATTACHMENTS: 'File Attachments',
  STATUS: 'Mail Merge Status',
  SCHEDULED: 'Scheduled Date',
};

// Estados de `Mail Merge Status`. Solo una fila con estado vacío es elegible.
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
  // para terminar la fila en curso, escribir el registro y mostrar el resumen.
  // Se mide desde el inicio de la ejecución, antes del diálogo (D-12).
  MAX_RUNTIME_MS: 270000,
  // 10 segundos de espera del lock: suficiente para una ejecución que está
  // por liberarlo, sin dejar al operador esperando ante un envío en curso.
  LOCK_WAIT_MS: 10000,
};

// Pestaña de registro en el mismo Sheet, creada al primer uso (D-17).
const LOG_SHEET_NAME = 'Registro Mail Merge';
const LOG_HEADERS = ['Fecha', 'Campaña', 'Pestaña', 'Fila', 'Destinatario', 'Resultado', 'Detalle'];

// Claves de la configuración de campaña en las propiedades del usuario (D-08).
const PROPERTY_KEYS = {
  SHEET_ID: 'MM_SHEET_ID',
  DRAFT_ID: 'MM_DRAFT_ID',
  FROM: 'MM_FROM',
  REPLY_TO: 'MM_REPLY_TO',
};

// Tipos nativos de Google que se exportan a PDF como adjunto (D-10). Cualquier
// otro tipo nativo bloquea la fila.
const GOOGLE_EXPORTABLE_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
];
