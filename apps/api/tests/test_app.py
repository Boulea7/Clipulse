from fastapi.testclient import TestClient

from clipulse_api.app import create_app


def test_empty_overview_returns_zeroed_metrics() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/overview")

    assert response.status_code == 200
    assert response.json()["totals"]["events"] == 0
    assert response.json()["totals"]["active_ms"] == 0
    assert response.json()["totals"]["wait_ms"] == 0


def test_event_batch_updates_overview_and_breakdowns() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "host": "claude-code",
                "host_version": "1.0.0",
                "session_id": "session-1",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "post_tool_use",
                "event_time": "2026-04-05T12:00:00Z",
                "model_name": "claude-sonnet",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 120000,
                "wait_ms": 30000,
                "privacy_mode": "hashed",
                "language_stats": {
                    "TypeScript": {"added": 12, "removed": 2, "changed": 14}
                },
                "file_deltas": [
                    {
                        "fingerprint": "abc123",
                        "language": "TypeScript",
                        "added": 12,
                        "removed": 2,
                    }
                ],
            }
        ]
    }

    ingest = client.post("/api/v1/events/batch", json=payload)
    assert ingest.status_code == 202

    overview = client.get("/api/v1/overview")
    assert overview.status_code == 200
    assert overview.json()["totals"]["events"] == 1
    assert overview.json()["totals"]["active_ms"] == 120000
    assert overview.json()["totals"]["wait_ms"] == 30000

    languages = client.get("/api/v1/breakdown/languages")
    assert languages.status_code == 200
    assert languages.json()["items"][0]["name"] == "TypeScript"
    assert languages.json()["items"][0]["changed"] == 14
