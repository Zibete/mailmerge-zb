/**
 * Lógica pura de adjuntos de Drive: lectura de enlaces de `File Attachments`,
 * clasificación por tipo y control del tamaño total. No accede a servicios
 * de Google. Los mensajes de error nunca incluyen la URL ni el ID (R-13).
 */

// Formatos aceptados (D-09): solo `https://` en `drive.google.com` o
// `docs.google.com`, con un ID de 20 caracteres o más. Después del ID solo
// puede seguir el resto de la ruta, la consulta o el fragmento.
const DRIVE_LINK_PATTERNS_ = [
  /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,})(?:[/?#].*)?$/,
  /^https:\/\/drive\.google\.com\/open\?id=([A-Za-z0-9_-]{20,})(?:[&#].*)?$/,
  /^https:\/\/drive\.google\.com\/uc\?id=([A-Za-z0-9_-]{20,})(?:[&#].*)?$/,
  /^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{20,})(?:[/?#].*)?$/,
];

/**
 * Lee los enlaces de Drive de una celda de `File Attachments` (R-05).
 *
 * Devuelve `{ ids, errors }`. Divide por comas, recorta e ignora piezas
 * vacías; `N` en los mensajes es la posición del enlace entre las piezas no
 * vacías. Un enlace con otro host, protocolo o forma es error
 * (`Enlace de adjunto n.º N no válido`); un ID repetido en la misma celda
 * también (`Enlace de adjunto n.º N repetido`). `ids` conserva el orden de la
 * celda y solo incluye los enlaces válidos: el llamador bloquea la fila si
 * `errors` no está vacío.
 */
function parseDriveLinks_(cell) {
  const ids = [];
  const errors = [];
  const text = cell === null || cell === undefined ? '' : String(cell);
  let position = 0;
  text.split(',').forEach(function (piece) {
    const link = piece.trim();
    if (link === '') {
      return;
    }
    position++;
    let id = null;
    for (let i = 0; i < DRIVE_LINK_PATTERNS_.length && id === null; i++) {
      const match = DRIVE_LINK_PATTERNS_[i].exec(link);
      if (match) {
        id = match[1];
      }
    }
    if (id === null) {
      errors.push('Enlace de adjunto n.º ' + position + ' no válido');
    } else if (ids.indexOf(id) !== -1) {
      errors.push('Enlace de adjunto n.º ' + position + ' repetido');
    } else {
      ids.push(id);
    }
  });
  return { ids: ids, errors: errors };
}

/**
 * Clasifica un archivo de Drive (`{ id, name, mimeType, size, trashed }`)
 * según cómo se adjunta (D-10).
 *
 * Devuelve `{ ok, kind, error }`: `export-pdf` para documentos, hojas de
 * cálculo y presentaciones nativos; `binary` para cualquier archivo no nativo
 * (se usa su blob original). Un archivo en la papelera o de otro tipo nativo
 * de Google (formularios, dibujos, accesos directos, carpetas) es error.
 */
function classifyDriveFile_(info) {
  if (!info) {
    return { ok: false, kind: null, error: 'No se pudo leer la información del archivo adjunto' };
  }
  if (info.trashed) {
    return { ok: false, kind: null, error: 'El archivo adjunto está en la papelera de Drive' };
  }
  const mimeType = String(info.mimeType || '');
  if (GOOGLE_EXPORTABLE_MIME_TYPES.indexOf(mimeType) !== -1) {
    return { ok: true, kind: 'export-pdf', error: '' };
  }
  if (mimeType.indexOf('application/vnd.google-apps.') === 0) {
    return { ok: false, kind: null, error: 'Archivo adjunto de tipo no soportado (' + mimeType + ')' };
  }
  return { ok: true, kind: 'binary', error: '' };
}

// Megabytes en formato español (coma decimal, un decimal, sin `,0`). Con
// `roundUp` redondea hacia arriba, para que un total apenas por encima del
// máximo no se muestre igual al máximo.
function formatMegabytes_(bytes, roundUp) {
  const tenths = (bytes / (1024 * 1024)) * 10;
  const rounded = (roundUp ? Math.ceil(tenths) : Math.round(tenths)) / 10;
  return String(rounded).replace('.', ',') + ' MB';
}

/**
 * Controla el tamaño total de los adjuntos de un correo (comunes + de la
 * fila, `[{ size }]`) contra `maxBytes` (AC-09).
 *
 * Devuelve `{ ok, totalBytes, error }`. Un total igual al máximo es válido.
 * Un tamaño desconocido o inválido falla cerrado.
 */
function checkAttachmentSizes_(attachments, maxBytes) {
  const limit = maxBytes === undefined ? LIMITS.MAX_TOTAL_ATTACHMENT_BYTES : maxBytes;
  let total = 0;
  const list = attachments || [];
  for (let i = 0; i < list.length; i++) {
    const size = list[i] ? list[i].size : undefined;
    if (typeof size !== 'number' || !isFinite(size) || size < 0) {
      return {
        ok: false,
        totalBytes: total,
        error: 'No se pudo determinar el tamaño de un archivo adjunto; revisá los adjuntos de esta fila',
      };
    }
    total += size;
  }
  if (total > limit) {
    return {
      ok: false,
      totalBytes: total,
      error:
        'Los adjuntos suman ' + formatMegabytes_(total, true) + ' y el máximo por correo es ' +
        formatMegabytes_(limit, false) + '. Quitá o reducí archivos de esta fila o del borrador.',
    };
  }
  return { ok: true, totalBytes: total, error: '' };
}
