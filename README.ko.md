# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Español](./README.es.md) | [Français](./README.fr.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

> `Claude Code`, `Codex`, `Gemini CLI`, `OpenCode`를 위한 프라이버시 우선의 셀프호스트 활동 추적기.

Clipulse는 coding-agent CLI를 위한 셀프호스트 활동 추적기입니다. 로컬 hooks와 plugin 이벤트를 프라이버시 친화적인 요약, 가벼운 dashboard, 그리고 README에 바로 넣을 수 있는 badge로 정리하며, 기본값으로 source contents나 raw prompts를 업로드하지 않습니다.

## 왜 Clipulse인가

- API, SQLite, dashboard를 모두 직접 통제하는 인프라 안에 둘 수 있습니다.
- 하나의 제한된 이벤트 계약으로 active time, wait time, file delta, 언어, 모델, host mix를 추적합니다.
- 공개가 필요할 때도 private dashboard를 열지 않고 badge와 README snippet만 노출할 수 있습니다.
- 지금은 source checkout으로 시작하고, 나중에 더 깔끔한 배포 경계를 원하면 Python release artifact로 옮길 수 있습니다.

기본 전송 형식은 가능한 한 좁게 유지됩니다. 해시된 `project_root` scope key, host / model 이름, timestamp, 집계된 language stats, file-delta counts 같은 bounded activity metadata만 보냅니다. raw local paths, source contents, raw prompts, raw transcripts는 기본값으로 보내지 않습니다.

## 무엇을 얻을 수 있나

- `apps/api` 아래의 배포 가능한 FastAPI runtime과 `apps/web`에서 번들된 dashboard
- `packages/collector-core`의 공용 수집, 버퍼링, 전송 로직
- 안정 지원되는 `Claude Code`와 `Codex`
- 실험 지원되는 `Gemini CLI`와 `OpenCode`
- `/contracts/dashboard-compat.v1.json`을 포함한 1차 호환성 아티팩트

## 지원 매트릭스

- 현재 정식 지원: `Claude Code`, `Codex`
- 현재 실험 지원: `Gemini CLI`, `OpenCode`
- 바로 사용할 수 있는 진단 진입점: `/healthz`, `/api/v1/status`, `doctor`, `pending`

## Coding Agent로 한번에 설치하기

가장 빠른 경로를 원하면 저장소를 `Claude Code`, `Codex`, `OpenCode`에서 열고 아래 프롬프트를 그대로 붙여 넣으세요.

- 먼저 이 README와 `docs/self-hosting-and-integration.md`를 읽게 하세요.
- 명령 실행 전에는 반드시 검토하고 승인하세요. 특히 환경 변수 설정과 장시간 실행되는 서버 명령은 확인이 필요합니다.
- 직접 설치하고 싶다면 아래 Quickstart로 바로 내려가면 됩니다.

```text
지금 Clipulse 저장소 루트 디렉터리에 있습니다. README.ko.md와 docs/self-hosting-and-integration.md를 먼저 읽고, 이 머신에서 Clipulse의 로컬 설치를 끝까지 완료해 주세요.

목표:
1. 필요한 Node.js와 Python 의존성을 설치합니다.
2. 보호된 로컬 배포를 위한 환경 변수를 설정합니다. 아직 실제 비밀값을 주지 않았다면 눈에 띄는 placeholder를 사용하고, 마지막에 무엇을 교체해야 하는지 분명히 알려 주세요.
3. 데이터베이스 마이그레이션을 실행합니다.
4. API를 127.0.0.1:8000에서 시작합니다.
5. 저장소에 포함된 Codex smoke fixture를 로컬 API로 보냅니다.
6. dashboard 로그인 페이지가 열리는지 확인하고 로그인 방법을 설명합니다.
7. 중간에 실패하면 원인을 진단하고 수정한 뒤, 로컬 설치가 동작할 때까지 계속 진행합니다.
8. tag나 release를 만들지 말고, 관련 없는 파일도 수정하지 마세요.

마지막에는 반드시 아래를 출력하세요:
- 실제로 실행한 모든 명령
- 내가 아직 직접 교체해야 하는 환경 변수
- 최종 검증 결과
```

## Quickstart

요구 사항:

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

1. 저장소를 빌드하고 Python 의존성을 설치합니다.

```bash
npm install
npm run build
uv sync --group dev
```

2. 보호 모드로 Clipulse를 시작합니다.

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

`CLIPULSE_ALLOW_INSECURE_NO_AUTH=1`은 dashboard 인증을 의도적으로 건너뛰고 싶을 때의 로컬 디버깅에만 사용하세요.

3. 안정적인 `Codex` adapter 경로를 통해 저장소에 포함된 smoke fixture를 하나 전송합니다.

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="reuse-the-token-from-step-2"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. `http://127.0.0.1:8000/`을 열고 `CLIPULSE_DASHBOARD_TOKEN`으로 로그인한 뒤 첫 번째 session이 보이는지 확인합니다.

