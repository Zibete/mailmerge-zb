/**
 * Lógica pura sobre los datos de la hoja: encabezados, elegibilidad de filas,
 * validación de destinatarios y claves de fila. No accede a servicios de Google.
 */

// Índice que indica que una columna opcional no existe en la hoja.
const MISSING_COLUMN = -1;

// Error global cuando la pestaña todavía tiene encabezados de la V1 (D-31).
const LEGACY_HEADERS_ERROR_ = 'La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"';

// Comienzo del error de encabezado requerido ausente. `planColumnSetup_` lo
// usa para separar las columnas faltantes (que la migración agrega) de los
// duplicados y ambigüedades (que la bloquean).
const MISSING_HEADER_ERROR_PREFIX_ = 'Falta el encabezado requerido "';

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
      errors.push(MISSING_HEADER_ERROR_PREFIX_ + item.name + '" en la fila 1.');
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

// Cantidad de filas que nombran los errores de la migración antes de
// `y N filas más` (D-34).
const SETUP_ROW_LIST_LIMIT_ = 20;

// `fila 4` o `filas 2, 3, 5`, hasta `SETUP_ROW_LIST_LIMIT_` números y luego
// `y N filas más`.
function describeSetupRows_(rowNumbers) {
  const shown = rowNumbers.slice(0, SETUP_ROW_LIST_LIMIT_).join(', ');
  const more = rowNumbers.length - SETUP_ROW_LIST_LIMIT_;
  return (rowNumbers.length === 1 ? 'fila ' : 'filas ') + shown + (more > 0 ? ' y ' + more + ' filas más' : '');
}

// Números de fila (1-based) de los datos, incluidas las ocultas, que cumplen
// `predicate(rowValues)`, en orden ascendente.
function findSetupRows_(values, predicate) {
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (predicate(values[i] || [])) {
      rows.push(i + 1);
    }
  }
  return rows;
}

/**
 * Plan de "Preparar columnas" (D-33, D-34), sin efectos. Recibe el objeto de
 * `readSheet` y devuelve `ColumnSetupPlan = { needed, headerKey, renames:
 * [{ column, from, to }], appends: [{ column, name }], errors, blockedRows }`.
 *
 * - `headerKey` es el JSON de la fila de encabezados, para el compare-and-set
 *   de `applyColumnSetup_`.
 * - `needed` es `true` si hay encabezados heredados o falta alguna columna
 *   gestionada. Si no (la hoja cumple `mapHeaders_` V2, o solo le falta
 *   `Email Address`, que la migración no crea), no hay nada que hacer y no se
 *   evalúan bloqueos: la hoja completa la cubre D-47.
 * - Renombres en el lugar, en este orden: `Mail Merge Status` → `Resultado` y
 *   `Scheduled Date` → `Fecha`. Agregados: las gestionadas que falten, en el
 *   orden de `MANAGED_HEADERS` (`Resultado` primero), desde la primera columna
 *   a la derecha de la fila más larga de `values`.
 * - Falla cerrado: un encabezado duplicado o ambiguo, o cualquiera de los
 *   bloqueos (a) a (e) de D-34 (evaluados sobre todas las filas, también las
 *   ocultas; (e) también cuando la hoja todavía tiene `Scheduled Date`), deja
 *   el error en `errors` y el plan sin renombres ni agregados.
 *   `blockedRows` reúne las filas de (c) y (e), ascendente y sin duplicados.
 */
