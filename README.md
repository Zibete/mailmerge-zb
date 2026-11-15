# Mail Merge ZB

Herramienta pequeña de **combinación de correspondencia** en **Google Apps Script V8**: envía mensajes personalizados desde una hoja de cálculo de Google Sheets, usando un borrador de Gmail como plantilla y adjuntos de Google Drive. Reproduce el flujo esencial de un complemento de Mail Merge, sin convertirse en una plataforma de marketing. Se instala como **script vinculado** a tu propia hoja (no es un complemento de Marketplace).

## Identidad del producto

Dentro del panel lateral el producto se presenta como **Mail Merge ZB — Envío desde Google Sheets**: un panel oscuro de 300 px con un riel de etapas y cuatro pasos (campaña, validación, prueba y envío). Por fuera nada cambia: el menú de Sheets sigue siendo **Mail Merge → Abrir Mail Merge**, el título del panel es `Mail Merge` y el archivo es `src/Sidebar.html`. El diseño está en [`plans/2026-11-14_eclipse-console-ui.md`](plans/2026-11-14_eclipse-console-ui.md) (D-49 a D-60).

## Estado

| Aspecto | Estado |
|---|---|
| Implementación de V2 | **Completada** según `plans/2026-11-09_mail-merge-v2.md`, en commits locales (sobre la V1 de `plans/2026-11-08_mail-merge-v1.md`) |
| Interfaz del panel (rediseño interno «Eclipse Console») | **Implementada** según `plans/2026-11-14_eclipse-console-ui.md` (criterios AC-56 a AC-63 con tests offline sobre un DOM falso; AC-64, aceptación visual completa del responsable, queda `PENDING (manual)` (smoke test automatizado de nueve estados en Chromium aprobado)) |
| Tests offline (lógica y adaptadores simulados) | **380/380 aprobados** el 2026-11-15 (Node.js v22, mocks y tests de la vista previa); ejecutar `node --test` para verificar en tu equipo |
| Integración con Apps Script, Gmail y Drive | **Piloto real reportado por el responsable; checklist integral pendiente** |
| Instalación, OAuth y envíos reales | **`clasp push` y envíos reales reportados por el responsable (2026-11-15); resultados de la checklist de aceptación aún por registrar** |

**Nivel alcanzado: `LOCAL_VERIFIED`, no `LIVE_VERIFIED`.** Los tests offline no reemplazan una prueba real en Google. El responsable confirmó haber visto el panel actualizado en Sheets y realizado envíos reales; siguen pendientes las comprobaciones detalladas de los ítems 22 a 26 (especialmente lectores de pantalla, lista de 500 filas y render en diferentes condiciones). La evidencia por criterio está en [`docs/ACCEPTANCE_STATUS.md`](docs/ACCEPTANCE_STATUS.md).

## Qué hace

Todo se maneja desde un **panel lateral**: menú **Mail Merge → Abrir Mail Merge**. No hay diálogos emergentes ni pestaña de registro aparte.

- **Configurar campaña:** pestaña de destinatarios, borrador de Gmail, remitente (cuenta propia o alias autorizado), Reply-To opcional y nombre de campaña opcional (si queda vacío, cada envío genera un ID).
- **Personalizar:** marcadores `{{Encabezado}}` en asunto y cuerpo, conservando el HTML y las imágenes inline del borrador.
- **Adjuntar:** adjuntos comunes del borrador y enlaces de Drive por fila en `File Attachments`, separados por comas. Documentos, hojas y presentaciones de Google se exportan a PDF.
- **Validar sin enviar:** un radar con elegibles, filas con errores, excluidas y cuota diaria, con la lista de todas las filas a enviar (destinatario y nombres de adjuntos, sin URLs).
- **Preparar columnas:** agrega las columnas gestionadas que falten y migra una hoja de la V1 (`Mail Merge Status` → `Resultado`, `Scheduled Date` → `Fecha`) sin mover datos, o se bloquea si eso pondría en riesgo datos del operador.
- **Enviar una prueba:** el mensaje de una fila a la cuenta del operador, con asunto `[PRUEBA]`. La fila queda con `Resultado = Email Sent`: para enviarle el correo al destinatario real hay que borrar ese resultado a mano.
- **Enviar pendientes:** revisión segura con confirmación explícita en el panel (de un solo uso y con vencimiento a una hora fija), reconocimiento obligatorio de que las vistas de filtro no excluyen destinatarios, consentimiento cuando se reemplazan valores de `Fecha`, `Campaña` o `Detalle`, lock contra ejecuciones simultáneas, revalidación de filas y adjuntos, consola con progreso en vivo y resultado por fila, y ayudas contextuales, sin reintentos automáticos ante resultados dudosos.

