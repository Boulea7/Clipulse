from fastapi.testclient import TestClient

from clipulse_api.app import create_app


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
                "file_deltas": [],
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
                "file_deltas": [],
            },
        ]
    }
    response = client.post("/api/v1/events/batch", json=payload)
    assert response.status_code == 202


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


def test_top_language_badge_returns_svg() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    response = client.get("/api/v1/badges/top-language.svg")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert "TypeScript" in response.text


def test_timeseries_returns_daily_event_totals() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    response = client.get("/api/v1/timeseries")

    assert response.status_code == 200
    assert response.json()["items"][0]["date"] == "2026-04-05"
    assert response.json()["items"][0]["events"] == 2


def test_public_readme_endpoint_returns_markdown_snippet() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/public/readme/top-language")

    assert response.status_code == 200
    assert "![Clipulse" in response.json()["markdown"]
    assert "top-language.svg" in response.json()["markdown"]


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
                "event_time": "2026-04-05T08:00:00Z",
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
                "event_time": "2026-04-05T08:00:00Z",
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

    assert sessions.status_code == 200
    assert sessions.json()["items"][0]["session_id"] == "session-2"
    assert sessions.json()["items"][0]["project_name"] == "demo-api"

    assert today_badge.status_code == 200
    assert today_badge.headers["content-type"].startswith("image/svg+xml")
    assert "today time" in today_badge.text

    assert week_badge.status_code == 200
    assert week_badge.headers["content-type"].startswith("image/svg+xml")
    assert "this week" in week_badge.text
