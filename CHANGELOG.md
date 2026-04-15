# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and remains in pre-1.0 beta preparation.

## [Unreleased]

### Added

- Public community hygiene documents for support, security routing, and contribution guidance.
- Dependabot coverage for GitHub Actions, npm workspace dependencies, and Python dependencies.
- A lightweight pull request dependency review workflow for dependency-risk visibility.
- A Python packaging baseline with explicit `pyproject.toml` build metadata, `sdist`/`wheel` build verification, and a beta CI packaging job.
- A tag-aware release skeleton workflow that checks version/changelog alignment before building and uploading release artifacts.
- A new release and packaging note that separates release artifact hygiene from checkout-first deployment guidance.
- A packaged install smoke that verifies the built wheel can serve the dashboard, contracts, and a live deployment probe.

### Changed

- Public issue and pull request templates now point contributors to the right support and security paths.
- The documented public runtime floor now matches the beta CI Node lane.
- Operator docs now distinguish repo smoke from deployment smoke and document reverse-proxy `root_path`, server-local spool state, retention caps, upgrade flow, and the current SQLite single-instance boundary.
- Protected deployments now cover dashboard docs/openapi surfaces, public README snippets no longer trust request `Host`, and dashboard browser sessions are read-only while write APIs remain bearer-only.
- Python release artifacts now bundle dashboard static assets and compatibility contracts instead of behaving like backend-only packaging evidence.
- Collector-side local state now hashes project scope before network delivery/spool persistence, and snapshot hashes are state-dir-specific.
- The dashboard clears private data after logout and hides protected-session chrome on unprotected instances.

### Notes

- Until the first beta release is tagged, treat this changelog as the public summary of release-facing repo hygiene rather than a complete internal development log.
