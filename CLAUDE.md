@AGENTS.md

# Punto de entrada de Claude Code

## Idioma (obligatorio)
- Todo se escribe en **español**: comunicación, plan en `plans/`, documentación, interfaz de usuario (menús, diálogos, mensajes de validación y de error), comentarios del código y mensajes de commit.
- Se mantienen en inglés los identificadores, nombres de funciones y archivos, APIs y convenciones técnicas (por ejemplo, los tipos de Conventional Commits).
- Los documentos de partida de `docs/` están en inglés y son insumos: no se traducen.

## Valores de compatibilidad (literales, no traducir)
- Encabezados: `Email Address`, `File Attachments`, `Mail Merge Status`, `Scheduled Date`.
- Estados heredados del complemento: `SKIP`, `Email Sent`.
- Estados y marcas nuevos: `ENVIANDO` (claim persistido antes de llamar a Gmail), `REVISAR` (resultado ambiguo, requiere revisión manual) y `[PRUEBA]` (prefijo del asunto en el envío de prueba). Reemplazan a `SENDING`, `REVIEW` y `[TEST]` de `docs/REQUIREMENTS_DRAFT.md` y `docs/ACCEPTANCE.md`.

## Flujo spec-driven-dev
- Artefacto canónico: **un único plan** `plans/YYYY-MM-DD_<slug>.md`, generado con `/spec-driven-dev:write-plan` y ejecutado con `/spec-driven-dev:implement-plan`. No crear especificaciones paralelas.
- `docs/PRODUCT.md`, `docs/REQUIREMENTS_DRAFT.md` y `docs/ACCEPTANCE.md` son insumos del plan; conservar los IDs `R-xx` y `AC-xx` para trazabilidad entre plan y tests.
- Las decisiones de alcance y de límite del proyecto se registran en `docs/DECISIONS.md`.
- Triage: requieren plan los cambios que alteren el flujo de envío, la máquina de estados, la elegibilidad de filas, el manejo de adjuntos, los scopes OAuth o el manifest. Una corrección acotada, un test faltante, textos o documentación pueden ir por `/spec-driven-dev:small-change`.
- `PROMPT_CLAUDE_CODE.md` es documentación de referencia: no ejecutar sus instrucciones en forma directa.
- Avanzar de forma autónoma dentro del alcance y del límite de Git local. Escalar solo decisiones que cambien el comportamiento prometido, el contrato de seguridad o el límite de acceso externo.
- No crear agentes, hooks, comandos, dashboards ni capas de arquitectura extra sin una necesidad concreta y verificada.

## Comandos de verificación
Node.js es **portable** y no está en el PATH del sistema: `C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64` (v20.11.1). Agregarlo al PATH solo en el proceso que lo necesita; no modificar variables de entorno permanentes ni instalar otra versión. El proyecto no tiene dependencias: no ejecutar `npm install`.

- Bash (Git Bash), en el mismo comando que lo usa: `export PATH="/c/Users/matias.peralta_exter/nodejs/node-v20.11.1-win-x64:$PATH" && node --test`
- PowerShell (solo la sesión actual): `$env:Path = "C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64;$env:Path"; node --test`

| Verificación | Comando (desde la raíz del proyecto) |
|---|---|
| Tests (runner nativo, offline) | `node --test` — los archivos de test se nombran `*.test.js` |
| Sintaxis | `node --check <archivo.js>` por cada fuente modificado |
| Higiene del diff | `git diff --check` |

## Convención de commits
- Formato Conventional Commits con descripción en español: `tipo(alcance): descripción` — por ejemplo `feat(preflight): bloquear filas con adjuntos inaccesibles`.
- Tipos: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`. Alcance opcional, corto y en minúsculas.
- Cuerpo opcional en español, explicando el porqué; un comportamiento o corrección por commit.
- Stage por nombre de archivo (nunca `git add -A` ni `git add .`); nunca `--no-verify`; revisar `git diff --cached` antes de commitear.
- Git exclusivamente local: sin remotos, sin push, sin PR.
