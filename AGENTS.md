# Contrato de ingeniería — Mail Merge

Fuente principal de las reglas de ingeniería del proyecto, para cualquier agente o persona que lo modifique.

## Estado del proyecto

- **V2 implementada y verificada localmente (`LOCAL_VERIFIED`)**: panel lateral único, columnas gestionadas `Fecha`, `Campaña`, `Resultado` y `Detalle`, "Preparar columnas" y confirmación por token. Código en `src/`, tests offline en `tests/`, plan ejecutado en `plans/2026-11-09_mail-merge-v2.md` (evoluciona la V1 de `plans/2026-11-08_mail-merge-v1.md`).
- **Interfaz Eclipse Console (2026-11-14)**: `plans/2026-11-14_eclipse-console-ui.md` es el diseño vigente de la interfaz de la sidebar (identidad, acordeón, radar, compuertas, consola y ayudas; D-49 a D-60) y reemplaza en lo visual la sección "Detalle del código > Sidebar" del plan V2. Sigue en `LOCAL_VERIFIED`: la vista previa local (`tools/preview-sidebar.js`) y el render real en Apps Script siguen pendientes de ejecución (AC-64 y ítems 22 a 26 de `docs/OPERATIONS.md`).
- **Pendiente en Google (`PENDING LIVE VALIDATION`)**: ni la V1 ni la V2 se instalaron, autorizaron ni ejecutaron en Apps Script, Gmail ni Drive. No declarar `LIVE_VERIFIED` sin resultados reales de los controles de `docs/OPERATIONS.md`.
- No repetir los planes ejecutados. El trabajo posterior es mantenimiento, auditoría, correcciones y preparación de un piloto controlado.
- Para el resultado actual de los tests, ejecutar la suite; `docs/ACCEPTANCE_STATUS.md` registra la evidencia del cierre de la V2.

## Idioma

Trabajo, documentación y comunicación en **español**: análisis, planes, documentación nueva o editada, interfaz, mensajes de error, comentarios del código y descripciones de commits. Se conservan sin traducir los identificadores técnicos (código, APIs, archivos, scopes, comandos, tipos de Conventional Commits) y los **literales de compatibilidad**: encabezados `Email Address`, `File Attachments`, `Fecha`, `Campaña`, `Resultado`, `Detalle` (D-31) y los heredados `Mail Merge Status` y `Scheduled Date`, que solo reconoce la migración ("Preparar columnas"); estados `SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR`; prefijo de prueba `[PRUEBA]` (reemplazan a `SENDING`, `REVIEW` y `[TEST]` de los insumos iniciales). Cambiar un literal requiere una modificación de contrato aprobada. Los documentos de investigación iniciales pueden quedar en inglés y no se traducen salvo pedido expreso.

## Objetivo, alcance y fuentes

- Mantener un mail merge **pequeño** sobre Google Sheets, borradores de Gmail, Drive y Apps Script V8: configurar campaña, validar, enviar una prueba, confirmar envíos pendientes y ver los resultados en las columnas `Resultado` y `Detalle` de la pestaña de la campaña.
- Sin servidores, aplicación web, bases de datos externas, CRM, tracking, automatización de marketing, programación de campañas, respuestas automáticas, rediseños de interfaz fuera de la especificación, reintentos automáticos de envíos dudosos, dependencias ni capas de arquitectura sin necesidad verificada.
- Fuentes vigentes: `docs/PRODUCT.md` (producto), `plans/2026-11-09_mail-merge-v2.md` (diseño implementado vigente), `plans/2026-11-14_eclipse-console-ui.md` (diseño vigente de la interfaz de la sidebar), `plans/2026-11-08_mail-merge-v1.md` (diseño V1, vigente salvo lo que la V2 reemplaza), `docs/DECISIONS.md` (decisiones), `docs/OPERATIONS.md` (operación), `docs/ACCEPTANCE_STATUS.md` (verificación).
- Insumos históricos, que no prevalecen sobre decisiones posteriores: `docs/REQUIREMENTS_DRAFT.md`, `docs/ACCEPTANCE.md` y `docs/ENGINEERING_PLAYBOOK.md`. `docs/REFERENCE_AUDIT.md` es investigación, no código para copiar. `PROMPT_CLAUDE_CODE.md` es el pedido de arranque: no ejecutarlo.

## Límite local y autorización (obligatorio)

