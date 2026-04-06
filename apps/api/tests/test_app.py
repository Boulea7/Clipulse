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


def test_event_batch_returns_partial_outcomes_without_rejecting_valid_events() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "event_id": "event-valid",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-valid",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:00:00Z",
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
                "event_id": "event-valid",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-duplicate",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:00:01Z",
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
                "event_id": "event-invalid",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-invalid",
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
            },
        ]
    }

    response = client.post("/api/v1/events/batch", json=payload)

    assert response.status_code == 202
    assert response.json() == {
        "accepted": 1,
        "duplicates": 1,
        "invalid": 1,
        "results": [
            {"event_id": "event-valid", "status": "accepted", "retryable": False},
            {"event_id": "event-valid", "status": "duplicate", "retryable": False},
            {"event_id": "event-invalid", "status": "invalid", "retryable": False},
        ],
    }

    overview = client.get("/api/v1/overview")
    assert overview.status_code == 200
    assert overview.json()["totals"]["events"] == 1
