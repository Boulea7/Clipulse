# Clipulse Release And Packaging Notes

## Summary

- `npm run check:release:prep` is the local stable release-ready preflight: release metadata, stable-only repo guardrails, build, test, API lint, stable smoke, Python build, and installed-package smoke.
- `npm run check:release:prep:full` runs the same stable release-ready chain and then adds the experimental smoke lane.
- `npm run check:release-metadata` checks all published version markers, including the API runtime `APP_VERSION`.
- `npm run check:py-build` builds a Python `sdist` and `wheel` from this repo for artifact-based installs.
- `npm run check:py-install-smoke` installs the built release artifacts into clean virtualenvs, serves the bundled dashboard/contracts from the installed package, starts a real local server, and runs `smoke:deployment`.
- `npm run test:docs:release:stable` keeps the stable release-ready docs and repo-hygiene assertions separate from beta-only and experimental repo checks.
- `.github/workflows/beta-checks.yml` packaging checks and `.github/workflows/release-skeleton.yml` now both call the stable release-ready chain before treating artifacts as ready.
- The release workflow now prepares checksums and a draft GitHub Release for the built Python artifacts. It still does not publish to PyPI automatically.

## What The Python Artifact Contains

These install paths refer to the built `dist/*` artifacts from this repository, not a globally published package.

The Python release artifact now bundles:

- `clipulse_api` runtime code
- dashboard static assets needed by `/` and `/static/*`
- all three published contracts under `/contracts/*`

That means the built release artifacts are no longer just backend packaging evidence. They are now expected to serve:

- `/`
- `/static/app.js`, `/static/styles.css`, and the currently checked dashboard import files they depend on
- `/contracts/dashboard-compat.v1.json`
- `/contracts/dashboard-login-copy.v1.json`
- `/contracts/events-batch.v1.json`

Contributor and operator docs may still use source checkout because it is easier to explain, but release artifacts are now treated as a deployable self-hosted surface.

## Version Rules

Before a release tag or release workflow run:

1. Update `pyproject.toml`, `apps/api/clipulse_api/app.py`, and every workspace `package.json` together.
2. Move the relevant notes from `## [Unreleased]` into a new `## [x.y.z]` section in `CHANGELOG.md`.
3. Keep `## [Unreleased]` in place for the next cycle.
4. Re-run `npm run check:release:prep`.

The release workflow uses the requested release version as a hard gate. If checked-in versions or changelog sections drift, the workflow fails before artifact upload.

## Verify

### Local release-prep path

```bash
npm run check:release:prep
```

### Full local sweep including experimental hosts

```bash
npm run check:release:prep:full
```

### What install smoke proves

`npm run check:py-install-smoke` currently proves all of the following from installed release artifacts:

- `import clipulse_api` works in a clean virtualenv
- the installed package can serve the dashboard root without falling back to the backend-only placeholder
- `/static/*` entrypoint assets plus the current checked dashboard import files load from the installed artifact
- all three published contracts under `/contracts/*` load from the installed artifact
- a real local `uvicorn` instance passes `smoke:deployment`

## Artifact Notes

- Release preflight now prepares a draft GitHub Release with the built artifacts and a checksum file.
- Release preflight still does not publish to PyPI automatically.
- `check:beta` / `check:beta:ci` remain source-tree gates. Use `npm run check:release:prep` when you need the local release-ready path without beta-only repo assertions.
- Use `npm run check:release:prep:full` when you intentionally want the experimental adapter lane in the same local preflight.
- Public docs should describe these artifacts as deployable self-hosted packages, but not as a managed multi-node distribution.
- If release packaging changes again, keep this document and the top-level README aligned in the same PR.
