/**
 * Lógica pura sobre los datos de la hoja: encabezados, elegibilidad de filas,
 * validación de destinatarios y claves de fila. No accede a servicios de Google.
 */

// Índice que indica que una columna opcional no existe en la hoja.
const MISSING_COLUMN = -1;

// Error global cuando la pestaña todavía tiene encabezados de la V1 (D-31).
const LEGACY_HEADERS_ERROR_ = 'La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"';

// Normaliza un encabezado para detectar duplicados y variantes ambiguas:
// compone los caracteres en forma NFC (una `ñ` escrita como `n` + tilde
// combinante equivale a `ñ`), recorta, colapsa espacios internos y pasa a
// minúsculas.
function normalizeHeader_(value) {
  return String(value).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Mapea la fila de encabezados (fila 1) a índices de columna 0-based.
 *
 * Devuelve `{ ok, columns: { email, attachments, date, campaign, result, detail },
 * byName, errors, legacy: { status, scheduled } }`. Requeridos: `Email Address`
 * y las cuatro columnas gestionadas (`Fecha`, `Campaña`, `Resultado`,
 * `Detalle`, D-31); `File Attachments` es opcional. Una columna ausente vale
 * `MISSING_COLUMN` (-1). Si aparece un encabezado heredado (`Mail Merge Status`
 * o `Scheduled Date`) se informa un único error que remite a "Preparar
 * columnas" y su índice queda en `legacy`.
 * Falla cerrado (AC-12): un encabezado requerido ausente, un encabezado
 * repetido (comparando en forma normalizada) o un encabezado conocido (los seis
 * de `HEADERS` y los dos de `LEGACY_HEADERS`) escrito con otra capitalización,
 * espaciado o composición Unicode son errores; nunca se adivina cuál es la
 * columna correcta. Las celdas de encabezado vacías se ignoran.
 */
function mapHeaders_(headerRow) {
  const known = [
    { key: 'email', name: HEADERS.EMAIL, required: true },
    { key: 'attachments', name: HEADERS.ATTACHMENTS, required: false },
    { key: 'date', name: HEADERS.DATE, required: true },
    { key: 'campaign', name: HEADERS.CAMPAIGN, required: true },
    { key: 'result', name: HEADERS.RESULT, required: true },
    { key: 'detail', name: HEADERS.DETAIL, required: true },
    { key: 'status', name: LEGACY_HEADERS.STATUS, legacy: true },
    { key: 'scheduled', name: LEGACY_HEADERS.SCHEDULED, legacy: true },
  ];
  const columns = {
    email: MISSING_COLUMN,
    attachments: MISSING_COLUMN,
    date: MISSING_COLUMN,
    campaign: MISSING_COLUMN,
    result: MISSING_COLUMN,
    detail: MISSING_COLUMN,
  };
  const legacy = { status: MISSING_COLUMN, scheduled: MISSING_COLUMN };
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
        if (item.legacy) {
          legacy[item.key] = index;
        } else {
          columns[item.key] = index;
        }
      } else if (normalized === normalizeHeader_(item.name)) {
        ambiguousKeys[item.key] = true;
        errors.push(
          'El encabezado "' + header + '" es ambiguo: se parece a "' + item.name +
            '" pero no coincide exactamente. Corregí la capitalización o los espacios.'
        );
      }
    });
  });

  if (legacy.status !== MISSING_COLUMN || legacy.scheduled !== MISSING_COLUMN) {
    errors.push(LEGACY_HEADERS_ERROR_);
  }

  known.forEach(function (item) {
    if (item.required && columns[item.key] === MISSING_COLUMN && !ambiguousKeys[item.key]) {
      errors.push('Falta el encabezado requerido "' + item.name + '" en la fila 1.');
    }
  });

  return { ok: errors.length === 0, columns: columns, byName: byName, errors: errors, legacy: legacy };
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
 * usuario, oculta por un filtro y `Resultado` no vacío (cualquier valor).
 * Solo una fila visible con `Resultado` vacío es elegible (R-06, D-31): las
 * demás columnas gestionadas, como `Fecha`, no deciden la elegibilidad.
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

    const result = cellText_(rowValues[columns.result]);
    let reason = '';
    if (hiddenByUser[i]) {
      reason = 'oculta por el usuario';
    } else if (hiddenByFilter[i]) {
      reason = 'oculta por un filtro';
    } else if (result !== '') {
      reason = 'resultado: ' + result;
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

// Índice utilizable de una columna de `mapHeaders_` dentro de una fila, o
// `MISSING_COLUMN` si la columna no existe o la fila es más corta.
function presentColumn_(values, index) {
  return typeof index === 'number' && index >= 0 && index < values.length ? index : MISSING_COLUMN;
}

/**
 * Clave de identidad de una fila (D-36, modifica D-14): el JSON de sus valores
 * mostrados con `Fecha`, `Campaña` y `Detalle` reemplazados por `''` cuando
 * esas columnas existen. El script escribe esas tres columnas durante el envío,
 * así que no forman parte de la identidad; `Resultado` y cualquier otra celda
 * sí: un cambio en ellas produce otra clave. No muta `values`.
 */
function rowKey_(values, columns) {
  const copy = (values || []).slice();
  const managed = columns || {};
  [managed.date, managed.campaign, managed.detail].forEach(function (index) {
    if (presentColumn_(copy, index) !== MISSING_COLUMN) {
      copy[index] = '';
    }
  });
  return JSON.stringify(copy);
}

/**
 * Clave de metadatos de una fila (D-48): el JSON de los valores mostrados de
 * `[Fecha, Campaña, Detalle]`, con `''` si la columna no existe o el valor
 * falta. Es la base de la huella que detecta si esos valores cambiaron después
 * de la confirmación; no depende de `Resultado` ni de ninguna otra columna.
 */
function metaKey_(values, columns) {
  const row = values || [];
  const managed = columns || {};
  return JSON.stringify(
    [managed.date, managed.campaign, managed.detail].map(function (index) {
      if (presentColumn_(row, index) === MISSING_COLUMN) {
        return '';
      }
      const value = row[index];
      return value === null || value === undefined ? '' : value;
    })
  );
}
