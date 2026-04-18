# Contributing

Thanks for helping improve Clipulse.

## Where To Start

- Read the top-level `README` variant that matches your language first.
- Use `docs/self-hosting-and-integration.md` for setup, operator checks, and integration details.
- Use the GitHub issue chooser for public bugs, docs fixes, and feature requests: <https://github.com/Boulea7/Clipulse/issues/new/choose>
- Use `SECURITY.md` instead of a public issue for vulnerabilities, privacy leaks, or any report that should stay private.
- Use `SUPPORT.md` for question-routing, support expectations, and the right place to ask for help.

## Project Expectations

- Keep changes focused and easy to review.
- Prefer official APIs, hooks, and plugin systems over invasive integrations.
- Preserve privacy defaults. Do not add source-content or raw-prompt uploads by default.
- Keep public docs summary-first. Deep operator notes belong in `docs/self-hosting-and-integration.md` or the package-level READMEs, not in every public entrypoint.
- Keep public routing inside repository-managed surfaces. Do not add a general contact email to README, SUPPORT, issue-template links, or other public-facing docs; private reporting stays in `SECURITY.md`.
- Keep internal-only notes, local research, and scratch material out of public docs and PR descriptions.

## Keep Local-Only Files Private

- Do not commit repo-local agent files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/`, `.codex/`, `.cursor/`, or local worktree directories.
- Do not commit `.clipulse-private/`, `CLIPULSE_STATE_DIR` contents, SQLite database files, `.env*` other than the checked-in `.env.example`, `credentials*`, or private keys/certs.
- If you add a new local-only helper file, keep it ignored in `.gitignore` and keep it out of PR descriptions too.

## Pull Requests

1. Sync with the latest `main`.
2. Make the smallest change that solves the problem.
3. Add or update tests when behavior or checked docs contracts change.
4. Run the smallest meaningful verification for the area you touched.
5. Summarize user-facing impact, validation, and any known limitations in the PR template.

## Validation

- Docs-only changes should still run the relevant docs parity checks when they protect the touched surface.
- If you change operator wording or public integration guidance, note whether `npm run smoke:repo-guardrails` or a broader repo check was run.
- If you could not run a useful check, say that clearly in the PR.
- If you touch a top-level README, either update the other language variants in the same change or say explicitly why they were left for follow-up.

## Community

- Follow `CODE_OF_CONDUCT.md` in issues, PRs, and review threads.
- Keep feedback specific, respectful, and actionable.
- When in doubt about whether something belongs in public, choose the narrower public summary and link to the deeper doc instead.
- Use `CHANGELOG.md` for public release-facing notes instead of burying those updates in internal-only docs.
