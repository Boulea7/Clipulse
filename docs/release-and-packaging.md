# Clipulse Release And Packaging Notes

## Summary

- `npm run check:release-metadata` checks all published version markers, including the API runtime `APP_VERSION`.
- `npm run check:py-build` builds a Python `sdist` and `wheel`.
- `npm run check:py-install-smoke` installs the built release artifacts into clean virtualenvs, serves the bundled dashboard/contracts from the installed package, starts a real local server, and runs `smoke:deployment`.
- `.github/workflows/release-skeleton.yml` is still a preflight workflow, but it now runs release metadata checks, repo smoke, stable/experimental smoke, Python build, and packaged install smoke before uploading artifacts.

## What The Python Artifact Contains

The Python release artifact now bundles:

- `clipulse_api` runtime code
- dashboard static assets needed by `/` and `/static/*`
- dashboard compatibility contracts under `/contracts/*`

That means the built release artifacts are no longer just backend packaging evidence. They are now expected to serve:

- `/`
- `/static/app.js`, `/static/styles.css`, and the dashboard import graph they depend on
- `/contracts/dashboard-compat.v1.json`
- `/contracts/events-batch.v1.json`

Contributor and operator docs may still use source checkout because it is easier to explain, but release artifacts are now treated as a deployable self-hosted surface.

## Version Rules

Before a release tag or release workflow run:

1. Update `pyproject.toml`, `apps/api/clipulse_api/app.py`, and every workspace `package.json` together.
2. Move the relevant notes from `## [Unreleased]` into a new `## [x.y.z]` section in `CHANGELOG.md`.
3. Keep `## [Unreleased]` in place for the next cycle.
4. Re-run:
   - `npm run check:release-metadata`
   - `npm run check:py-build`
   - `npm run check:py-install-smoke`

The release workflow uses the requested release version as a hard gate. If checked-in versions or changelog sections drift, the workflow fails before artifact upload.

## Verify

### Local release-prep path

```bash
npm run check:release:prep
```

### What install smoke proves

`npm run check:py-install-smoke` currently proves all of the following from installed release artifacts:

- `import clipulse_api` works in a clean virtualenv
- the installed package can serve the dashboard root without falling back to the backend-only placeholder
- `/static/*` assets and the checked import graph load from the installed artifact
- both published contracts under `/contracts/*` load from the installed artifact
- a real local `uvicorn` instance passes `smoke:deployment`

## Artifact Notes

- Release preflight still uploads CI artifacts; it does not publish to PyPI or create a GitHub Release automatically.
- `check:beta` / `check:beta:ci` remain source-tree gates. Use `npm run check:release:prep` when you need the local release-ready path.
- Public docs should describe these artifacts as deployable self-hosted packages, but not as a managed multi-node distribution.
- If release packaging changes again, keep this document and the top-level README aligned in the same PR.
