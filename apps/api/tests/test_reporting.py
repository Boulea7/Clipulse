from datetime import UTC, datetime

from fastapi.testclient import TestClient

from clipulse_api.app import compute_project_ref, create_app
from clipulse_api.database import EventRecord, create_session_factory


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


def test_session_detail_exposes_git_branch() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    seed_event(client)

    project_ref = compute_project_ref("/workspace/demo-api")
    session_detail = client.get(f"/api/v1/sessions/session-2?project_ref={project_ref}")

    assert session_detail.status_code == 200
    assert session_detail.json()["git_branch"] == "main"


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
    assert project_detail.json()["session_count"] == 1
    assert project_detail.json()["languages"] == [
        {"name": "Python", "added": 7, "removed": 1, "changed": 8}
    ]
    assert project_detail.json()["file_preview"] == [
        {"fingerprint": "py-demo", "language": "Python", "added": 7, "removed": 1}
    ]
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
    assert "sessions" not in body


def test_project_sessions_only_return_compact_session_items() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_session_first_rollup_event(client)
    project_ref = compute_project_ref(project_root)

    response = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "project_name": "rollup-demo",
        "project_ref": project_ref,
        "items": [
            {
                "session_id": "session-rollup",
                "project_name": "rollup-demo",
                "project_ref": project_ref,
                "host": "claude-code",
                "model_name": "claude-sonnet",
                "git_branch": "main",
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
    assert scoped.status_code == 200
    assert scoped.json()["project_ref"] == project_ref


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
                event_time="2026-04-06T00:00:00+00:00",
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