5. checkout에서 전체 stable release asset 세트를 준비한다면 다음도 실행합니다.

```bash
npm run check:py-build
npm run check:package:stable
node scripts/release-assets.mjs manifest
node scripts/release-assets.mjs checksums
npm run check:release-assets:stable
```

진단 중심으로 진행하고 싶다면 `docs/self-hosting-and-integration.md`를 이어서 보세요. repo smoke는 의도적으로 두 갈래입니다. `npm run smoke:stable`은 안정 경로, `npm run smoke:experimental`은 실험 host 경로를 추가로 확인합니다.

## 출력 예시

`CLIPULSE_ENABLE_PUBLIC_READS=1`과 `CLIPULSE_PUBLIC_BASE_URL`을 설정하면 `/api/v1/public/readme/top-language`가 다른 프로젝트에 그대로 붙여 넣을 수 있는 markdown을 반환합니다.

```md
![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)
```

같은 public 패턴으로 `today-time`과 `this-week-time`도 사용할 수 있습니다.

## 문서 안내

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md): 배포 모드, auth, reverse proxy, probes, adapter wiring
- [Architecture overview](./docs/architecture.md): data flow, trust boundaries, runtime surfaces
- [Release and packaging overview](./docs/release-and-packaging.md): source checkout과 built Python artifacts의 차이
- [Clipulse Python Package](./README.package.md): 빌드된 `sdist` 또는 `wheel` 설치 방법
- [Contributing](./CONTRIBUTING.md): 기여 규칙과 public docs 라우팅 원칙
- [Support](./SUPPORT.md): 공개 도움 경로와 문의 시 포함할 정보
- [Security policy](./SECURITY.md): 취약점과 privacy leaks를 위한 비공개 신고 경로
- [Changelog](./CHANGELOG.md): 릴리스 중심 변경 이력

<details>
<summary>Adapter 진입점과 포함된 예시</summary>

- 안정 adapter 문서: [packages/adapter-claude/README.md](./packages/adapter-claude/README.md), [packages/adapter-codex/README.md](./packages/adapter-codex/README.md)
- 안정 예시 파일: [packages/adapter-claude/hooks/hooks.json](./packages/adapter-claude/hooks/hooks.json), [packages/adapter-codex/examples/hooks.json](./packages/adapter-codex/examples/hooks.json)
- 실험 adapter 문서: [packages/adapter-gemini/README.md](./packages/adapter-gemini/README.md), [packages/adapter-opencode/README.md](./packages/adapter-opencode/README.md)
- 실험 예시 파일: [packages/adapter-gemini/examples/.gemini/settings.json](./packages/adapter-gemini/examples/.gemini/settings.json), [packages/adapter-opencode/examples/clipulse.ts](./packages/adapter-opencode/examples/clipulse.ts)

</details>

<details>
<summary>패키징과 고급 운영 메모</summary>

- contributors와 self-hosting operators에게는 source checkout이 여전히 가장 짧은 경로입니다.
- built Python artifacts는 [docs/release-and-packaging.md](./docs/release-and-packaging.md)와 [README.package.md](./README.package.md)에 설명되어 있습니다. API runtime, dashboard assets, `/contracts/*`를 함께 묶습니다.
- `npm run check:release:prep`은 안정 release-ready preflight이고, `npm run check:release:prep:full`은 실험 adapter 경로를 추가합니다.
- public read surface만 노출하려면 `/api/v1/badges/*`와 `/api/v1/public/readme/*`를 공개하고, `CLIPULSE_ENABLE_PUBLIC_READS=1` 및 `CLIPULSE_PUBLIC_BASE_URL`을 설정하세요.
- public outlet이 별도 origin 또는 proxy path에 있을 때만 `CLIPULSE_PUBLIC_PROBE_URL`을 추가로 설정하고, `npm run smoke:deployment`가 그 경로를 직접 probe하도록 하세요.
- Gemini baseline wiring starts from `packages/adapter-gemini/dist/cli.js` and the checked-in example lifecycle: `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `SessionEnd`.
- `BeforeAgent`와 호환 alias `UserPromptSubmit`를 같은 설치에 동시에 연결하면 안 됩니다.
- `session.diff`는 `OpenCode`에서 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` 뒤에 남아 있는 opt-in 기능입니다.

</details>

## 지원 및 보안

- 공개 가능한 비민감 문의와 troubleshooting context는 [SUPPORT.md](./SUPPORT.md)를 사용하세요.
- 취약점, privacy leaks, 비공개로 다뤄야 하는 모든 보고는 [SECURITY.md](./SECURITY.md)를 사용하세요.
- 공개 bug나 docs gaps는 [issue chooser](https://github.com/Boulea7/Clipulse/issues/new/choose)를 사용하세요.
