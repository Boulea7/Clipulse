# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Français](./README.fr.md) | [한국어](./README.ko.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

> Seguimiento de actividad autohospedado y orientado a la privacidad para `Claude Code`, `Codex`, `Gemini CLI` y `OpenCode`.

Clipulse es un rastreador de actividad autohospedado para coding-agent CLIs. Convierte hooks y eventos de plugin locales en resúmenes respetuosos con la privacidad, un dashboard ligero y badges listos para incrustar en README, sin subir el contenido del código ni raw prompts por defecto.

## Por que Clipulse

- Mantiene la API, SQLite y el dashboard dentro de tu propia infraestructura.
- Sigue active time, wait time, file delta, idiomas, modelos y host mix con un unico contrato de eventos limitado.
- Permite publicar badges y README snippets sin abrir el dashboard privado.
- Puedes empezar desde un source checkout y pasar mas adelante a Python release artifacts cuando quieras una ruta de empaquetado mas limpia.

Por defecto, Clipulse mantiene el formato de transporte lo mas estrecho posible: envia metadatos acotados como un `project_root` hash, nombres de host y modelo, timestamps, language stats agregadas y file-delta counts. No envia raw local paths, source contents, raw prompts ni raw transcripts por defecto.

## Que obtienes

- Un runtime FastAPI desplegable en `apps/api` con el dashboard integrado desde `apps/web`.
- Logica compartida de recoleccion y entrega en `packages/collector-core`.
- Adapters estables para `Claude Code` y `Codex`.
- Adapters experimentales para `Gemini CLI` y `OpenCode`.
- Artefactos de compatibilidad de primera mano, incluido `/contracts/dashboard-compat.v1.json`.

## Matriz de soporte

- Soporte principal hoy: `Claude Code`, `Codex`
- Soporte experimental hoy: `Gemini CLI`, `OpenCode`
- Diagnosticos disponibles desde el primer momento: `/healthz`, `/api/v1/status`, `doctor`, `pending`

## Instalacion con un Coding Agent

Si quieres la ruta mas rapida, abre el repositorio en `Claude Code`, `Codex` u `OpenCode` y pega el siguiente prompt tal cual.

- Haz que el agente lea primero este README y `docs/self-hosting-and-integration.md`.
- Revisa y aprueba los comandos en tu maquina, especialmente los de variables de entorno y los procesos largos.
- Si prefieres instalar todo a mano, salta directamente a Quickstart.

```text
Estas en la raiz del repositorio de Clipulse. Lee README.es.md y docs/self-hosting-and-integration.md primero, y despues completa una instalacion local de extremo a extremo para esta maquina.

Objetivos:
1. Instalar las dependencias necesarias de Node.js y Python.
2. Configurar las variables de entorno para un despliegue local protegido. Si aun no te he dado secretos reales, usa valores de marcador claros y dime al final cuales debo reemplazar.
3. Ejecutar la migracion de la base de datos.
4. Iniciar la API en 127.0.0.1:8000.
5. Enviar el smoke fixture incluido de Codex a traves de la API local.
6. Confirmar que la pagina de inicio de sesion del dashboard carga y explicarme como entrar.
7. Si algo falla, diagnostica el problema, corrigelo y continua hasta que la instalacion local funcione.
8. No crees tags ni releases y no modifiques archivos no relacionados.

Al final, imprime:
- todos los comandos que ejecutaste
- todas las variables de entorno que aun debo reemplazar
- el resultado exacto de la verificacion
```

## Quickstart

Requisitos:

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

1. Construye el repositorio e instala las dependencias de Python.

```bash
npm install
npm run build
uv sync --group dev
```

2. Inicia Clipulse en modo protegido.

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

Usa `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` solo para depuracion local cuando realmente quieras saltarte la autenticacion del dashboard.

3. Envia un smoke fixture incluido por la ruta estable del adapter `Codex`.

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. Abre `http://127.0.0.1:8000/`, entra con `CLIPULSE_DASHBOARD_TOKEN` y confirma que aparece la primera session.

