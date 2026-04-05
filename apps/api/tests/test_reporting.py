from fastapi.testclient import TestClient

from clipulse_api.app import create_app


def seed_event(client: TestClient) -> None:
    payload = {
        "events": [
            {
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
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-2",
                "project_root": "/workspace/demo",
                "project_name": "demo",
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
