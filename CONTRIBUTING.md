# Contributing

## Development Principles
- Keep Clipulse simple.
- Prefer official APIs, hooks, and plugin systems over invasive integrations.
- Preserve privacy defaults; do not introduce code or prompt uploads by default.
- Avoid large refactors unless they directly support the current task.

## Local Workflow
1. Sync with the latest `main`.
2. Make focused changes.
3. Add or update tests for behavior changes.
4. Run the smallest meaningful verification for the touched area.
5. Open a PR for major milestones.
6. Small fixes and small docs changes can be committed directly.

## Private Research
- Put upstream references, competitive analysis, and local notes under `.clipulse-private/`.
- Never commit `.clipulse-private/`.

## Commit Style
- Use clear, scoped commit messages.
- Prefer examples like `feat(api): add overview endpoint` or `fix(claude): normalize stop events`.