function planColumnSetup_(sheetData) {
  const values = (sheetData && sheetData.values) || [];
  const headerRow = values[0] || [];
  const plan = {
    needed: false,
    headerKey: JSON.stringify(headerRow),
    renames: [],
    appends: [],
    errors: [],
    blockedRows: [],
  };

  const mapping = mapHeaders_(headerRow);
  const columns = mapping.columns;
  const legacy = mapping.legacy;
  const has = function (index) {
    return index !== MISSING_COLUMN;
  };
  const hasLegacy = has(legacy.status) || has(legacy.scheduled);
  const missingManaged = !has(columns.result) || !has(columns.date) || !has(columns.campaign) || !has(columns.detail);
  if (mapping.ok || (!hasLegacy && !missingManaged)) {
    return plan;
  }
  plan.needed = true;

  // Duplicados y ambigüedades: nunca se adivina qué columna es cuál.
  const conflicts = mapping.errors.filter(function (error) {
    return error !== LEGACY_HEADERS_ERROR_ && error.indexOf(MISSING_HEADER_ERROR_PREFIX_) !== 0;
  });
  if (conflicts.length > 0) {
    plan.errors = conflicts;
    return plan;
  }

  const blocked = {};
  // Sugerencia de nuevo nombre para una columna propia del operador.
  const renameHint = function (name) {
    return ' (por ejemplo "' + name + ' original", actualizando el borrador si la usa)';
  };
  const ownManaged = [
    [columns.date, HEADERS.DATE],
    [columns.campaign, HEADERS.CAMPAIGN],
    [columns.detail, HEADERS.DETAIL],
  ].filter(function (pair) {
    return has(pair[0]);
  });

  // (a) Un encabezado heredado convive con su reemplazo.
  if (has(legacy.status) && has(columns.result)) {
    plan.errors.push(
      'La pestaña tiene a la vez "' + LEGACY_HEADERS.STATUS + '" y "' + HEADERS.RESULT +
        '"; dejá una sola de las dos columnas y volvé a validar.'
    );
  }
  if (has(legacy.scheduled) && has(columns.date)) {
    plan.errors.push(
      'La pestaña tiene a la vez "' + LEGACY_HEADERS.SCHEDULED + '" y "' + HEADERS.DATE +
        '"; dejá una sola de las dos columnas y volvé a validar.'
    );
  }

  // (b) Hoja V1 con una columna Fecha, Campaña o Detalle que no proviene del
  // renombre: probablemente datos del operador.
  if (has(legacy.status)) {
    ownManaged.forEach(function (pair) {
      plan.errors.push(
        'La pestaña todavía tiene "' + LEGACY_HEADERS.STATUS + '" y ya tiene una columna "' + pair[1] +
          '" propia, que Mail Merge escribiría. Renombrala' + renameHint(pair[1]) + ' y volvé a validar.'
      );
    });
  }

  // (c) `Scheduled Date` con valor y la columna de estado vigente vacía
  // (`Mail Merge Status`, o `Resultado` si ese renombre ya se aplicó): al
  // migrar, esas filas pasarían a ser enviables.
  if (has(legacy.scheduled)) {
    const statusColumn = has(legacy.status) ? legacy.status : columns.result;
    const statusName = has(legacy.status) ? LEGACY_HEADERS.STATUS : HEADERS.RESULT;
    const rows = findSetupRows_(values, function (row) {
      const status = has(statusColumn) ? cellText_(row[statusColumn]) : '';
      return cellText_(row[legacy.scheduled]) !== '' && status === '';
    });
    if (rows.length > 0) {
      rows.forEach(function (rowNumber) {
        blocked[rowNumber] = true;
      });
      plan.errors.push(
        'Hay filas con "' + LEGACY_HEADERS.SCHEDULED + '" con valor y "' + statusName + '" vacío (' +
          describeSetupRows_(rows) + '): al preparar las columnas quedarían habilitadas para el envío. ' +
          'Vaciá "' + LEGACY_HEADERS.SCHEDULED + '" si querés enviarlas o escribí ' + STATUS.SKIP +
          ' en "' + statusName + '".'
      );
    }
  }

  // (d) Sin heredadas ni `Resultado`, con alguna de Fecha, Campaña o Detalle:
  // ninguna migración interrumpida deja esas columnas sin `Resultado`.
  if (!hasLegacy && !has(columns.result)) {
    ownManaged.forEach(function (pair) {
      plan.errors.push(
        'La pestaña ya tiene una columna "' + pair[1] + '" propia y no tiene "' + HEADERS.RESULT +
          '"; Mail Merge la escribiría. Renombrala' + renameHint(pair[1]) + ' y volvé a validar.'
      );
    });
  }

  // (e) Sin `Mail Merge Status` y, o bien sin heredadas y con `Resultado`, o
  // bien todavía con `Scheduled Date` (con `Resultado`, en un estado parcial,
  // o sin columna de estado): una Fecha, Campaña o Detalle presente con valor
  // en filas sin estado se reemplazaría al enviar. Mientras exista
  // `Scheduled Date`, ninguna de esas columnas puede venir de la migración (los
  // agregados se escriben después de los renombres), así que la reanudación no
  // cae en esta regla. Sin columna de estado, todas las filas cuentan como sin
  // estado.
  if (!has(legacy.status) && (has(legacy.scheduled) || has(columns.result))) {
    const withoutStatus = has(columns.result)
      ? 'filas con "' + HEADERS.RESULT + '" vacío'
      : 'filas sin estado (la pestaña todavía no tiene "' + HEADERS.RESULT + '")';
    ownManaged.forEach(function (pair) {
      const rows = findSetupRows_(values, function (row) {
        const status = has(columns.result) ? cellText_(row[columns.result]) : '';
        return cellText_(row[pair[0]]) !== '' && status === '';
      });
      if (rows.length > 0) {
        rows.forEach(function (rowNumber) {
          blocked[rowNumber] = true;
        });
        plan.errors.push(
          'La columna "' + pair[1] + '" tiene valores en ' + withoutStatus + ' (' +
            describeSetupRows_(rows) + '); Mail Merge los reemplazaría al enviar. Renombrá la columna' +
            renameHint(pair[1]) + ' o vaciá esas celdas si no tienen datos que conservar.'
        );
      }
    });
  }

  plan.blockedRows = Object.keys(blocked)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });
  if (plan.errors.length > 0) {
    return plan;
  }

  // Renombres en el orden de D-33: el de estado primero.
  if (has(legacy.status)) {
    plan.renames.push({ column: legacy.status, from: LEGACY_HEADERS.STATUS, to: HEADERS.RESULT });
  }
  if (has(legacy.scheduled)) {
    plan.renames.push({ column: legacy.scheduled, from: LEGACY_HEADERS.SCHEDULED, to: HEADERS.DATE });
  }

  // Agregados a la derecha de la última columna con contenido en cualquier fila.
  const present = {};
  present[HEADERS.RESULT] = has(columns.result) || has(legacy.status);
  present[HEADERS.DATE] = has(columns.date) || has(legacy.scheduled);
  present[HEADERS.CAMPAIGN] = has(columns.campaign);
  present[HEADERS.DETAIL] = has(columns.detail);
  let next = values.reduce(function (width, row) {
    return Math.max(width, (row || []).length);
  }, 0);
  MANAGED_HEADERS.forEach(function (name) {
    if (!present[name]) {
      plan.appends.push({ column: next, name: name });
      next++;
    }
  });

  return plan;
}
