# Clipulse Python Package

`clipulse-api` is the packaged FastAPI backend for a self-hosted Clipulse deployment.

This package serves:

- the Clipulse API runtime
- bundled dashboard assets under `/static/*`
- bundled compatibility contracts under `/contracts/*`

## Install

Install one of the published release artifacts:

```bash
python -m pip install "https://github.com/Boulea7/Clipulse/releases/download/v<version>/clipulse_api-<version>-py3-none-any.whl"
```

or:

```bash
python -m pip install "https://github.com/Boulea7/Clipulse/releases/download/v<version>/clipulse_api-<version>.tar.gz"
```

## Run

Export the required environment:

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="$(pwd)/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
```

Prepare the database:

```bash
clipulse-migrate upgrade "$CLIPULSE_DATABASE_URL"
```

Start the server:

```bash
clipulse-api
```

## Verify

For a minimal operator check after installation:

```bash
curl -i http://127.0.0.1:8000/healthz
curl -H "Authorization: Bearer $CLIPULSE_API_BEARER_TOKEN" http://127.0.0.1:8000/api/v1/status
```

For release artifact verification from the repo checkout, run:

```bash
npm run check:py-build
npm run check:py-install-smoke
```

If you are also preparing stable adapter assets from the checkout, run:

```bash
npm run bundle:stable
```

## Stable Adapter Assets

The same release also ships stable Node-side adapter artifacts for `Claude Code` and `Codex`.

- Self-contained bundle path:
  - `clipulse-adapter-claude.tar.gz`
  - `clipulse-adapter-codex.tar.gz`
  - Extract the archive and wire the bundled `dist/cli.js` directly.
- Installable npm tarball path:
  - `clipulse-collector-core-<version>.tgz`
  - `clipulse-adapter-claude-<version>.tgz`
  - `clipulse-adapter-codex-<version>.tgz`
  - Install `collector-core` plus the adapter tarball together in the target integration project.

Example npm tarball install for `Codex`:

```bash
npm install ./clipulse-collector-core-<version>.tgz ./clipulse-adapter-codex-<version>.tgz
```

Example bundle usage for `Codex` after extraction:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="replace-with-your-api-token"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
node ./adapter-codex/dist/cli.js
```

For operator-focused deployment guidance, public/private outlet topology, and adapter wiring, see `docs/self-hosting-and-integration.md` in the repository source.
