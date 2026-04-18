# Security Policy

## Scope

Clipulse is in active beta preparation. Please report issues that could expose or weaken:

- local adapter and hook / plugin integrations
- API authentication, authorization, or request validation
- source-content, prompt, transcript, path, or badge data leakage
- dashboard or reporting endpoints exposing unintended data

## Private Reporting Path

Do not open a public issue for sensitive vulnerabilities.

Preferred path:

1. Open a private GitHub security advisory draft: <https://github.com/Boulea7/Clipulse/security/advisories/new>
2. If that page is unavailable in your current GitHub context, open the repository security page and use the private reporting option shown there: <https://github.com/Boulea7/Clipulse/security/policy>
3. If GitHub private reporting is unavailable or you need a direct private fallback, email <opensource@lnzai.com> with the repository name, affected surface, and a short impact summary in the subject or first line.
4. If you are still unsure whether the report is sensitive, treat it as sensitive and start with one of the private paths above.

Use public issues only for non-sensitive bugs or hardening suggestions: <https://github.com/Boulea7/Clipulse/issues/new/choose>

## What Is Usually Not A Security Report

These usually belong in public issues or `SUPPORT.md` instead:

- feature requests
- ordinary setup failures without a confidentiality or integrity impact
- docs gaps that do not create a security exposure
- requests to expand host support or metrics coverage

## What To Include

Please include:

- a short summary of the issue and affected surface
- reproduction steps or a minimal proof of concept
- expected impact and any known prerequisites
- whether source code, prompts, transcripts, paths, badges, or other user data could be exposed
- any mitigation or workaround you already confirmed

Please do not include secrets that you do not want maintainers to retain.

## Response Expectations

- We aim to acknowledge new private reports within 5 business days.
- We may ask follow-up questions or request a narrower reproduction before confirming severity.
- When a fix is shipped, we will decide case by case whether to publish an advisory, release note, or both.
- The email fallback is reserved for private security handling and should not be used as a general support channel.

## Privacy Baseline

Clipulse is designed to avoid uploading:

- source file contents
- raw prompt contents
- raw transcript contents
- raw local project paths over the public transport contract

Any change that weakens those defaults must be explicit, documented, and gated by user configuration.

Clipulse still stores and transports bounded activity metadata needed for summaries, such as hashed project scope keys, host/model identifiers, timestamps, aggregate language stats, and file-delta counts. Treat that metadata as sensitive operational data even though it excludes raw source and prompt bodies by default.

## Never Push

Do not publish these files or directories:

- `.clipulse-private/`
- `CLIPULSE_STATE_DIR` contents
- SQLite database files
- `.env*`
- `credentials*`
- `*.pem`
- `*.key`
- `*.p12`
- `*.pfx`
