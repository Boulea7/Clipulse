# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Español](./README.es.md) | [한국어](./README.ko.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

> Suivi d'activite auto-heberge et respectueux de la vie privee pour `Claude Code`, `Codex`, `Gemini CLI` et `OpenCode`.

Clipulse est un traqueur d'activite auto-heberge pour les coding-agent CLIs. Il transforme les hooks et evenements de plugin locaux en resumes respectueux de la vie privee, en dashboard leger et en badges prets a etre integres dans un README, sans envoyer le contenu du code ni les raw prompts par defaut.

## Pourquoi Clipulse

- L'API, SQLite et le dashboard restent dans ton infrastructure.
- Active time, wait time, file delta, langues, modeles et host mix sont suivis via un contrat d'evenements limite.
- Tu peux publier des badges et des README snippets sans ouvrir le dashboard prive.
- Tu peux commencer avec un source checkout puis passer a des Python release artifacts quand tu veux une frontiere de packaging plus propre.

Par defaut, Clipulse garde un format de transport etroit: il envoie des metadonnees bornees comme un `project_root` hache, les noms de host et de modele, les timestamps, les language stats agregees et les file-delta counts. Il n'envoie pas de raw local paths, de source contents, de raw prompts ni de raw transcripts par defaut.

## Ce que tu obtiens

- Un runtime FastAPI deployable dans `apps/api` avec le dashboard integre depuis `apps/web`
- Une logique partagee de collecte et de livraison dans `packages/collector-core`
- Des adapters stables pour `Claude Code` et `Codex`
- Des adapters experimentaux pour `Gemini CLI` et `OpenCode`
- Des artefacts de compatibilite de premiere main, dont `/contracts/dashboard-compat.v1.json`

## Matrice de support

- Prise en charge principale aujourd'hui: `Claude Code`, `Codex`
- Prise en charge experimentale aujourd'hui: `Gemini CLI`, `OpenCode`
- Points de diagnostic disponibles immediatement: `/healthz`, `/api/v1/status`, `doctor`, `pending`

## Installation avec un Coding Agent

Si tu veux le chemin le plus rapide, ouvre le depot dans `Claude Code`, `Codex` ou `OpenCode`, puis colle le prompt ci-dessous tel quel.

- Demande d'abord a l'agent de lire ce README et `docs/self-hosting-and-integration.md`.
- Verifie et approuve les commandes sur ta machine, surtout celles qui touchent aux variables d'environnement et aux processus serveur de longue duree.
- Si tu preferes une installation manuelle, passe directement a Quickstart.

```text
Tu es a la racine du depot Clipulse. Lis README.fr.md et docs/self-hosting-and-integration.md d'abord, puis realise une installation locale complete sur cette machine.

Objectifs :
1. Installer les dependances Node.js et Python requises.
2. Configurer les variables d'environnement pour un deploiement local protege. Si je n'ai pas encore fourni de vrais secrets, utilise des valeurs de remplacement evidentes et dis-moi clairement a la fin ce que je dois remplacer.
3. Executer la migration de base de donnees.
4. Demarrer l'API sur 127.0.0.1:8000.
5. Envoyer le smoke fixture Codex inclus via l'API locale.
6. Confirmer que la page de connexion du dashboard se charge et m'expliquer comment me connecter.
7. Si quelque chose echoue, diagnostique le probleme, corrige-le et continue jusqu'a ce que l'installation locale fonctionne.
8. Ne cree ni tag ni release et ne modifie pas de fichiers sans rapport.

A la fin, affiche :
- toutes les commandes executees
- toutes les variables d'environnement que je dois encore remplacer
- le resultat exact de la verification
```

## Quickstart

Prerequis :

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

1. Construis le depot et installe les dependances Python.

```bash
npm install
npm run build
uv sync --group dev
```

2. Demarre Clipulse en mode protege.

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

Utilise `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` uniquement pour du debogage local lorsque tu veux explicitement contourner l'authentification du dashboard.

3. Envoie un smoke fixture inclus via le chemin stable de l'adapter `Codex`.

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="reuse-the-token-from-step-2"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. Ouvre `http://127.0.0.1:8000/`, connecte-toi avec `CLIPULSE_DASHBOARD_TOKEN`, puis confirme que la premiere session apparait.

5. Si tu prepares l'ensemble complet des stable release assets depuis le checkout, execute aussi :

