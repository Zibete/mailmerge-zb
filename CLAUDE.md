@AGENTS.md

# Instrucciones específicas para Claude Code

Las reglas de ingeniería, idioma, límite local y seguridad están en `AGENTS.md` (importado arriba). Este archivo solo agrega lo propio de Claude Code.

## Node portable

Node no está en el PATH del sistema. Anteponerlo solo en el comando que lo usa (el estado del shell no persiste entre llamadas); no modificar el PATH permanente ni instalar otra versión.

- Git Bash: `export PATH="/c/Users/matias.peralta_exter/nodejs/node-v20.11.1-win-x64:$PATH" && node --test`
- PowerShell: `$env:Path = "C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64;$env:Path"; node --test`

## Skills de `spec-driven-dev`

`/spec-driven-dev:small-change`, `/spec-driven-dev:write-plan` y `/spec-driven-dev:implement-plan` solo las puede lanzar el usuario. Cuando corresponda una, proponer el comando exacto en lugar de intentar invocarla.

## Límites de la herramienta

- No crear agentes, hooks, comandos ni configuración de Claude Code sin una necesidad concreta y verificada.
- No usar conectores, navegadores ni MCP para actuar sobre cuentas de Google o servicios externos; la autorización de `AGENTS.md` aplica también a esas herramientas.
