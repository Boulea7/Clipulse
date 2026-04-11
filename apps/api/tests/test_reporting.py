from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re

from fastapi.testclient import TestClient

from clipulse_api.app import compute_project_ref, create_app
from clipulse_api.database import EventRecord, create_session_factory


def load_dashboard_compatibility_contract() -> dict[str, object]:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "dashboard-compat.v1.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def get_dashboard_compatibility_contract_hash() -> str:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "dashboard-compat.v1.json"
    return f"sha256:{hashlib.sha256(contract_path.read_bytes()).hexdigest()}"


def assert_contract_fields(payload: dict[str, object], contract: dict[str, object]) -> None:
    for field_name in contract.get("text", []):
        assert isinstance(payload.get(field_name), str)
        assert payload[field_name]

    for field_name in contract.get("number", []):
        assert isinstance(payload.get(field_name), int | float)

    for group in contract.get("anyText", []):
        assert any(
            isinstance(payload.get(field_name), str) and payload[field_name]
            for field_name in group["fields"]
        )

    for group in contract.get("anyNumber", []):
        assert any(
            isinstance(payload.get(field_name), int | float) for field_name in group["fields"]
        )


def seed_event(client: TestClient) -> None:
    payload = {
        "events": [
            {
                "event_id": "event-1",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-1",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T12:00:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 60000,
                "wait_ms": 15000,
                "privacy_mode": "hashed",
                "language_stats": {
                    "TypeScript": {"added": 12, "removed": 2, "changed": 14}
                },
                "file_deltas": [
                    {
                        "fingerprint": "ts-demo",
                        "language": "TypeScript",
                        "added": 12,
                        "removed": 2,
                    }
                ],
            },
            {
                "event_id": "event-2",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-2",
                "project_root": "/workspace/demo-api",
                "project_name": "demo-api",
                "git_branch": "main",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T13:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 30000,
                "wait_ms": 10000,
                "privacy_mode": "hashed",
                "language_stats": {
                    "Python": {"added": 4, "removed": 1, "changed": 5}
                },
                "file_deltas": [
                    {
                        "fingerprint": "py-demo",
                        "language": "Python",
                        "added": 4,
                        "removed": 1,
                    }
                ],
            },
            {
                "event_id": "event-3",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-2",
                "project_root": "/workspace/demo-api",
                "project_name": "demo-api",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T13:05:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 10000,
                "wait_ms": 2000,
                "privacy_mode": "hashed",
                "language_stats": {
                    "Python": {"added": 3, "removed": 0, "changed": 3}
                },
                "file_deltas": [
                    {
                        "fingerprint": "py-demo",
                        "language": "Python",
                        "added": 3,
                        "removed": 0,
                    }
                ],
            },
        ]
    }
    response = client.post("/api/v1/events/batch", json=payload)
    assert response.status_code == 202


def seed_session_first_rollup_event(client: TestClient) -> str:
    project_root = "/workspace/rollup-demo"
    payload = {
        "events": [
            {
                "event_id": "rollup-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-rollup",
                "project_root": project_root,
                "project_name": "rollup-demo",
                "git_branch": "main",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T10:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 8000,
                "wait_ms": 2000,
                "privacy_mode": "hashed",
                "language_stats": {
                    "Python": {"added": 5, "removed": 1, "changed": 6}
                },
                "file_deltas": [
                    {
                        "fingerprint": "py-rollup",
                        "language": "Python",
                        "added": 5,
                        "removed": 1,
                    }
                ],
            },
            {
                "event_id": "rollup-2",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-rollup",
                "project_root": project_root,
                "project_name": "rollup-demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T10:05:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 12000,
                "wait_ms": 4000,
                "privacy_mode": "hashed",
                "language_stats": {
                    "TypeScript": {"added": 7, "removed": 2, "changed": 9}
                },
                "file_deltas": [
                    {
                        "fingerprint": "ts-rollup",
                        "language": "TypeScript",
                        "added": 7,
                        "removed": 2,
                    }
                ],
            },
        ]
    }
    response = client.post("/api/v1/events/batch", json=payload)
    assert response.status_code == 202
    return project_root


def test_model_and_host_breakdowns_are_aggregated() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    models = client.get("/api/v1/breakdown/models")
    hosts = client.get("/api/v1/breakdown/hosts")

    assert models.status_code == 200
    assert hosts.status_code == 200
    assert models.json()["items"][0]["name"] == "claude-sonnet"
    assert hosts.json()["items"][0]["name"] == "claude-code"


def test_model_and_host_breakdowns_use_stable_name_tie_breaks() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "event_id": "event-zeta",
                "host": "zeta-host",
                "host_version": "0.1.0",
                "session_id": "session-zeta",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T14:00:00Z",
                "model_name": "zeta-model",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 30000,
                "wait_ms": 0,
                "privacy_mode": "hashed",
                "language_stats": {
                    "ZetaLang": {"added": 3, "removed": 0, "changed": 3}
                },
                "file_deltas": [],
            },
            {
                "event_id": "event-alpha",
                "host": "alpha-host",
                "host_version": "0.1.0",
                "session_id": "session-alpha",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T14:05:00Z",
                "model_name": "alpha-model",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 30000,
                "wait_ms": 0,
                "privacy_mode": "hashed",
                "language_stats": {
                    "AlphaLang": {"added": 3, "removed": 0, "changed": 3}
                },
                "file_deltas": [],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    languages = client.get("/api/v1/breakdown/languages")
    models = client.get("/api/v1/breakdown/models")
    hosts = client.get("/api/v1/breakdown/hosts")

    assert [item["name"] for item in languages.json()["items"][:2]] == [
        "AlphaLang",
        "ZetaLang",
    ]
    assert [item["name"] for item in models.json()["items"][:2]] == [
        "alpha-model",
        "zeta-model",
    ]
    assert [item["name"] for item in hosts.json()["items"][:2]] == [
        "alpha-host",
        "zeta-host",
    ]


def test_top_language_badge_returns_svg() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    response = client.get("/api/v1/badges/top-language.svg")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert "TypeScript" in response.text


def test_top_language_badge_uses_stable_name_tie_breaks() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "event_id": "event-zeta-language",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-zeta-language",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T14:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 0,
                "privacy_mode": "hashed",
                "language_stats": {
                    "ZetaLang": {"added": 3, "removed": 0, "changed": 3}
                },
                "file_deltas": [],
            },
            {
                "event_id": "event-alpha-language",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-alpha-language",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T14:05:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 0,
                "privacy_mode": "hashed",
                "language_stats": {
                    "AlphaLang": {"added": 3, "removed": 0, "changed": 3}
                },
                "file_deltas": [],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    response = client.get("/api/v1/badges/top-language.svg")

    assert response.status_code == 200
    assert "AlphaLang" in response.text


def test_top_language_badge_escapes_special_characters_in_svg_text() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "event_id": "event-special-language",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-special-language",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T14:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 0,
                "privacy_mode": "hashed",
                "language_stats": {
                    'Rust & "C<unsafe>"': {"added": 3, "removed": 0, "changed": 3}
                },
                "file_deltas": [],
            }
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    response = client.get("/api/v1/badges/top-language.svg")

    assert response.status_code == 200
    assert 'Rust &amp; &quot;C&lt;unsafe&gt;&quot;' in response.text
    assert 'Rust & "C<unsafe>"' not in response.text