## Hoja y estados

La fila 1 contiene los encabezados. Se respetan los literales `Email Address` (obligatorio), `File Attachments` (opcional) y las cuatro columnas gestionadas, obligatorias: `Fecha`, `Campaña`, `Resultado` y `Detalle`. `Mail Merge Status` y `Scheduled Date` son encabezados heredados que solo reconoce "Preparar columnas".

| `Resultado` | Significado |
|---|---|
| Vacío | Pendiente, sujeto a validación |
| `SKIP` | Excluida por el operador |
| `Email Sent` | Gmail aceptó el envío (o la prueba, ver `Detalle`); **no acredita entrega** |
| `ENVIANDO` | Resultado incierto: revisar manualmente |
| `REVISAR` | Requiere conciliación manual antes de cualquier reintento |

## Límites

- Las filas ocultas manualmente o mediante **filtros normales** y las filas con cualquier `Resultado` no vacío no se envían. **Las vistas de filtro no restringen los destinatarios:** hay que revisar la lista completa y aceptar esa limitación para habilitar el envío real.
- Hasta 500 filas por confirmación (envío por tandas), 20 MB de adjuntos por correo y 4,5 minutos por ejecución; la cuota diaria de Gmail depende de la cuenta.
- Sin servidores, aplicación web, base de datos externa, CRM, seguimiento de aperturas, programación de campañas, respuestas automáticas ni reintentos automáticos de envíos dudosos.
- Sin dependencias de terceros: Apps Script V8 y Node.js solo para los tests locales.