```bash
npm run check:py-build
npm run check:package:stable
node scripts/release-assets.mjs manifest
node scripts/release-assets.mjs checksums
npm run check:release-assets:stable
```

Pour une approche plus orientee diagnostic, continue avec `docs/self-hosting-and-integration.md`. Les repo smoke lanes restent separes volontairement : `npm run smoke:stable` couvre le chemin stable et `npm run smoke:experimental` ajoute les hosts experimentaux.

## Exemple de sortie

Quand `CLIPULSE_ENABLE_PUBLIC_READS=1` et `CLIPULSE_PUBLIC_BASE_URL` sont definis, `/api/v1/public/readme/top-language` renvoie du markdown que tu peux coller directement dans un autre projet :

```md
![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)
```

Le meme schema public existe aussi pour `today-time` et `this-week-time`.

## Carte de la documentation

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md): modes de deploiement, auth, reverse proxy, probes et adapter wiring
- [Architecture overview](./docs/architecture.md): data flow, trust boundaries et runtime surfaces
- [Release and packaging overview](./docs/release-and-packaging.md): source checkout vs built Python artifacts
- [Clipulse Python Package](./README.package.md): installation d'un `sdist` ou d'un `wheel` genere
- [Contributing](./CONTRIBUTING.md): attentes de contribution et routage des public docs
- [Support](./SUPPORT.md): chemins d'aide publique et informations a fournir dans une demande
- [Security policy](./SECURITY.md): chemin prive de signalement pour les vulnerabilites et privacy leaks
- [Changelog](./CHANGELOG.md): historique oriente release

<details>
<summary>Points d'entree des adapters et exemples inclus</summary>

- Documentation des adapters stables : [packages/adapter-claude/README.md](./packages/adapter-claude/README.md), [packages/adapter-codex/README.md](./packages/adapter-codex/README.md)
- Exemples stables inclus : [packages/adapter-claude/hooks/hooks.json](./packages/adapter-claude/hooks/hooks.json), [packages/adapter-codex/examples/hooks.json](./packages/adapter-codex/examples/hooks.json)
- Documentation des adapters experimentaux : [packages/adapter-gemini/README.md](./packages/adapter-gemini/README.md), [packages/adapter-opencode/README.md](./packages/adapter-opencode/README.md)
- Exemples experimentaux inclus : [packages/adapter-gemini/examples/.gemini/settings.json](./packages/adapter-gemini/examples/.gemini/settings.json), [packages/adapter-opencode/examples/clipulse.ts](./packages/adapter-opencode/examples/clipulse.ts)

</details>

<details>
<summary>Packaging et notes avancees pour les operators</summary>

- Le source checkout reste le chemin le plus court pour les contributors et self-hosting operators.
- Les built Python artifacts sont presentes dans [docs/release-and-packaging.md](./docs/release-and-packaging.md) et [README.package.md](./README.package.md). Ils regroupent le runtime de l'API, les dashboard assets et `/contracts/*`.
- `npm run check:release:prep` est la preflight stable release-ready. `npm run check:release:prep:full` ajoute la voie experimentale.
- Si tu n'exposes que la surface publique en lecture, publie `/api/v1/badges/*` et `/api/v1/public/readme/*`, puis definis `CLIPULSE_ENABLE_PUBLIC_READS=1` et `CLIPULSE_PUBLIC_BASE_URL`.
- Definis `CLIPULSE_PUBLIC_PROBE_URL` uniquement lorsque la sortie publique vit sur un origin ou une proxy path distincte et que tu veux que `npm run smoke:deployment` la sonde directement.
- Gemini baseline wiring starts from `packages/adapter-gemini/dist/cli.js` and the checked-in example lifecycle: `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `SessionEnd`.
- `BeforeAgent` et l'alias de compatibilite `UserPromptSubmit` ne doivent pas rester cables en meme temps dans la meme installation.
- `session.diff` reste opt-in pour `OpenCode` derriere `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`.

</details>

## Support et securite

- Utilise [SUPPORT.md](./SUPPORT.md) pour les questions publiques non sensibles et le contexte de troubleshooting.
- Utilise [SECURITY.md](./SECURITY.md) pour les vulnerabilites, les privacy leaks et tout rapport qui doit rester prive.
- Utilise le [issue chooser](https://github.com/Boulea7/Clipulse/issues/new/choose) pour les bugs publics ou les docs gaps.