def test_timeseries_returns_daily_event_totals() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    response = client.get("/api/v1/timeseries")

    assert response.status_code == 200
    assert response.json()["items"][0]["date"] == "2026-04-05"
    assert response.json()["items"][0]["events"] == 3


def test_public_readme_endpoint_returns_markdown_snippet() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/public/readme/top-language")

    assert response.status_code == 200
    assert "![Clipulse" in response.json()["markdown"]
    assert "top-language.svg" in response.json()["markdown"]


def test_public_readme_time_endpoints_return_markdown_snippets() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    today = client.get("/api/v1/public/readme/today-time")
    this_week = client.get("/api/v1/public/readme/this-week-time")

    assert today.status_code == 200
    assert "today-time.svg" in today.json()["markdown"]
    assert this_week.status_code == 200
    assert "this-week-time.svg" in this_week.json()["markdown"]


def test_public_readme_markdown_snippets_resolve_to_live_badge_routes() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    snippet_routes = [
        "/api/v1/public/readme/top-language",
        "/api/v1/public/readme/today-time",
        "/api/v1/public/readme/this-week-time",
    ]

    for snippet_route in snippet_routes:
        snippet = client.get(snippet_route)

        assert snippet.status_code == 200
        markdown = snippet.json()["markdown"]
        match = re.search(r"\((https?://[^)]+)\)", markdown)

        assert match is not None

        badge_path = match.group(1).replace("http://testserver", "")
        badge = client.get(badge_path)

        assert badge.status_code == 200
        assert badge.headers["content-type"] == "image/svg+xml"
        assert "<svg" in badge.text


def test_public_readme_markdown_normalizes_custom_root_paths_without_double_slashes() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app, base_url="https://clipulse.example", root_path="//nested//clipulse/")

    today = client.get("/api/v1/public/readme/today-time")
    this_week = client.get("/api/v1/public/readme/this-week-time")

    assert today.status_code == 200
    assert today.json()["markdown"] == (
        "![Clipulse Today Time]"
        "(https://clipulse.example/nested/clipulse/api/v1/badges/today-time.svg)"
    )
    assert "//nested" not in today.json()["markdown"]
    assert "clipulse//api" not in today.json()["markdown"]

    assert this_week.status_code == 200
    assert this_week.json()["markdown"] == (
        "![Clipulse This Week Time]"
        "(https://clipulse.example/nested/clipulse/api/v1/badges/this-week-time.svg)"
    )
    assert "//nested" not in this_week.json()["markdown"]
    assert "clipulse//api" not in this_week.json()["markdown"]


def test_empty_database_routes_return_stable_summary_shapes() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    projects = client.get("/api/v1/projects/top?limit=5")
    sessions = client.get("/api/v1/sessions/recent?limit=10")
    timeseries = client.get("/api/v1/timeseries")
    badge = client.get("/api/v1/badges/top-language.svg")
    readme = client.get("/api/v1/public/readme/top-language")
    today_readme = client.get("/api/v1/public/readme/today-time")
    week_readme = client.get("/api/v1/public/readme/this-week-time")

    assert projects.status_code == 200
    assert projects.json() == {"items": []}
    assert sessions.status_code == 200
    assert sessions.json() == {"items": []}
    assert timeseries.status_code == 200
    assert timeseries.json() == {"items": []}
    assert badge.status_code == 200
    assert "none" in badge.text
    assert readme.status_code == 200
    assert "top-language.svg" in readme.json()["markdown"]
    assert today_readme.status_code == 200
    assert "today-time.svg" in today_readme.json()["markdown"]
    assert week_readme.status_code == 200
    assert "this-week-time.svg" in week_readme.json()["markdown"]


def test_root_serves_dashboard_shell() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "Clipulse" in response.text
    assert "<html" in response.text.lower()