El uso detallado, la conciliación, el envío por tandas y los límites configurables están en [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Instalación (script vinculado)

La herramienta es un **script vinculado a una hoja**: cada persona instala su propia copia en su hoja y autoriza su propia cuenta. **No es un complemento de Marketplace** y no se publica ni se instala desde ahí. **El responsable ya realizó una instalación y envíos reales, pero no está cerrada la checklist integral de validación en Google.** Antes de instalarla, usá una hoja y una cuenta de prueba, y recorré el checklist `PENDING LIVE VALIDATION` de [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

**Opción A: editor de Apps Script**

1. Abrí la hoja de prueba y elegí `Extensiones → Apps Script`.
2. Creá un archivo de script por cada `src/*.js` y un archivo HTML llamado `Sidebar` con el contenido de `src/Sidebar.html`, con el mismo nombre que el original (sin la extensión que agrega el editor).
3. En la configuración del proyecto activá `Show "appsscript.json" manifest file in editor` y reemplazá su contenido por `src/appsscript.json`.
4. Guardá, recargá la hoja y elegí `Mail Merge → Abrir Mail Merge`.

**Opción B: `clasp` (instrucciones para una nueva instalación)**

Requiere `clasp` instalado y la Apps Script API habilitada para tu usuario. El responsable informó haber usado `clasp push` en su instalación; los siguientes comandos son ejemplos para instalar una nueva copia y deben contrastarse con la versión de `clasp` utilizada:

```bash
clasp login
clasp create-script --parentId <id de la hoja> --rootDir src   # o: clasp clone-script <scriptId> --rootDir src
clasp push
```

- `--parentId` vincula el script a la hoja existente; `--type sheets` crearía una hoja nueva. Los nombres anteriores `create` y `clone` figuran como alias a confirmar contra la documentación vigente.
- `.clasp.json` y `.clasprc.json` (ID del script y credenciales locales) están ignorados por Git: no los subas.

**Consentimiento y scopes.** La primera ejecución pide autorizar los scopes de `src/appsscript.json`, entre ellos `https://mail.google.com/` y `https://www.googleapis.com/auth/drive.readonly`, que dan acceso amplio al buzón y a la lectura de todo el Drive. Se aceptaron como riesgo solo para el desarrollo local (D-24): antes de cualquier uso real hace falta la autorización explícita del responsable.

## Vista previa local

`tools/preview-sidebar.js` permite ver el panel en un navegador **sin Google**: lee `src/Sidebar.html`, le agrega un `google.script.run` falso con datos ficticios (`example.test`) y escribe `tmp/sidebar-preview.html` (carpeta ignorada por Git). Con Node.js portable (ver abajo):

```bash
node tools/preview-sidebar.js [estado]
```

Estados: `inicial`, `sin-borradores`, `configurada`, `setup`, `bloqueada`, `lista`, `prueba`, `envio`, `consentimiento`, `enviando`, `terminada`, `revisar`, `incierta` y `lista-500` (500 filas). El simulador respeta los bloqueos globales: `bloqueada` y `setup` sin preparar columnas no permiten obtener una confirmación ficticia válida. Se abre `tmp/sidebar-preview.html` en Chrome o Edge y se cambia de estado con la barra o con `?state=<estado>`; el panel mide 300 px. La checklist visual está en `docs/OPERATIONS.md`. **No valida lo que `HtmlService` ignora o reescribe ni reemplaza la validación en vivo**. El responsable aprobó visualmente la interfaz y la probó en Sheets, pero AC-64 no se considera cerrada hasta registrar los resultados de toda su checklist (incluidas las 500 filas y la navegación por teclado). No hay capturas en el repositorio; cuando existan, se guardarán en `docs/screenshots/`.

## Estructura

```text
mailmerge_sdd_local/
├── AGENTS.md            # Contrato de ingeniería (reglas del proyecto)
├── CLAUDE.md            # Instrucciones específicas para Claude Code
├── LICENSE              # Licencia MIT
├── src/                 # Código Apps Script V8, Sidebar.html y appsscript.json (manifest y scopes)
│   ├── Setup.js         #   "Preparar columnas" (migración de encabezados)
│   ├── Confirmation.js  #   Confirmación por token y registro de progreso en caché
│   ├── Sidebar.html     #   Panel Mail Merge ZB (HTML, CSS y JavaScript)
│   └── …                #   Config, Sheet, Preflight, Template, Attachments, Send, Services, Ui
├── tools/               # preview-sidebar.js: vista previa local de la sidebar (manual, sin Google)
├── tests/               # Tests offline, servicios simulados y DOM falso de la sidebar
│   ├── fixtures/sidebar-views.js   # Vistas ficticias de la sidebar (también para la vista previa)
│   ├── sidebar-console.test.js     # Tests de Eclipse Console (AC-56 a AC-62)
│   └── preview-sidebar.test.js     # Regresión del simulador local
├── plans/               # Planes implementados: V1, V2 y Eclipse Console
└── docs/
    ├── OPERATIONS.md         # Guía de operación, checklist del piloto y checklist visual
    ├── ACCEPTANCE_STATUS.md  # Estado de criterios de aceptación y tests
    └── DECISIONS.md          # Decisiones aprobadas y riesgos
```

Los documentos iniciales de `docs/` (`REQUIREMENTS_DRAFT.md`, `ACCEPTANCE.md`, `REFERENCE_AUDIT.md` y `ENGINEERING_PLAYBOOK.md`) se conservan como trazabilidad histórica, no como instrucciones para volver a implementar V1. Se retiró el prompt de arranque obsoleto.

## Verificación local (Windows)

Sin dependencias de npm ni servicios externos. Requiere **Node.js 20 o superior** y se ejecuta desde la raíz del repositorio. Si `node` ya está disponible en el `PATH`, el comando es igual en Git Bash y PowerShell:

```bash
node --test
```

Si usás una versión portable de Node.js en Windows, agregá temporalmente **el directorio que contiene `node.exe`** al `PATH` de la sesión (reemplazá las rutas de ejemplo):

**Git Bash**

```bash
export PATH="/ruta/a/node:$PATH"
node --test
```

**PowerShell**

```powershell
$env:Path = "C:\ruta\a\node;$env:Path"
node --test
```

Controles adicionales: `node --check <archivo.js>` (incluido `tools/preview-sidebar.js`), `git diff --check`, `git status --short` y `git remote -v` (debe estar vacío).

## Validación en Google pendiente

El responsable confirmó una instalación mediante `clasp`, la visualización de la interfaz en Sheets y envíos reales el 2026-11-15. Estos son resultados de una prueba operativa informada, **no una certificación de todos los escenarios**. Falta documentar individualmente los controles pertinentes de [`docs/OPERATIONS.md`](docs/OPERATIONS.md), particularmente accesibilidad, grandes volúmenes, fallas y comportamiento de filtros. Los scopes de `src/appsscript.json` (sin cambios respecto de la V1) incluyen `https://mail.google.com/` y `drive.readonly`, de acceso amplio; toda nueva instalación necesita una revisión y autorización explícita de esos permisos. Para futuras pruebas, usar hoja, datos, archivos y destinatarios autorizados.

## Licencia

**MIT** — ver [`LICENSE`](LICENSE). Se permite usar, modificar y redistribuir el código respetando las condiciones de atribución y exención de garantías de la licencia. Las cuentas de Google, los permisos de acceso y las cuotas no están incluidos en esa autorización.

## Desarrollo

Las reglas de ingeniería (idioma, Git solo local, autorización para operaciones externas, seguridad y tests) están en [`AGENTS.md`](AGENTS.md); [`CLAUDE.md`](CLAUDE.md) agrega lo específico de Claude Code. Los cambios posteriores se tratan como mantenimiento acotado con `spec-driven-dev`, sin repetir los planes ejecutados.
