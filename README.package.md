# Clipulse Python Package

`clipulse-api` is the packaged FastAPI backend for a self-hosted Clipulse deployment.

This package serves:

- the Clipulse API runtime
- bundled dashboard assets under `/static/*`
- bundled compatibility contracts under `/contracts/*`

## Install

Install one of the built release artifacts:

```bash
python -m pip install "dist/clipulse_api-<version>-py3-none-any.whl"
```

or:

```bash
python -m pip install "dist/clipulse_api-<version>.tar.gz"
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
python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
```

Start the server:

```bash
uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

## Verify

For release artifact verification from the repo checkout, run:

```bash
npm run check:py-build
npm run check:py-install-smoke
```

For operator-focused deployment guidance, public/private outlet topology, and adapter wiring, see `docs/self-hosting-and-integration.md` in the repository source.
