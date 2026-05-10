# Clipulse Release And Packaging Overview

## Summary

Clipulse can be deployed through two server deployment paths today:

- from a source checkout of this repository
- from Python release artifacts built by this repository

Both paths serve the same self-hosted product surface: the FastAPI runtime, the bundled dashboard, and the compatibility contracts under `/contracts/*`.
Stable releases now also prepare first-party adapter bundles for `Claude Code` and `Codex` under `dist/stable-bundles/`, installable Node tarballs under `dist/npm-packages/`, and a single stable release asset manifest plus checksum file under `dist/`.

## What Ships In A Built Artifact

The built Python `sdist` and `wheel` are deployable server artifacts. They bundle:

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
- installed console scripts: `clipulse-migrate` for schema prep and `clipulse-api` for serving the runtime

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

Those commands verify that both the wheel and sdist can install into clean environments, serve the bundled dashboard and contracts, run `clipulse-migrate` plus `clipulse-api`, and pass the deployment smoke.

`npm run check:py-install-smoke` is a repo-side verification lane: it uses the checked-out smoke script to probe an installed release artifact, but the package runtime under test does not read dashboard assets or contracts from the checkout.

If you are preparing a stable source checkout for an operator handoff, use the deterministic bootstrap command instead of a mutable install:

```bash
npm run bootstrap:self-hosted:stable
```

### For a live running instance

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_DASHBOARD_TOKEN="reuse-the-server-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="reuse-the-server-api-token"
npm run smoke:deployment
```

When public reads are enabled, add `CLIPULSE_PUBLIC_BASE_URL` and `CLIPULSE_EXPECT_PUBLIC_READS=1` before running the probe.

For faster diagnosis after a failure, use `/healthz` and `/api/v1/status`. If the stable Node tarballs are installed, `clipulse-collector-core doctor` and `clipulse-collector-core pending` add count-only local diagnostics for queued delivery, recent successful delivery, and terminal cleanup state. From a source checkout, use `node packages/collector-core/dist/cli.js doctor` and `node packages/collector-core/dist/cli.js pending` after building the workspaces.

## Release Readiness In Plain Terms

- `npm run check:release:prep` is the stable release-ready preflight for this repository.
- `npm run check:release:prep:full` runs the same stable chain and then adds the experimental adapter lane.
- `npm run bundle:stable` prepares the stable adapter bundles that the release workflow uploads.
- `npm run check:package:stable` now validates both the self-contained bundles and the installable Node tarballs with a real local smoke.
- `npm run check:release-assets:stable` verifies that the generated manifest and checksum file match the exact asset set that will be uploaded.
- When you verify assets locally after rebuilding artifacts, follow the workflow order: run `npm run check:py-build` and `npm run check:package:stable`, then `node scripts/release-assets.mjs manifest`, then `node scripts/release-assets.mjs checksums`, then `npm run check:release-assets:stable`. `npm run bundle:stable` only refreshes the self-contained adapter bundle tarballs.
- `npm run check:release-metadata:stable` is the stable-only version-marker gate; `npm run check:release-metadata` keeps the broader full-tree check.
- Stable release assets are described by `dist/clipulse-stable-release-<version>.manifest.json`.
- Stable release checksums live in `dist/clipulse-stable-release-<version>-sha256.txt`.
- The tagged release workflow prepares the manifest, checksums, and a draft GitHub Release for the built Python artifacts, the stable adapter bundles, and the stable Node tarballs.
- If a tag is moved while a draft release already exists, the tagged release workflow refuses to continue when it sees duplicate drafts for the same tag and prints each matching draft release id, creation time, and URL.
- The release dry-run workflow runs on pull requests and `workflow_dispatch`, then uploads the same assets plus manifest/checksums without requiring a tag or calling `gh release`.
- The current workflow does not publish to PyPI automatically.

<details>
<summary>Version alignment and maintainer notes</summary>

- Release metadata checks still expect the repository version markers to stay aligned.
- `npm run check:release-metadata` is the explicit version-marker gate.
- The public manifest is intentionally portable: it records asset ids, kinds, relative paths, and file metadata, but not build-machine absolute paths.
- Verify downloaded release sets with `sha256sum -c clipulse-stable-release-<version>-sha256.txt` or `shasum -a 256 -c clipulse-stable-release-<version>-sha256.txt`.
- Duplicate draft release recovery must be explicit: delete stale drafts by release id or in the GitHub UI, do not use tag-level `gh release delete <tag>` or `--cleanup-tag`, then rerun the release workflow.
- `CHANGELOG.md` remains the public release history and should keep `## [Unreleased]` in place between releases.
- If packaging scope changes, update this document, the root README variants, and `README.package.md` in the same change.

</details>
