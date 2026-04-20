# Clipulse Release And Packaging Overview

## Summary

Clipulse can be deployed in two public-facing ways today:

- from a source checkout of this repository
- from Python release artifacts built by this repository

Both paths serve the same self-hosted product surface: the FastAPI runtime, the bundled dashboard, and the compatibility contracts under `/contracts/*`.
Stable releases now also prepare first-party adapter bundles for `Claude Code` and `Codex` under `dist/stable-bundles/`.

## What Ships In A Built Artifact

The built Python `sdist` and `wheel` are not backend-only packaging evidence. They bundle:

- the `clipulse_api` runtime
- dashboard static assets used by `/` and `/static/*`
- published compatibility contracts under `/contracts/*`

That is why the built artifact can power the same self-hosted deployment shape described in the root README and `docs/self-hosting-and-integration.md`.

## Deployment Choices

### Source checkout

Choose this when you want the shortest path to:

- build from local source
- inspect package workspaces directly
- iterate on adapters and the API in one tree

This is still the simplest contributor and operator path.

### Built Python artifact

Choose this when you want:

- a cleaner install boundary
- packaged dashboard assets and contracts
- a deployment path that does not depend on keeping the whole repository checkout on the server

Install details live in [README.package.md](../README.package.md).

## Public And Private Surfaces

No matter which packaging route you choose, the intended split is the same:

- keep `/`, `/static/*`, `/contracts/*`, and private `/api/v1/*` routes behind the protected deployment
- expose `/api/v1/badges/*` and `/api/v1/public/readme/*` only when you intentionally want a public read surface

When you publish public README snippets, set:

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

Set `CLIPULSE_PUBLIC_PROBE_URL` only when the public outlet lives on a separate origin or proxy path and you want `npm run smoke:deployment` to probe it directly.

## Verification You Can Run

### For a checkout deployment

```bash
npm run smoke:stable
npm run smoke:experimental
```

Use the stable lane when you only need the stable host surface. Add the experimental lane when your deployment also depends on `Gemini CLI` or `OpenCode`.

### For built artifacts

```bash
npm run check:py-build
npm run check:py-install-smoke
```

Those commands verify that the built artifact can install into a clean environment, serve the bundled dashboard and contracts, and pass the deployment smoke.

### For a live running instance

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_DASHBOARD_TOKEN="$CLIPULSE_DASHBOARD_TOKEN"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

For faster diagnosis after a failure, use `/healthz`, `/api/v1/status`, `doctor`, and `pending`.

## Release Readiness In Plain Terms

- `npm run check:release:prep` is the stable release-ready preflight for this repository.
- `npm run check:release:prep:full` runs the same stable chain and then adds the experimental adapter lane.
- `npm run bundle:stable` prepares the stable adapter bundles that the release workflow uploads.
- The release workflow prepares checksums and a draft GitHub Release for the built Python artifacts plus the stable adapter bundles.
- The current workflow does not publish to PyPI automatically.

<details>
<summary>Version alignment and maintainer notes</summary>

- Release metadata checks still expect the repository version markers to stay aligned.
- `npm run check:release-metadata` is the explicit version-marker gate.
- `CHANGELOG.md` remains the public release history and should keep `## [Unreleased]` in place between releases.
- If packaging scope changes, update this document, the root README variants, and `README.package.md` in the same change.

</details>
