@AGENTS.md

# Instrucciones específicas para Claude Code

Las reglas de ingeniería, idioma, límite local y seguridad están en `AGENTS.md` (importado arriba). Este archivo solo agrega lo propio de Claude Code.

## Node.js para las pruebas

Usar Node.js 20 o superior. Si `node` ya está disponible en el `PATH`, ejecutar `node --test` desde la raíz del repositorio (Git Bash o PowerShell). Si se usa una instalación portable, agregar **su directorio** al `PATH` únicamente en la sesión actual, sin instalar dependencias ni modificar la configuración permanente del equipo.

- Git Bash (ejemplo): `export PATH="/ruta/a/node:$PATH" && node --test`
- PowerShell (ejemplo): `$env:Path = "C:\ruta\a\node;$env:Path"; node --test`

Las rutas de los ejemplos son marcadores de posición: reemplazarlas por el directorio real donde esté `node.exe`.

## Skills de `spec-driven-dev`

`/spec-driven-dev:small-change`, `/spec-driven-dev:write-plan` y `/spec-driven-dev:implement-plan` solo las puede lanzar el usuario. Cuando corresponda una, proponer el comando exacto en lugar de intentar invocarla.

## Límites de la herramienta

- No crear agentes, hooks, comandos ni configuración de Claude Code sin una necesidad concreta y verificada.
- No usar conectores, navegadores ni MCP para actuar sobre cuentas de Google o servicios externos; la autorización de `AGENTS.md` aplica también a esas herramientas.