Si prefieres una ruta centrada en diagnostico, continua con `docs/self-hosting-and-integration.md`. Los smoke lanes del repositorio permanecen separados a proposito: `npm run smoke:stable` cubre la ruta estable y `npm run smoke:experimental` anade la ruta experimental.

## Ejemplo de salida

Cuando `CLIPULSE_ENABLE_PUBLIC_READS=1` y `CLIPULSE_PUBLIC_BASE_URL` estan definidos, `/api/v1/public/readme/top-language` devuelve markdown listo para pegar en otro proyecto:

```md
![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)
```

El mismo patron publico tambien existe para `today-time` y `this-week-time`.

## Mapa de documentos

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md): modos de despliegue, auth, reverse proxy, probes y adapter wiring
- [Architecture overview](./docs/architecture.md): data flow, trust boundaries y runtime surfaces
- [Release and packaging overview](./docs/release-and-packaging.md): source checkout frente a built Python artifacts
- [Clipulse Python Package](./README.package.md): instalacion de un `sdist` o `wheel` generado
- [Contributing](./CONTRIBUTING.md): expectativas de contribucion y reglas de routing para public docs
- [Support](./SUPPORT.md): rutas de ayuda publica y que incluir en una consulta
- [Security policy](./SECURITY.md): ruta privada de reporte para vulnerabilidades y privacy leaks
- [Changelog](./CHANGELOG.md): historial orientado a releases

<details>
<summary>Puntos de entrada de adapters y ejemplos incluidos</summary>

- Docs de adapters estables: [packages/adapter-claude/README.md](./packages/adapter-claude/README.md), [packages/adapter-codex/README.md](./packages/adapter-codex/README.md)
- Ejemplos estables incluidos: [packages/adapter-claude/hooks/hooks.json](./packages/adapter-claude/hooks/hooks.json), [packages/adapter-codex/examples/hooks.json](./packages/adapter-codex/examples/hooks.json)
- Docs de adapters experimentales: [packages/adapter-gemini/README.md](./packages/adapter-gemini/README.md), [packages/adapter-opencode/README.md](./packages/adapter-opencode/README.md)
- Ejemplos experimentales incluidos: [packages/adapter-gemini/examples/.gemini/settings.json](./packages/adapter-gemini/examples/.gemini/settings.json), [packages/adapter-opencode/examples/clipulse.ts](./packages/adapter-opencode/examples/clipulse.ts)

</details>

<details>
<summary>Empaquetado y notas avanzadas para operadores</summary>

- El source checkout sigue siendo la ruta mas corta para contributors y self-hosting operators.
- Los built Python artifacts se describen en [docs/release-and-packaging.md](./docs/release-and-packaging.md) y [README.package.md](./README.package.md). Empaquetan el runtime de la API, los dashboard assets y `/contracts/*`.
- `npm run check:release:prep` es la preflight estable de release-ready. `npm run check:release:prep:full` anade el lane experimental.
- Si expones solo la superficie publica de lectura, publica `/api/v1/badges/*` y `/api/v1/public/readme/*`, y despues define `CLIPULSE_ENABLE_PUBLIC_READS=1` y `CLIPULSE_PUBLIC_BASE_URL`.
- Define `CLIPULSE_PUBLIC_PROBE_URL` solo cuando la salida publica viva en otro origin o en otra proxy path y quieras que `npm run smoke:deployment` la sondee directamente.
- Gemini baseline wiring starts from `packages/adapter-gemini/dist/cli.js` and the checked-in example lifecycle: `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `SessionEnd`.
- `BeforeAgent` y el alias de compatibilidad `UserPromptSubmit` no deben quedar conectados al mismo tiempo en la misma instalación.
- `session.diff` sigue siendo opt-in para `OpenCode` detras de `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`.

</details>

## Soporte y seguridad

- Usa [SUPPORT.md](./SUPPORT.md) para preguntas publicas y no sensibles, y para contexto de troubleshooting.
- Usa [SECURITY.md](./SECURITY.md) para vulnerabilidades, privacy leaks y cualquier reporte que deba mantenerse privado.
- Usa el [issue chooser](https://github.com/Boulea7/Clipulse/issues/new/choose) para bugs publicos o docs gaps.
