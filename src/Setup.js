/**
 * "Preparar columnas" (D-33, D-34): migración explícita y reanudable de los
 * encabezados de la pestaña de la campaña. Solo escribe celdas de la fila 1,
 * bajo el lock y con compare-and-set sobre la fila de encabezados que vio el
 * operador al validar. Validar nunca migra.
 */

/**
 * Aplica el plan de columnas de la pestaña configurada.
 *
 * Devuelve `{ ok, errors, applied: { renames, appends } }`. Sin escrituras si
 * la configuración está incompleta (sin tomar el lock), si el lock no está
 * disponible, si la fila de encabezados no es la de `expectedHeaderKey`, si
 * el plan tiene errores (D-34) o si no hace falta preparar nada. Las celdas
 * se escriben en una sola llamada, en el orden de D-33 (`Resultado` primero,
 * renombrado o agregado; luego `Scheduled Date` → `Fecha` y el resto de los
 * agregados), para que toda ejecución interrumpida se pueda repetir sin caer
 * en D-34.
 */
function applyColumnSetup_(deps, expectedHeaderKey) {
  const applied = { renames: [], appends: [] };
  const config = deps.props.getConfig();
  if (!isCompleteConfig_(config)) {
    return {
      ok: false,
      errors: ['La configuración de la campaña está incompleta; completala en la sección "Campaña" del panel'],
      applied: applied,
    };
  }
  if (!deps.lock.tryLock(LIMITS.LOCK_WAIT_MS)) {
    return { ok: false, errors: ['Hay otra ejecución en curso; reintentá en unos minutos'], applied: applied };
  }
  try {
    let sheet = null;
    try {
      sheet = deps.sheets.readSheet(config.sheetId);
    } catch (e) {
      return {
        ok: false,
        errors: ['La pestaña configurada ya no existe; volvé a configurar la campaña'],
        applied: applied,
      };
    }
    const plan = planColumnSetup_(sheet);
    if (plan.headerKey !== expectedHeaderKey) {
      return { ok: false, errors: ['La fila de encabezados cambió; volvé a validar'], applied: applied };
    }
    if (plan.errors.length > 0) {
      return { ok: false, errors: plan.errors.slice(), applied: applied };
    }
    if (!plan.needed) {
      return { ok: true, errors: [], applied: applied };
    }

    const planned = plan.renames
      .map(function (rename) {
        return { column: rename.column, value: rename.to };
      })
      .concat(
        plan.appends.map(function (append) {
          return { column: append.column, value: append.name };
        })
      );
    // `Resultado` (renombrado o agregado) siempre es la primera escritura: en
    // una hoja con `Scheduled Date` y sin columna de estado, escribir antes
    // `Fecha` dejaría tras una interrupción una `Fecha` sin `Resultado`, que
    // D-34 (d) bloquea y la operación ya no se podría repetir (D-33).
    const isResult = function (cell) {
      return cell.value === HEADERS.RESULT;
    };
    const cells = planned.filter(isResult).concat(
      planned.filter(function (cell) {
        return !isResult(cell);
      })
    );
    try {
      deps.sheets.writeHeaderCells(config.sheetId, cells);
    } catch (e) {
      return {
        ok: false,
        errors: [
          'No se pudieron preparar todas las columnas; revisá la fila 1 y volvé a intentar (la operación se puede repetir)',
        ],
        applied: applied,
      };
    }
    return { ok: true, errors: [], applied: { renames: plan.renames, appends: plan.appends } };
  } finally {
    deps.lock.release();
  }
}