- **Git exclusivamente local**: ramas y commits locales; sin remotos, push, PR, publicaciones ni releases.
- **Sin cuentas ni recursos reales de Google** por defecto: nada de `clasp login`/`push`/`deploy`/`run`, OAuth, envíos de correo (ni de prueba), cambios en Drive u otras acciones externas sin una **autorización explícita nueva** que delimite cuenta, hoja, destinatarios y acciones permitidas.
- Lectura de documentación pública permitida. No subir archivos del proyecto, datos reales ni secretos a terceros, ni modificar recursos externos.
- No editar archivos fuera del proyecto.
- Tests solo con datos ficticios y adaptadores simulados. Sin credenciales, tokens, IDs privados de scripts ni datos de clientes en el repositorio o en los registros.

## Invariantes de seguridad del código

- No enviar sin selección de campaña, validación, revisión por fila y confirmación explícita del operador.
- Un destinatario inválido, remitente no autorizado, marcador sin resolver o vacío, fila modificada o adjunto inaccesible o inválido **bloquea** ese envío. Nunca omitir en silencio un adjunto esperado.
- Respetar filas ocultas o filtradas, `SKIP` y cualquier `Resultado` no vacío: solo las filas con `Resultado` vacío entran al envío y a la prueba.
- La confirmación queda fuera del lock. Después de confirmar: tomar el lock, releer y revalidar cada fila, marcar `ENVIANDO` antes de llamar a Gmail y escribir `Email Sent` solo si Gmail aceptó el envío.
- `ENVIANDO` y `REVISAR` requieren conciliación manual; una interrupción o error nunca habilita un reenvío automático. `Email Sent` no garantiza entrega.
- Escapar valores en HTML, sanear cabeceras, validar enlaces, identidad y tamaño de adjuntos, neutralizar fórmulas en lo que el script escribe en la hoja y minimizar datos registrados y scopes OAuth. No modificar permisos de Drive.
- Mantener la lógica determinista separada de los adaptadores de Google; los tests corren sin red ni credenciales.

## Flujo de cambios (`spec-driven-dev`)

1. Antes de modificar: leer este contrato, `git status --short`, el código afectado y la documentación pertinente.
2. Clasificar el cambio. Las correcciones acotadas, los tests faltantes, los textos y la documentación van por `small-change`. Los cambios al flujo de envío, la elegibilidad, la máquina de estados, los adjuntos, los scopes o el manifest requieren un plan único en `plans/YYYY-MM-DD_<slug>.md` (`write-plan` / `implement-plan`), sin especificaciones paralelas. Seguir las instrucciones de la skill instalada; no inventar comandos.
3. Defectos: reproducir primero con un test que falle, aplicar el cambio mínimo y correr la suite. No modificar tests solo para que pasen.
4. Registrar en `docs/DECISIONS.md` las decisiones de alcance o de límite. Actualizar solo la documentación afectada (sobre todo `docs/OPERATIONS.md` y `docs/ACCEPTANCE_STATUS.md`).
5. Avanzar con autonomía dentro del alcance y del límite local. Escalar solo lo que cambie el comportamiento prometido, el contrato de seguridad o el acceso externo.

## Verificación

Node.js v20.11.1 portable, sin dependencias ni `npm install`; los comandos están en `README.md` ("Verificación local").

- Tests offline: `node --test` (archivos `*.test.js`). Los títulos de los tests conservan los IDs `R-xx`, `AC-xx` y `D-xx` para la trazabilidad con el plan y `docs/ACCEPTANCE_STATUS.md`.
- Sintaxis: `node --check` sobre cada `.js` modificado.
- Higiene: `git diff --check`, `git status --short` y `git remote -v` (vacío).

Al cerrar un cambio, informar archivos y commits, resultados reales de los comandos, criterios cubiertos, riesgos y lo que queda separado en **comprobado localmente**, **pendiente en Google** y **no probado**.

## Commits

- Conventional Commits con descripción en español: `tipo(alcance): descripción`. Tipos: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`. Un comportamiento o corrección por commit; cuerpo opcional con el porqué.
- Stage por nombre de archivo (nunca `git add -A` ni `git add .`); revisar `git diff --cached`; nunca `--no-verify`.
- Preservar el trabajo sin commitear: sin `reset`, `clean`, `checkout` destructivos ni operaciones forzadas.
