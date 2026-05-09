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

For a minimal operator check after installing only the Python package:

```bash
curl -i http://127.0.0.1:8000/healthz
curl -H "Authorization: Bearer $CLIPULSE_API_BEARER_TOKEN" http://127.0.0.1:8000/api/v1/status
```

The Python package does not install the Node-side collector CLI. Its installed runtime surface is `clipulse-api`, `clipulse-migrate`, the dashboard assets, and the compatibility contracts.

For release artifact verification from the repo checkout, run:

```bash
npm run check:py-build
npm run check:py-install-smoke
```

`npm run check:py-install-smoke` installs both the wheel and sdist into clean temporary environments, runs `clipulse-migrate` and `clipulse-api`, and then uses `npm run smoke:deployment` from the repo checkout against the installed server.

If you only need to validate the stable Node adapter artifacts from a checkout, run:

```bash
npm run check:package:stable
```

If you need the full stable release asset set, also rebuild the Python artifacts and release metadata:

```bash
npm run check:py-build
npm run check:package:stable
node scripts/release-assets.mjs manifest
node scripts/release-assets.mjs checksums
npm run check:release-assets:stable
```

If you are preparing a source checkout for a self-hosted stable deployment, use the deterministic bootstrap path:

```bash
npm run bootstrap:self-hosted:stable
```

## Stable Adapter Assets

The same release also ships stable Node-side adapter artifacts for `Claude Code` and `Codex`.

- Self-contained bundle path:
  - `clipulse-adapter-claude-<version>.tar.gz`
  - `clipulse-adapter-codex-<version>.tar.gz`
  - Extract the archive with `tar -xzf clipulse-adapter-<host>-<version>.tar.gz` and wire the bundled `dist/cli.js` directly.
- Installable npm tarball path:
  - `clipulse-collector-core-<version>.tgz`
  - `clipulse-adapter-claude-<version>.tgz`
  - `clipulse-adapter-codex-<version>.tgz`
  - Install `collector-core` plus the adapter tarball together in the target integration project.

If you also install the stable Node tarballs, then these optional local diagnostics become available:

```bash
clipulse-collector-core doctor
clipulse-collector-core pending
```

From a source checkout, run the same diagnostics through the built workspace entrypoint instead:

```bash
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

`doctor`, `pending`, and `/api/v1/status` expose count-only local diagnostics for queued delivery, recent successful delivery, and terminal cleanup state. They do not print raw prompt text, source content, or absolute state paths through the HTTP status surface.

Example npm tarball install for `Codex`:

```bash
npm install ./clipulse-collector-core-<version>.tgz ./clipulse-adapter-codex-<version>.tgz
```

Example bundle usage for `Codex` after extraction:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="replace-with-your-api-token"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
printf '%s\n' '{"session_id":"codex-smoke","cwd":"'"$(pwd)"'","hook_event_name":"SessionStart"}' \
  | node ./clipulse-adapter-codex-<version>/dist/cli.js
```

`dist/cli.js` reads host hook payloads from stdin. When running it manually, pipe a fixture or JSON payload into the process; the host tool normally provides that input.

Example bundle usage for `Claude Code` after extraction:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="replace-with-your-api-token"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
printf '%s\n' '{"session_id":"claude-smoke","cwd":"'"$(pwd)"'","hook_event_name":"UserPromptSubmit"}' \
  | node ./clipulse-adapter-claude-<version>/dist/cli.js
```

The Claude bundle entrypoint also reads hook JSON from stdin when the host integration invokes it.

Stable release runs also write:

- `dist/clipulse-stable-release-<version>.manifest.json`
- `dist/clipulse-stable-release-<version>-sha256.txt`

Verify the downloaded release set before wiring it into a deployment:

```bash
sha256sum -c clipulse-stable-release-<version>-sha256.txt
```

On macOS where `sha256sum` is unavailable, use:

```bash
shasum -a 256 -c clipulse-stable-release-<version>-sha256.txt
```

For operator-focused deployment guidance, public/private outlet topology, and adapter wiring, see `docs/self-hosting-and-integration.md` in the repository source. For the release asset manifest, checksum, and workflow contract, see `docs/release-and-packaging.md`.
