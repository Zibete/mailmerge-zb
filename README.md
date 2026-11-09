# Mail Merge V1 — Google Sheets, Gmail y Drive

Herramienta pequeña de **combinación de correspondencia** en **Google Apps Script V8**: envía mensajes personalizados desde una hoja de cálculo, usando un borrador de Gmail como plantilla y adjuntos de Google Drive. Reproduce el flujo esencial de un complemento de Mail Merge, sin convertirse en una plataforma de marketing.

## Estado

| Aspecto | Estado |
|---|---|
| Implementación de V1 | **Completada**: los seis pasos del plan están commiteados localmente |
| Tests offline (lógica y adaptadores simulados) | **153/153 aprobados** en la verificación de cierre; ejecutar `node --test` para el estado actual |
| Integración con Apps Script, Gmail y Drive | **`PENDING LIVE VALIDATION`** |
| Instalación, OAuth y envíos reales | **No realizados** |

**Nivel alcanzado: `LOCAL_VERIFIED`, no `LIVE_VERIFIED`.** Los tests offline no reemplazan una prueba real en Google. La evidencia por criterio está en [`docs/ACCEPTANCE_STATUS.md`](docs/ACCEPTANCE_STATUS.md).

## Qué hace

- **Configurar campaña:** pestaña de destinatarios, borrador de Gmail, remitente (cuenta propia o alias autorizado) y Reply-To opcional.
- **Personalizar:** marcadores `{{Encabezado}}` en asunto y cuerpo, conservando el HTML y las imágenes inline del borrador.
- **Adjuntar:** adjuntos comunes del borrador y enlaces de Drive por fila en `File Attachments`, separados por comas. Documentos, hojas y presentaciones de Google se exportan a PDF.
- **Validar sin enviar:** destinatarios, marcadores, adjuntos, tamaños, cuota, estados y filas ocultas o filtradas, con una revisión por fila (destinatario y nombres de adjuntos, sin URLs).
- **Enviar una prueba:** el mensaje de una fila a la cuenta del operador, con asunto `[PRUEBA]`, sin cambiar el estado.
- **Enviar pendientes:** confirmación explícita, lock contra ejecuciones simultáneas, revalidación de cada fila y estado por fila, sin reintentos automáticos ante resultados dudosos.
- **Registrar:** pestaña `Registro Mail Merge` con los resultados para conciliar, sin guardar el cuerpo del mensaje.

Menú en Google Sheets: **Mail Merge → Configurar campaña… / Validar / Enviar prueba… / Enviar pendientes… / Ver registro**.

## Hoja y estados

La fila 1 contiene los encabezados. Se respetan los literales `Email Address`, `File Attachments`, `Mail Merge Status` y `Scheduled Date` (opcional).

| `Mail Merge Status` | Significado |
|---|---|
| Vacío | Pendiente, sujeto a validación |
| `SKIP` | Excluida por el operador |
| `Email Sent` | Gmail aceptó el envío; **no acredita entrega** |
| `ENVIANDO` | Resultado incierto: revisar manualmente |
| `REVISAR` | Requiere conciliación manual antes de cualquier reintento |

Las filas ocultas o filtradas, con estado no vacío o con `Scheduled Date` informada no se envían. La herramienta no programa campañas, no rastrea aperturas ni reenvía resultados dudosos. El uso detallado, la conciliación y los límites configurables están en [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Estructura

```text
mailmerge_sdd_local/
├── AGENTS.md            # Contrato de ingeniería (reglas del proyecto)
├── CLAUDE.md            # Instrucciones específicas para Claude Code
├── src/                 # Código Apps Script V8, Sidebar.html y appsscript.json (manifest y scopes)
├── tests/               # Tests offline, fixtures y servicios simulados
├── plans/               # Plan implementado de V1
└── docs/
    ├── OPERATIONS.md         # Guía de operación y checklist del piloto
    ├── ACCEPTANCE_STATUS.md  # Estado de criterios de aceptación y tests
    └── DECISIONS.md          # Decisiones aprobadas y riesgos
```

Los demás archivos de `docs/` y `PROMPT_CLAUDE_CODE.md` son contexto inicial e investigación, no instrucciones para volver a implementar el producto.

## Verificación local (Windows)

Sin dependencias de npm ni servicios externos. Se usa Node.js v20.11.1 portable en `C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64`, agregado al PATH solo en la sesión. Desde `mailmerge_sdd_local/`:

**Git Bash**

```bash
export PATH="/c/Users/matias.peralta_exter/nodejs/node-v20.11.1-win-x64:$PATH"
node --test
```

**PowerShell**

```powershell
$env:Path = "C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64;$env:Path"
node --test
```

Controles adicionales: `node --check <archivo.js>`, `git diff --check`, `git status --short` y `git remote -v` (debe estar vacío).

## Próximo paso: piloto controlado

La herramienta todavía no se instaló en una cuenta de Google. Antes de un piloto hay que recorrer el checklist `PENDING LIVE VALIDATION` de [`docs/OPERATIONS.md`](docs/OPERATIONS.md) y autorizar en forma explícita los scopes de `src/appsscript.json`, en particular `https://mail.google.com/` y `drive.readonly`, que dan acceso amplio. El piloto usa una hoja nueva, datos ficticios, archivos de prueba y destinatarios aprobados. Tener el código listo no habilita ninguna acción externa.

## Desarrollo

Las reglas de ingeniería (idioma, Git solo local, autorización para operaciones externas, seguridad y tests) están en [`AGENTS.md`](AGENTS.md); [`CLAUDE.md`](CLAUDE.md) agrega lo específico de Claude Code. Los cambios posteriores se tratan como mantenimiento acotado con `spec-driven-dev`, sin repetir el plan de V1.
