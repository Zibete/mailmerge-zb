/**
 * Lógica pura sobre los datos de la hoja: encabezados, elegibilidad de filas,
 * validación de destinatarios y clave de fila. No accede a servicios de Google.
 */

// Índice que indica que una columna opcional no existe en la hoja.
const MISSING_COLUMN = -1;

// Normaliza un encabezado para detectar duplicados y variantes ambiguas:
// recorta, colapsa espacios internos y pasa a minúsculas.
function normalizeHeader_(value) {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Mapea la fila de encabezados (fila 1) a índices de columna 0-based.
 *
 * Devuelve `{ ok, columns: { email, attachments, status, scheduled }, byName, errors }`.
 * `columns.attachments` y `columns.scheduled` valen `MISSING_COLUMN` (-1) si la
 * columna no existe. Falla cerrado (AC-12): un encabezado requerido ausente,
 * un encabezado repetido (comparando en forma normalizada) o un encabezado
 * conocido escrito con otra capitalización o espaciado son errores; nunca se
 * adivina cuál es la columna correcta. Las celdas de encabezado vacías se ignoran.
 */
function mapHeaders_(headerRow) {
  const known = [
    { key: 'email', name: HEADERS.EMAIL, required: true },
    { key: 'attachments', name: HEADERS.ATTACHMENTS, required: false },
    { key: 'status', name: HEADERS.STATUS, required: true },
    { key: 'scheduled', name: HEADERS.SCHEDULED, required: false },
  ];
  const columns = {
    email: MISSING_COLUMN,
    attachments: MISSING_COLUMN,
    status: MISSING_COLUMN,
    scheduled: MISSING_COLUMN,
  };
  const byName = {};
  const errors = [];
  const firstPositionByNormalized = {};
  const ambiguousKeys = {};

  (headerRow || []).forEach(function (cell, index) {
    const header = cell === null || cell === undefined ? '' : String(cell).trim();
    if (header === '') {
      return;
    }
    const normalized = normalizeHeader_(header);
    if (Object.prototype.hasOwnProperty.call(firstPositionByNormalized, normalized)) {
      errors.push(
        'El encabezado "' + header + '" aparece más de una vez (columnas ' +
          (firstPositionByNormalized[normalized] + 1) + ' y ' + (index + 1) +
          '). Cada encabezado debe ser único.'
      );
      return;
    }
    firstPositionByNormalized[normalized] = index;
    byName[header] = index;

    known.forEach(function (item) {
      if (header === item.name) {
        columns[item.key] = index;
      } else if (normalized === normalizeHeader_(item.name)) {
        ambiguousKeys[item.key] = true;
        errors.push(
          'El encabezado "' + header + '" es ambiguo: se parece a "' + item.name +
            '" pero no coincide exactamente. Corregí la capitalización o los espacios.'
        );
      }
    });
  });

  known.forEach(function (item) {
    if (item.required && columns[item.key] === MISSING_COLUMN && !ambiguousKeys[item.key]) {
      errors.push('Falta el encabezado requerido "' + item.name + '" en la fila 1.');
    }
  });

  return { ok: errors.length === 0, columns: columns, byName: byName, errors: errors };
}

function cellText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * Clasifica las filas de datos de `readSheet` (`values`, `hiddenByUser`,
 * `hiddenByFilter`; índice 0 = encabezados) con las columnas de `mapHeaders_`.
 *
 * Devuelve `{ eligible: [{ rowNumber, values }], excluded: [{ rowNumber, reason }], blankRows }`.
 * `rowNumber` es 1-based (la fila 2 es el primer dato). Una fila con todas sus
 * celdas vacías no se lista y se cuenta en `blankRows`. Cada fila excluida
 * lleva un solo motivo, el primero que aplica en este orden: oculta por el
 * usuario, oculta por un filtro, estado no vacío (cualquier valor) y
 * `Scheduled Date` con valor (solo si esa columna existe). Solo una fila
 * visible con estado vacío es elegible (R-06, D-03).
 */
function classifyRows_(sheetData, columns) {
  const values = sheetData.values || [];
  const hiddenByUser = sheetData.hiddenByUser || [];
  const hiddenByFilter = sheetData.hiddenByFilter || [];
  const eligible = [];
  const excluded = [];
  let blankRows = 0;

  for (let i = 1; i < values.length; i++) {
    const rowValues = values[i] || [];
    const rowNumber = i + 1;
    const isBlank = rowValues.every(function (value) {
      return cellText_(value) === '';
    });
    if (isBlank) {
      blankRows++;
      continue;
    }

    const status = cellText_(rowValues[columns.status]);
    let reason = '';
    if (hiddenByUser[i]) {
      reason = 'oculta por el usuario';
    } else if (hiddenByFilter[i]) {
      reason = 'oculta por un filtro';
    } else if (status !== '') {
      reason = 'estado: ' + status;
    } else if (columns.scheduled !== MISSING_COLUMN && cellText_(rowValues[columns.scheduled]) !== '') {
      reason = 'Scheduled Date con valor';
    }

    if (reason) {
      excluded.push({ rowNumber: rowNumber, reason: reason });
    } else {
      eligible.push({ rowNumber: rowNumber, values: rowValues.slice() });
    }
  }

  return { eligible: eligible, excluded: excluded, blankRows: blankRows };
}

/**
 * Valida una única dirección de correo (AC-13). Rechaza espacios, comas,
 * punto y coma, `<`, `>`, comillas, paréntesis y CR/LF (que permitirían varios
 * destinatarios o inyección de encabezados) y direcciones de más de 254
 * caracteres. No recorta: un valor con espacios alrededor es inválido.
 */
function isValidEmail_(value) {
  if (typeof value !== 'string' || value === '' || value.length > 254) {
    return false;
  }
  if (/[\r\n]/.test(value)) {
    return false;
  }
  return /^[^\s@<>(),;:"]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value);
}

/**
 * Clave de identidad de una fila (D-14): el JSON de todos sus valores
 * mostrados. Cualquier cambio en una celda produce otra clave.
 */
function rowKey_(values) {
  return JSON.stringify(values);
}