def test_duplicate_event_ids_are_ignored_and_overview_includes_time_windows() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    current_event_time = (
        datetime.now(UTC)
        .replace(hour=8, minute=0, second=0, microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )

    payload = {
        "events": [
            {
                "event_id": "event-duplicate",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-dup",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": current_event_time,
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 45000,
                "wait_ms": 5000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "event-duplicate",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-dup",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": current_event_time,
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 45000,
                "wait_ms": 5000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    ingest = client.post("/api/v1/events/batch", json=payload)
    assert ingest.status_code == 202
    assert ingest.json()["accepted"] == 1

    overview = client.get("/api/v1/overview")

    assert overview.status_code == 200
    assert overview.json()["totals"]["events"] == 1
    assert overview.json()["today"]["active_ms"] == 45000
    assert overview.json()["this_week"]["active_ms"] == 45000


def test_projects_recent_sessions_and_time_badges_expose_alpha_metrics() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    projects = client.get("/api/v1/projects/top?limit=5")
    sessions = client.get("/api/v1/sessions/recent?limit=10")
    today_badge = client.get("/api/v1/badges/today-time.svg")
    week_badge = client.get("/api/v1/badges/this-week-time.svg")

    assert projects.status_code == 200
    assert projects.json()["items"][0]["project_name"] == "demo"
    assert projects.json()["items"][0]["active_ms"] == 60000
    assert projects.json()["items"][0]["project_ref"]
    assert projects.json()["items"][0]["changed_files_count"] == 1
    assert projects.json()["items"][0]["lines_changed"] == 14
    assert projects.json()["items"][0]["top_language"] == {"name": "TypeScript", "changed": 14}

    assert sessions.status_code == 200
    assert sessions.json()["items"][0]["session_id"] == "session-2"
    assert sessions.json()["items"][0]["project_name"] == "demo-api"
    assert sessions.json()["items"][0]["project_ref"]
    assert "languages" not in sessions.json()["items"][0]
    assert "file_deltas" not in sessions.json()["items"][0]

    assert today_badge.status_code == 200
    assert today_badge.headers["content-type"].startswith("image/svg+xml")
    assert "today time" in today_badge.text

    assert week_badge.status_code == 200
    assert week_badge.headers["content-type"].startswith("image/svg+xml")
    assert "this week" in week_badge.text


def test_project_list_keeps_primary_host_model_summary_without_full_mix_payload() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = "/workspace/project-list-rollup-demo"
    payload = {
        "events": [
            {
                "event_id": "project-list-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-list-rollup",
                "project_root": project_root,
                "project_name": "project-list-rollup-demo",
                "git_branch": "feat/primary",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T09:55:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 15000,
                "wait_ms": 4000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "project-list-2",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-list-rollup",
                "project_root": project_root,
                "project_name": "project-list-rollup-demo",
                "git_branch": "feat/latest",
                "event_name": "stop",
                "event_time": "2026-04-05T10:05:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 2000,
                "wait_ms": 500,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    projects = client.get("/api/v1/projects/top?limit=5")

    assert projects.status_code == 200
    item = projects.json()["items"][0]
    assert "host_model_mix" not in item
    assert item["host_model_mix_count"] == 2
    assert item["host_model_primary"] == {
        "host": "codex",
        "model_name": "gpt-5.4",
        "events": 1,
        "active_ms": 15000,
        "wait_ms": 4000,
    }


def test_today_time_badge_uses_exact_minute_boundary_wording() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    current_event_time = (
        datetime.now(UTC)
        .replace(hour=9, minute=0, second=0, microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )

    payload = {
        "events": [
            {
                "event_id": "badge-today-minute-boundary",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "badge-today-minute-boundary",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": current_event_time,
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 60000,
                "wait_ms": 0,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            }
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    response = client.get("/api/v1/badges/today-time.svg")

    assert response.status_code == 200
    assert "1m 0s" in response.text
    assert "60s" not in response.text


def test_this_week_time_badge_uses_exact_hour_boundary_wording() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    current_event_time = (
        datetime.now(UTC)
        .replace(hour=10, minute=0, second=0, microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )

    payload = {
        "events": [
            {
                "event_id": "badge-week-hour-boundary",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "badge-week-hour-boundary",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": current_event_time,
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 3600000,
                "wait_ms": 0,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            }
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    response = client.get("/api/v1/badges/this-week-time.svg")

    assert response.status_code == 200
    assert "1h 0m" in response.text
    assert "60m 0s" not in response.text


def test_list_endpoints_clamp_non_positive_limits_to_empty_items() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)
    second_session_payload = {
        "events": [
            {
                "event_id": "event-4",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-3",
                "project_root": "/workspace/demo-api",
                "project_name": "demo-api",
                "git_branch": "feat/extra",
                "event_name": "stop",
                "event_time": "2026-04-05T13:10:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 5000,
                "wait_ms": 500,
                "privacy_mode": "hashed",
                "language_stats": {
                    "Python": {"added": 1, "removed": 0, "changed": 1}
                },
                "file_deltas": [
                    {
                        "fingerprint": "py-extra",
                        "language": "Python",
                        "added": 1,
                        "removed": 0,
                    }
                ],
            }
        ]
    }
    assert client.post("/api/v1/events/batch", json=second_session_payload).status_code == 202

    project_ref = compute_project_ref("/workspace/demo-api")

    assert client.get("/api/v1/projects/top?limit=0").json()["items"] == []
    assert client.get("/api/v1/projects/top?limit=-1").json()["items"] == []
    assert client.get("/api/v1/sessions/recent?limit=0").json()["items"] == []
    assert client.get("/api/v1/sessions/recent?limit=-1").json()["items"] == []
    assert client.get(f"/api/v1/projects/{project_ref}/sessions?limit=0").json()["items"] == []
    assert client.get(f"/api/v1/projects/{project_ref}/sessions?limit=-1").json()["items"] == []


def test_session_detail_exposes_git_branch() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    project_ref = compute_project_ref("/workspace/demo-api")
    session_detail = client.get(f"/api/v1/sessions/session-2?project_ref={project_ref}")

    assert session_detail.status_code == 200
    assert session_detail.json()["git_branch"] == "main"


def test_session_detail_keeps_backward_compatible_events_alias() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    session_detail = client.get("/api/v1/sessions/session-2")

    assert session_detail.status_code == 200
    body = session_detail.json()
    assert body["event_count"] == 2
    assert body["events"] == body["event_count"]


def test_session_detail_and_project_drilldown_are_available() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    sessions = client.get("/api/v1/sessions/recent?limit=10")
    session_detail = client.get("/api/v1/sessions/session-2")
    project_ref = sessions.json()["items"][0]["project_ref"]
    project_detail = client.get(f"/api/v1/projects/{project_ref}")
    project_sessions = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")

    assert session_detail.status_code == 200
    assert session_detail.json()["session_id"] == "session-2"
    assert session_detail.json()["project_name"] == "demo-api"
    assert session_detail.json()["event_count"] == 2
    assert session_detail.json()["active_ms"] == 40000
    assert session_detail.json()["wait_ms"] == 12000
    assert session_detail.json()["last_host"] == "codex"
    assert session_detail.json()["last_model_name"] == "gpt-5.4"
    assert session_detail.json()["last_git_branch"] == "main"
    assert session_detail.json()["last_event_time"] == "2026-04-05T13:05:00Z"
    assert session_detail.json()["languages"] == [
        {"name": "Python", "added": 7, "removed": 1, "changed": 8}
    ]
    assert session_detail.json()["file_deltas"] == [
        {"fingerprint": "py-demo", "language": "Python", "added": 7, "removed": 1}
    ]
    assert session_detail.json()["file_preview"] == [
        {"fingerprint": "py-demo", "language": "Python", "added": 7, "removed": 1}
    ]
    assert session_detail.json()["file_preview_truncated_count"] == 0
    assert session_detail.json()["changed_files_count"] == 1
    assert session_detail.json()["changed_languages_count"] == 1
    assert session_detail.json()["lines_added"] == 7
    assert session_detail.json()["lines_removed"] == 1
    assert session_detail.json()["lines_changed"] == 8
    assert session_detail.json()["top_language"] == {"name": "Python", "changed": 8}

    assert project_detail.status_code == 200
    assert project_detail.json()["project_name"] == "demo-api"
    assert project_detail.json()["project_ref"] == project_ref
    assert project_detail.json()["active_ms"] == 40000
    assert project_detail.json()["wait_ms"] == 12000
    assert project_detail.json()["event_count"] == 2
    assert project_detail.json()["events"] == project_detail.json()["event_count"]
    assert project_detail.json()["session_count"] == 1
    assert project_detail.json()["last_host"] == "codex"
    assert project_detail.json()["last_model_name"] == "gpt-5.4"
    assert project_detail.json()["last_git_branch"] == "main"
    assert project_detail.json()["languages"] == [
        {"name": "Python", "added": 7, "removed": 1, "changed": 8}
    ]
    assert project_detail.json()["file_preview"] == [
        {"fingerprint": "py-demo", "language": "Python", "added": 7, "removed": 1}
    ]
    assert project_detail.json()["file_preview_truncated_count"] == 0
    assert project_detail.json()["changed_files_count"] == 1
    assert project_detail.json()["changed_languages_count"] == 1
    assert project_detail.json()["lines_added"] == 7
    assert project_detail.json()["lines_removed"] == 1
    assert project_detail.json()["lines_changed"] == 8
    assert project_detail.json()["top_language"] == {"name": "Python", "changed": 8}
    assert "sessions" not in project_detail.json()

    assert project_sessions.status_code == 200
    assert project_sessions.json()["project_name"] == "demo-api"
    assert project_sessions.json()["project_ref"] == project_ref
    assert project_sessions.json()["items"][0]["session_id"] == "session-2"
    assert project_sessions.json()["items"][0]["active_ms"] == 40000
    assert "languages" not in project_sessions.json()["items"][0]
    assert "file_deltas" not in project_sessions.json()["items"][0]
    assert "active_ms" not in project_sessions.json() or project_sessions.json()["active_ms"] == 0


def test_session_detail_keeps_full_file_deltas_and_truncates_preview_to_top_three() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = "/workspace/preview-demo"
    project_ref = compute_project_ref(project_root)
    payload = {
        "events": [
            {
                "event_id": "preview-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-preview",
                "project_root": project_root,
                "project_name": "preview-demo",
                "git_branch": "main",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T11:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 7000,
                "wait_ms": 1000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [
                    {
                        "fingerprint": "delta-a",
                        "language": "TypeScript",
                        "added": 6,
                        "removed": 1,
                    },
                    {
                        "fingerprint": "delta-b",
                        "language": "Python",
                        "added": 4,
                        "removed": 0,
                    },
                ],
            },
            {
                "event_id": "preview-2",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-preview",
                "project_root": project_root,
                "project_name": "preview-demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T11:05:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 5000,
                "wait_ms": 2000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [
                    {
                        "fingerprint": "delta-c",
                        "language": "Go",
                        "added": 3,
                        "removed": 2,
                    },
                    {
                        "fingerprint": "delta-d",
                        "language": "Markdown",
                        "added": 1,
                        "removed": 1,
                    },
                ],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    response = client.get(f"/api/v1/sessions/session-preview?project_ref={project_ref}")
    project_response = client.get(f"/api/v1/projects/{project_ref}")

    assert response.status_code == 200
    assert project_response.status_code == 200
    body = response.json()
    project_body = project_response.json()
    assert body["changed_files_count"] == 4
    assert body["file_deltas"] == [
        {"fingerprint": "delta-a", "language": "TypeScript", "added": 6, "removed": 1},
        {"fingerprint": "delta-c", "language": "Go", "added": 3, "removed": 2},
        {"fingerprint": "delta-b", "language": "Python", "added": 4, "removed": 0},
        {"fingerprint": "delta-d", "language": "Markdown", "added": 1, "removed": 1},
    ]
    assert body["file_preview"] == body["file_deltas"][:3]
    assert body["file_preview_truncated_count"] == 1
    assert body["changed_files_count"] == len(body["file_preview"]) + body["file_preview_truncated_count"]
    assert project_body["changed_files_count"] == len(project_body["file_preview"]) + project_body["file_preview_truncated_count"]


def test_recent_and_project_sessions_roll_up_by_project_and_session() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)

    recent = client.get("/api/v1/sessions/recent?limit=10")
    project_ref = compute_project_ref(project_root)
    project_sessions = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")

    assert recent.status_code == 200
    assert len(recent.json()["items"]) == 1
    assert recent.json()["items"][0]["session_id"] == "session-rollup"
    assert recent.json()["items"][0]["events"] == 2
    assert recent.json()["items"][0]["active_ms"] == 20000
    assert recent.json()["items"][0]["wait_ms"] == 6000

    assert project_sessions.status_code == 200
    assert len(project_sessions.json()["items"]) == 1
    assert project_sessions.json()["items"][0]["session_id"] == "session-rollup"
    assert project_sessions.json()["items"][0]["events"] == 2
    assert project_sessions.json()["items"][0]["active_ms"] == 20000
    assert project_sessions.json()["items"][0]["wait_ms"] == 6000


def test_session_routes_keep_list_and_detail_rollups_aligned_for_mixed_host_model_sessions() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)
    project_ref = compute_project_ref(project_root)

    recent = client.get("/api/v1/sessions/recent?limit=10")
    project_sessions = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")
    session_detail = client.get(f"/api/v1/sessions/session-rollup?project_ref={project_ref}")
    project_detail = client.get(f"/api/v1/projects/{project_ref}")

    assert recent.status_code == 200
    assert project_sessions.status_code == 200
    assert session_detail.status_code == 200
    assert project_detail.status_code == 200

    recent_item = recent.json()["items"][0]
    project_session_item = project_sessions.json()["items"][0]
    detail = session_detail.json()
    project = project_detail.json()

    assert recent_item["host"] == "claude-code"
    assert recent_item["last_host"] == "claude-code"
    assert recent_item["model_name"] == "claude-sonnet"
    assert recent_item["last_model_name"] == "claude-sonnet"
    assert recent_item["git_branch"] == "main"
    assert recent_item["last_git_branch"] == "main"
    assert recent_item["host_model_primary"] == recent_item["host_model_mix"][0]

    assert project_session_item["host"] == recent_item["host"]
    assert project_session_item["last_host"] == recent_item["last_host"]
    assert project_session_item["model_name"] == recent_item["model_name"]
    assert project_session_item["last_model_name"] == recent_item["last_model_name"]
    assert project_session_item["git_branch"] == recent_item["git_branch"]
    assert project_session_item["last_git_branch"] == recent_item["last_git_branch"]
    assert project_session_item["changed_files_count"] == recent_item["changed_files_count"]
    assert project_session_item["changed_languages_count"] == recent_item["changed_languages_count"]
    assert project_session_item["lines_changed"] == recent_item["lines_changed"]
    assert project_session_item["top_language"] == recent_item["top_language"]
    assert project_session_item["host_model_mix"] == recent_item["host_model_mix"]

    assert detail["host"] == recent_item["host"]
    assert detail["last_host"] == recent_item["last_host"]
    assert detail["model_name"] == recent_item["model_name"]
    assert detail["last_model_name"] == recent_item["last_model_name"]
    assert detail["git_branch"] == recent_item["git_branch"]
    assert detail["last_git_branch"] == recent_item["last_git_branch"]
    assert detail["changed_files_count"] == recent_item["changed_files_count"]
    assert detail["changed_languages_count"] == recent_item["changed_languages_count"]
    assert detail["lines_changed"] == recent_item["lines_changed"]
    assert detail["top_language"] == recent_item["top_language"]
    assert detail["host_model_mix"] == recent_item["host_model_mix"]

    assert project["session_count"] == 1
    assert project["changed_files_count"] == detail["changed_files_count"]
    assert project["changed_languages_count"] == detail["changed_languages_count"]
    assert project["lines_changed"] == detail["lines_changed"]
    assert project["top_language"] == detail["top_language"]
    assert project["host_model_mix"] == detail["host_model_mix"]


def test_detail_routes_expose_last_event_scalars_and_primary_host_model_separately() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = "/workspace/mixed-detail-demo"
    project_ref = compute_project_ref(project_root)
    payload = {
        "events": [
            {
                "event_id": "mixed-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-mixed",
                "project_root": project_root,
                "project_name": "mixed-detail-demo",
                "git_branch": "feat/primary",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T10:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 12_000,
                "wait_ms": 3_000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "mixed-2",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-mixed",
                "project_root": project_root,
                "project_name": "mixed-detail-demo",
                "git_branch": "feat/latest",
                "event_name": "stop",
                "event_time": "2026-04-05T10:05:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 6_000,
                "wait_ms": 1_000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    ingest = client.post("/api/v1/events/batch", json=payload)
    assert ingest.status_code == 202

    session_detail = client.get(f"/api/v1/sessions/session-mixed?project_ref={project_ref}")
    project_detail = client.get(f"/api/v1/projects/{project_ref}")

    assert session_detail.status_code == 200
    assert project_detail.status_code == 200

    session_body = session_detail.json()
    project_body = project_detail.json()

    assert session_body["host"] == "claude-code"
    assert session_body["last_host"] == "claude-code"
    assert session_body["model_name"] == "claude-sonnet"
    assert session_body["last_model_name"] == "claude-sonnet"
    assert session_body["git_branch"] == "feat/latest"
    assert session_body["last_git_branch"] == "feat/latest"
    assert session_body["last_event_time"] == "2026-04-05T10:05:00Z"
    assert session_body["host_model_mix_count"] == 2
    assert session_body["host_model_primary"] == {
        "host": "codex",
        "model_name": "gpt-5.4",
        "events": 1,
        "active_ms": 12000,
        "wait_ms": 3000,
    }

    assert project_body["last_host"] == "claude-code"
    assert project_body["last_model_name"] == "claude-sonnet"
    assert project_body["last_git_branch"] == "feat/latest"
    assert project_body["last_event_time"] == "2026-04-05T10:05:00Z"
    assert project_body["host_model_mix_count"] == 2
    assert project_body["host_model_primary"] == {
        "host": "codex",
        "model_name": "gpt-5.4",
        "events": 1,
        "active_ms": 12000,
        "wait_ms": 3000,
    }


def test_session_list_routes_keep_latest_scalar_aliases_distinct_from_primary_host_model() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = "/workspace/mixed-list-demo"
    project_ref = compute_project_ref(project_root)
    payload = {
        "events": [
            {
                "event_id": "mixed-list-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-mixed-list",
                "project_root": project_root,
                "project_name": "mixed-list-demo",
                "git_branch": "feat/primary",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T09:55:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 15_000,
                "wait_ms": 4_000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "mixed-list-2",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-mixed-list",
                "project_root": project_root,
                "project_name": "mixed-list-demo",
                "git_branch": "feat/latest",
                "event_name": "stop",
                "event_time": "2026-04-05T10:05:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 2_000,
                "wait_ms": 500,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    ingest = client.post("/api/v1/events/batch", json=payload)
    assert ingest.status_code == 202

    recent = client.get("/api/v1/sessions/recent?limit=10")
    project_sessions = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")

    assert recent.status_code == 200
    assert project_sessions.status_code == 200

    recent_item = recent.json()["items"][0]
    project_item = project_sessions.json()["items"][0]

    for item in (recent_item, project_item):
        assert item["host"] == "claude-code"
        assert item["last_host"] == "claude-code"
        assert item["model_name"] == "claude-sonnet"
        assert item["last_model_name"] == "claude-sonnet"
        assert item["git_branch"] == "feat/latest"
        assert item["last_git_branch"] == "feat/latest"
        assert item["host_model_mix_count"] == 2
        assert item["host_model_primary"] == {
            "host": "codex",
            "model_name": "gpt-5.4",
            "events": 1,
            "active_ms": 15000,
            "wait_ms": 4000,
        }
        assert item["host_model_primary"]["host"] != item["last_host"]
        assert item["host_model_primary"]["model_name"] != item["last_model_name"]


def test_session_list_routes_support_opt_in_compact_mode_without_host_model_mix() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = "/workspace/mixed-list-demo"
    project_ref = compute_project_ref(project_root)
    payload = {
        "events": [
            {
                "event_id": "mixed-list-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-mixed-list",
                "project_root": project_root,
                "project_name": "mixed-list-demo",
                "git_branch": "feat/primary",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T09:55:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 15_000,
                "wait_ms": 4_000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "mixed-list-2",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-mixed-list",
                "project_root": project_root,
                "project_name": "mixed-list-demo",
                "git_branch": "feat/latest",
                "event_name": "stop",
                "event_time": "2026-04-05T10:05:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 2_000,
                "wait_ms": 500,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    recent = client.get("/api/v1/sessions/recent?limit=10&compact=true")
    project_sessions = client.get(
        f"/api/v1/projects/{project_ref}/sessions?limit=10&compact=true"
    )

    assert recent.status_code == 200
    assert project_sessions.status_code == 200

    for item in (recent.json()["items"][0], project_sessions.json()["items"][0]):
        assert "host_model_mix" not in item
        assert item["host"] == "claude-code"
        assert item["last_host"] == "claude-code"
        assert item["model_name"] == "claude-sonnet"
        assert item["last_model_name"] == "claude-sonnet"
        assert item["git_branch"] == "feat/latest"
        assert item["last_git_branch"] == "feat/latest"
        assert item["host_model_mix_count"] == 2
        assert item["host_model_primary"] == {
            "host": "codex",
            "model_name": "gpt-5.4",
            "events": 1,
            "active_ms": 15000,
            "wait_ms": 4000,
        }
        assert item["host_model_primary"]["host"] != item["last_host"]
        assert item["host_model_primary"]["model_name"] != item["last_model_name"]


def test_session_list_routes_treat_compact_false_as_the_default_full_contract() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    default_sessions = client.get("/api/v1/sessions/recent?limit=10")
    explicit_full_sessions = client.get("/api/v1/sessions/recent?limit=10&compact=false")

    assert default_sessions.status_code == 200
    assert explicit_full_sessions.status_code == 200
    assert explicit_full_sessions.json() == default_sessions.json()


def test_project_detail_exposes_compact_summary_fields() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)
    project_ref = compute_project_ref(project_root)

    response = client.get(f"/api/v1/projects/{project_ref}")

    assert response.status_code == 200
    body = response.json()
    assert body["project_name"] == "rollup-demo"
    assert body["project_ref"] == project_ref
    assert body["session_count"] == 1
    assert body["host_model_mix"] == [
        {
            "host": "claude-code",
            "model_name": "claude-sonnet",
            "events": 1,
            "active_ms": 12000,
            "wait_ms": 4000,
        },
        {
            "host": "codex",
            "model_name": "gpt-5.4",
            "events": 1,
            "active_ms": 8000,
            "wait_ms": 2000,
        },
    ]
    assert body["languages"] == [
        {"name": "TypeScript", "added": 7, "removed": 2, "changed": 9},
        {"name": "Python", "added": 5, "removed": 1, "changed": 6},
    ]
    assert body["changed_files_count"] == 2
    assert body["changed_languages_count"] == 2
    assert body["lines_added"] == 12
    assert body["lines_removed"] == 3
    assert body["lines_changed"] == 15
    assert body["top_language"] == {"name": "TypeScript", "changed": 9}
    assert body["file_preview"] == [
        {"fingerprint": "ts-rollup", "language": "TypeScript", "added": 7, "removed": 2},
        {"fingerprint": "py-rollup", "language": "Python", "added": 5, "removed": 1},
    ]
    assert body["file_preview_truncated_count"] == 0
    assert "sessions" not in body


def test_project_sessions_only_return_summary_session_items() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)
    project_ref = compute_project_ref(project_root)

    response = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")

    assert response.status_code == 200
    body = response.json()
    # Keep this endpoint summary-first: detail-only fields still belong on
    # `/api/v1/sessions/{session_id}`, while the list contract remains backward-compatible.
    assert body == {
        "project_name": "rollup-demo",
        "project_ref": project_ref,
        "items": [
            {
                "session_id": "session-rollup",
                "project_name": "rollup-demo",
                "project_ref": project_ref,
                "host": "claude-code",
                "last_host": "claude-code",
                "model_name": "claude-sonnet",
                "last_model_name": "claude-sonnet",
                "git_branch": "main",
                "last_git_branch": "main",
                "first_event_time": "2026-04-05T10:00:00Z",
                "last_event_time": "2026-04-05T10:05:00Z",
                "event_count": 2,
                "events": 2,
                "active_ms": 20000,
                "wait_ms": 6000,
                "changed_files_count": 2,
                "changed_languages_count": 2,
                "lines_added": 12,
                "lines_removed": 3,
                "lines_changed": 15,
                "top_language": {"name": "TypeScript", "changed": 9},
                "host_model_mix": [
                    {
                        "host": "claude-code",
                        "model_name": "claude-sonnet",
                        "events": 1,
                        "active_ms": 12000,
                        "wait_ms": 4000,
                    },
                    {
                        "host": "codex",
                        "model_name": "gpt-5.4",
                        "events": 1,
                        "active_ms": 8000,
                        "wait_ms": 2000,
                    },
                ],
                "host_model_mix_count": 2,
                "host_model_primary": {
                    "host": "claude-code",
                    "model_name": "claude-sonnet",
                    "events": 1,
                    "active_ms": 12000,
                    "wait_ms": 4000,
                },
            }
        ],
    }


def test_project_sessions_treat_compact_false_as_the_default_full_contract() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)
    project_ref = compute_project_ref(project_root)

    default_project_sessions = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")
    explicit_full_project_sessions = client.get(
        f"/api/v1/projects/{project_ref}/sessions?limit=10&compact=false"
    )

    assert default_project_sessions.status_code == 200
    assert explicit_full_project_sessions.status_code == 200
    assert explicit_full_project_sessions.json() == default_project_sessions.json()


def test_project_routes_use_one_canonical_project_name_per_project_root() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = "/workspace/project-name-collision"
    project_ref = compute_project_ref(project_root)
    payload = {
        "events": [
            {
                "event_id": "name-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-older",
                "project_root": project_root,
                "project_name": "zeta-demo",
                "git_branch": "main",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T09:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 4000,
                "wait_ms": 1000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "name-2",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-newer",
                "project_root": project_root,
                "project_name": "alpha-demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T10:00:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 9000,
                "wait_ms": 2000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    projects = client.get("/api/v1/projects/top?limit=5")
    project_detail = client.get(f"/api/v1/projects/{project_ref}")
    project_sessions = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")

    assert projects.status_code == 200
    assert project_detail.status_code == 200
    assert project_sessions.status_code == 200

    assert projects.json()["items"][0]["project_name"] == "zeta-demo"
    assert project_detail.json()["project_name"] == "zeta-demo"
    assert project_sessions.json()["project_name"] == "zeta-demo"
    assert [item["project_name"] for item in project_sessions.json()["items"]] == [
        "zeta-demo",
        "zeta-demo",
    ]


def test_session_detail_uses_project_root_canonical_project_name() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = "/workspace/project-name-collision"
    project_ref = compute_project_ref(project_root)
    payload = {
        "events": [
            {
                "event_id": "name-session-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-older",
                "project_root": project_root,
                "project_name": "zeta-demo",
                "git_branch": "main",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T09:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 4000,
                "wait_ms": 1000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "name-session-2",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-newer",
                "project_root": project_root,
                "project_name": "alpha-demo",
                "git_branch": "main",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T10:00:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 9000,
                "wait_ms": 2000,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "name-session-3",
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-newer",
                "project_root": project_root,
                "project_name": "alpha-demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T10:05:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 3000,
                "wait_ms": 500,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    session_detail = client.get(f"/api/v1/sessions/session-newer?project_ref={project_ref}")

    assert session_detail.status_code == 200
    assert session_detail.json()["project_name"] == "zeta-demo"


def test_top_projects_and_recent_sessions_keep_compact_list_contracts() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    projects = client.get("/api/v1/projects/top?limit=5")
    sessions = client.get("/api/v1/sessions/recent?limit=10")

    assert projects.status_code == 200
    assert sessions.status_code == 200

    project_item = projects.json()["items"][0]
    session_item = sessions.json()["items"][0]

    assert set(project_item) == {
        "project_name",
        "project_ref",
        "event_count",
        "events",
        "active_ms",
        "wait_ms",
        "changed_files_count",
        "changed_languages_count",
        "lines_added",
        "lines_removed",
        "lines_changed",
        "top_language",
        "host_model_mix_count",
        "host_model_primary",
    }
    assert project_item["event_count"] == project_item["events"]
    assert "languages" not in project_item
    assert "file_deltas" not in project_item
    assert "file_preview" not in project_item
    assert "file_preview_truncated_count" not in project_item
    assert "session_count" not in project_item
    assert "last_event_time" not in project_item

    assert set(session_item) == {
        "session_id",
        "project_name",
        "project_ref",
        "host",
        "last_host",
        "model_name",
        "last_model_name",
        "git_branch",
        "last_git_branch",
        "first_event_time",
        "last_event_time",
        "event_count",
        "events",
        "active_ms",
        "wait_ms",
        "changed_files_count",
        "changed_languages_count",
        "lines_added",
        "lines_removed",
        "lines_changed",
        "top_language",
        "host_model_mix",
        "host_model_mix_count",
        "host_model_primary",
    }
    assert "languages" not in session_item
    assert "file_deltas" not in session_item
    assert "file_preview" not in session_item
    assert "file_preview_truncated_count" not in session_item


def test_summary_routes_match_the_shared_dashboard_contract_artifact() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    contract = load_dashboard_compatibility_contract()

    seed_event(client)

    language_item = client.get("/api/v1/breakdown/languages").json()["items"][0]
    model_item = client.get("/api/v1/breakdown/models").json()["items"][0]
    host_item = client.get("/api/v1/breakdown/hosts").json()["items"][0]
    project_item = client.get("/api/v1/projects/top?limit=5").json()["items"][0]
    timeseries_item = client.get("/api/v1/timeseries").json()["items"][0]

    assert_contract_fields(language_item, contract["languageBreakdownItem"])
    assert_contract_fields(model_item, contract["modelBreakdownItem"])
    assert_contract_fields(host_item, contract["hostBreakdownItem"])
    assert_contract_fields(project_item, contract["projectTopItem"])
    assert_contract_fields(timeseries_item, contract["timeseriesItem"])


def test_session_list_compact_mode_omits_host_model_mix_but_keeps_summary_fields() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    sessions = client.get("/api/v1/sessions/recent?limit=10&compact=true")

    assert sessions.status_code == 200

    session_item = sessions.json()["items"][0]

    assert set(session_item) == {
        "session_id",
        "project_name",
        "project_ref",
        "host",
        "last_host",
        "model_name",
        "last_model_name",
        "git_branch",
        "last_git_branch",
        "first_event_time",
        "last_event_time",
        "event_count",
        "events",
        "active_ms",
        "wait_ms",
        "changed_files_count",
        "changed_languages_count",
        "lines_added",
        "lines_removed",
        "lines_changed",
        "top_language",
        "host_model_mix_count",
        "host_model_primary",
    }
    assert "host_model_mix" not in session_item
    assert "languages" not in session_item
    assert "file_deltas" not in session_item
    assert "file_preview" not in session_item
    assert "file_preview_truncated_count" not in session_item


def test_recent_session_list_compact_mode_keeps_all_shared_summary_fields_equal_to_full_mode() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    full_item = client.get("/api/v1/sessions/recent?limit=10").json()["items"][0]
    compact_item = client.get("/api/v1/sessions/recent?limit=10&compact=true").json()["items"][0]

    assert compact_item == {
        key: value for key, value in full_item.items() if key != "host_model_mix"
    }


def test_project_session_list_compact_mode_keeps_all_shared_summary_fields_equal_to_full_mode() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)
    project_ref = compute_project_ref(project_root)

    full_item = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10").json()["items"][0]
    compact_item = client.get(
        f"/api/v1/projects/{project_ref}/sessions?limit=10&compact=true"
    ).json()["items"][0]

    assert compact_item == {
        key: value for key, value in full_item.items() if key != "host_model_mix"
    }


def test_project_session_list_compact_mode_keeps_top_level_envelope_parity_with_full_mode() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)
    project_ref = compute_project_ref(project_root)

    full_response = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")
    compact_response = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10&compact=true")

    assert full_response.status_code == 200
    assert compact_response.status_code == 200
    assert compact_response.json() == {
        **full_response.json(),
        "items": [
            {key: value for key, value in item.items() if key != "host_model_mix"}
            for item in full_response.json()["items"]
        ],
    }


def test_session_detail_requires_project_ref_when_session_id_is_ambiguous() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "event_id": "shared-1",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "shared",
                "project_root": "/workspace/demo-a",
                "project_name": "demo-a",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T09:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 100,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "shared-2",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "shared",
                "project_root": "/workspace/demo-b",
                "project_name": "demo-b",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T10:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 2000,
                "wait_ms": 200,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
        ]
    }

    assert client.post("/api/v1/events/batch", json=payload).status_code == 202

    ambiguous = client.get("/api/v1/sessions/shared")
    recent = client.get("/api/v1/sessions/recent?limit=10").json()
    project_ref = recent["items"][0]["project_ref"]
    scoped = client.get(f"/api/v1/sessions/shared?project_ref={project_ref}")

    assert ambiguous.status_code == 409
    assert ambiguous.json() == {
        "detail": {
            "code": "ambiguous_session",
            "message": "session_id matched multiple projects",
            "hint": "Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent.",
        }
    }
    assert scoped.status_code == 200
    assert scoped.json()["project_ref"] == project_ref


def test_missing_project_uses_machine_readable_not_found_contract() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/projects/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "project_not_found",
            "message": "project was not found",
            "hint": "Fetch a valid project_ref from /api/v1/projects/top or /api/v1/sessions/recent.",
        }
    }


def test_project_sessions_missing_project_uses_machine_readable_not_found_contract() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/projects/does-not-exist/sessions")

    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "project_not_found",
            "message": "project was not found",
            "hint": "Fetch a valid project_ref from /api/v1/projects/top or /api/v1/sessions/recent.",
        }
    }


def test_missing_session_uses_machine_readable_not_found_contract() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/sessions/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "session_not_found",
            "message": "session was not found",
            "hint": "Retry with a valid session_id, and include project_ref when the session spans multiple projects.",
        }
    }


def test_missing_project_ref_on_session_detail_uses_project_not_found_contract() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/sessions/does-not-exist?project_ref=does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "project_not_found",
            "message": "project was not found",
            "hint": "Fetch a valid project_ref from /api/v1/projects/top or /api/v1/sessions/recent.",
        }
    }


def test_wrong_project_ref_on_session_detail_uses_session_not_found_contract() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    wrong_project_ref = compute_project_ref("/workspace/demo")
    response = client.get(f"/api/v1/sessions/session-2?project_ref={wrong_project_ref}")

    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "session_not_found",
            "message": "session was not found",
            "hint": "Retry with a valid session_id, and include project_ref when the session spans multiple projects.",
        }
    }


def test_status_endpoint_exposes_minimal_api_db_and_spool_state(
    tmp_path, monkeypatch
) -> None:
    state_dir = tmp_path / "state"
    (state_dir / "spool" / "ready").mkdir(parents=True)
    (state_dir / "spool" / "processing").mkdir(parents=True)
    (state_dir / "spool" / "quarantine").mkdir(parents=True)
    ready_job = state_dir / "spool" / "ready" / "job-1.json"
    processing_job = state_dir / "spool" / "processing" / "job-2.json"
    quarantine_job = state_dir / "spool" / "quarantine" / "job-3.json"
    ready_job.write_text('{"events":[1,2]}', encoding="utf-8")
    processing_job.write_text('{"events":[3]}', encoding="utf-8")
    (state_dir / "spool" / "ready" / "job-1.meta.json").write_text("{}", encoding="utf-8")
    (state_dir / "spool" / "processing" / "job-2.meta.json").write_text("{}", encoding="utf-8")
    quarantine_job.write_text("{}", encoding="utf-8")
    (state_dir / "spool" / "quarantine" / "job-3.meta.json").write_text("{}", encoding="utf-8")
    stale_time = datetime(2026, 4, 5, 12, 0, tzinfo=UTC).timestamp()
    os.utime(ready_job, (stale_time, stale_time))
    os.utime(processing_job, (stale_time + 60, stale_time + 60))
    os.utime(quarantine_job, (stale_time + 120, stale_time + 120))
    monkeypatch.setenv("CLIPULSE_STATE_DIR", str(state_dir))

    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    seed_event(client)

    response = client.get("/api/v1/status")

    assert response.status_code == 200
    body = response.json()
    assert body["api"] == {"status": "ok", "version": "0.1.0"}
    assert body["db"] == {"status": "ok", "events": 3, "projects": 2, "sessions": 2}
    assert body["compat"] == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": get_dashboard_compatibility_contract_hash(),
        "tier": "minimum",
        "surfaces": ["dashboard-summary", "dashboard-detail"],
    }
    assert body["spool"]["state_dir"] == str(state_dir)
    assert body["spool"]["ready"] == 1
    assert body["spool"]["processing"] == 1
    assert body["spool"]["quarantine"] == 1
    assert body["spool"]["ready_bytes"] == ready_job.stat().st_size
    assert body["spool"]["processing_bytes"] == processing_job.stat().st_size
    assert body["spool"]["quarantine_bytes"] == quarantine_job.stat().st_size
    assert body["spool"]["oldest_backlog_age_seconds"] >= 0
    assert body["spool"]["oldest_quarantine_age_seconds"] >= 0


def test_status_endpoint_returns_zeroed_spool_counts_when_state_dir_is_missing(
    tmp_path, monkeypatch
) -> None:
    missing_state_dir = tmp_path / "missing-state"
    monkeypatch.setenv("CLIPULSE_STATE_DIR", str(missing_state_dir))

    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/status")

    assert response.status_code == 200
    assert response.json() == {
        "api": {"status": "ok", "version": "0.1.0"},
        "db": {"status": "ok", "events": 0, "projects": 0, "sessions": 0},
        "compat": {
            "pointer": "/contracts/dashboard-compat.v1.json",
            "hash": get_dashboard_compatibility_contract_hash(),
            "tier": "minimum",
            "surfaces": ["dashboard-summary", "dashboard-detail"],
        },
        "spool": {
            "state_dir": str(missing_state_dir),
            "ready": 0,
            "processing": 0,
            "quarantine": 0,
            "ready_bytes": 0,
            "processing_bytes": 0,
            "quarantine_bytes": 0,
            "oldest_backlog_age_seconds": 0,
            "oldest_quarantine_age_seconds": 0,
        },
    }


def test_status_endpoint_uses_xdg_state_home_fallback_when_explicit_state_dir_is_unset(
    tmp_path, monkeypatch
) -> None:
    xdg_state_home = tmp_path / "xdg-state"
    state_dir = xdg_state_home / "clipulse"
    ready_dir = state_dir / "spool" / "ready"
    ready_dir.mkdir(parents=True)
    ready_job = ready_dir / "job-1.json"
    ready_job.write_text('{"events":[1]}', encoding="utf-8")
    monkeypatch.delenv("CLIPULSE_STATE_DIR", raising=False)
    monkeypatch.setenv("XDG_STATE_HOME", str(xdg_state_home))

    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/status")

    assert response.status_code == 200
    assert response.json()["spool"] == {
        "state_dir": str(state_dir),
        "ready": 1,
        "processing": 0,
        "quarantine": 0,
        "ready_bytes": ready_job.stat().st_size,
        "processing_bytes": 0,
        "quarantine_bytes": 0,
        "oldest_backlog_age_seconds": response.json()["spool"]["oldest_backlog_age_seconds"],
        "oldest_quarantine_age_seconds": 0,
    }
    assert response.json()["spool"]["oldest_backlog_age_seconds"] >= 0


def test_status_endpoint_uses_home_fallback_when_explicit_and_xdg_are_unset(
    tmp_path, monkeypatch
) -> None:
    home_dir = tmp_path / "custom-home"
    state_dir = home_dir / ".local" / "state" / "clipulse"
    quarantine_dir = state_dir / "spool" / "quarantine"
    quarantine_dir.mkdir(parents=True)
    quarantine_job = quarantine_dir / "job-1.json"
    quarantine_job.write_text("{}", encoding="utf-8")
    monkeypatch.delenv("CLIPULSE_STATE_DIR", raising=False)
    monkeypatch.delenv("XDG_STATE_HOME", raising=False)
    monkeypatch.setenv("HOME", str(home_dir))

    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/status")

    assert response.status_code == 200
    assert response.json()["spool"] == {
        "state_dir": str(state_dir),
        "ready": 0,
        "processing": 0,
        "quarantine": 1,
        "ready_bytes": 0,
        "processing_bytes": 0,
        "quarantine_bytes": quarantine_job.stat().st_size,
        "oldest_backlog_age_seconds": 0,
        "oldest_quarantine_age_seconds": response.json()["spool"]["oldest_quarantine_age_seconds"],
    }
    assert response.json()["spool"]["oldest_quarantine_age_seconds"] >= 0


def test_invalid_event_time_is_rejected_with_422() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "invalid-time",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "not-a-timestamp",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 100,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            }
        ]
    }

    response = client.post("/api/v1/events/batch", json=payload)

    assert response.status_code == 202
    body = response.json()
    assert body["accepted"] == 0
    assert body["duplicates"] == 0
    assert body["invalid"] == 1
    assert body["results"] == [
        {"event_id": body["results"][0]["event_id"], "status": "invalid", "retryable": False}
    ]


def test_overview_today_includes_legacy_offset_timestamps(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_app(database_url)
    client = TestClient(app)
    session_factory = create_session_factory(database_url)
    today_utc = datetime.now(UTC).date()
    legacy_offset_time = f"{today_utc.isoformat()}T00:00:00+00:00"

    with session_factory() as session:
        session.add(
            EventRecord(
                event_id="legacy-offset",
                host="codex",
                host_version="0.1.0",
                session_id="legacy-session",
                project_root="/workspace/demo",
                project_name="demo",
                git_branch="main",
                event_name="stop",
                event_time=legacy_offset_time,
                model_name="gpt-5.4",
                os_name="macos",
                editor_or_terminal="terminal",
                active_ms=1500,
                wait_ms=200,
                privacy_mode="hashed",
            )
        )
        session.commit()

    overview = client.get("/api/v1/overview")

    assert overview.status_code == 200
    assert overview.json()["today"]["events"] == 1
    assert overview.json()["today"]["active_ms"] == 1500
