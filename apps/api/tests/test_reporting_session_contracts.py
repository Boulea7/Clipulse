import hashlib

from fastapi.testclient import TestClient

from clipulse_api.app import compute_project_ref, create_app as build_app


def create_reporting_app(database_url: str = "sqlite+pysqlite:///:memory:"):
    return build_app(
        database_url,
        allow_insecure_no_auth=True,
        allow_legacy_event_payloads=True,
    )


def make_file_fingerprint(seed: str) -> str:
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def test_project_routes_stably_aggregate_multiple_sessions_per_project() -> None:
    app = create_reporting_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_multi_session_project(client)
    project_ref = compute_project_ref(project_root)

    projects = client.get("/api/v1/projects/top?limit=5")
    project_detail = client.get(f"/api/v1/projects/{project_ref}")
    project_sessions = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")
    session_detail = client.get(f"/api/v1/sessions/session-beta?project_ref={project_ref}")

    assert projects.status_code == 200
    assert project_detail.status_code == 200
    assert project_sessions.status_code == 200
    assert session_detail.status_code == 200

    project_item = projects.json()["items"][0]
    detail = project_detail.json()
    session_detail_body = session_detail.json()

    assert_project_summary_matches_detail(project_item, detail)

    assert detail["project_name"] == "zeta-stable-demo"
    assert detail["project_ref"] == project_ref
    assert detail["event_count"] == 4
    assert detail["events"] == detail["event_count"]
    assert detail["session_count"] == 2
    assert detail["active_ms"] == 28_000
    assert detail["wait_ms"] == 6_500
    assert detail["last_event_time"] == "2026-04-05T10:10:00Z"
    assert detail["last_host"] == "codex"
    assert detail["last_model_name"] == "gpt-5.4"
    assert detail["last_git_branch"] == "feat/beta-finish"
    assert detail["last_runtime"] == {
        "host": "codex",
        "host_version": "1.0.0",
        "model_name": "gpt-5.4",
        "git_branch": "feat/beta-finish",
        "os_name": "macos",
        "editor_or_terminal": "terminal",
        "privacy_mode": "hashed",
    }
    assert project_item["last_runtime"] == detail["last_runtime"]
    assert session_detail_body["last_runtime"] == detail["last_runtime"]
    assert detail["languages"] == [
        {"name": "TypeScript", "added": 7, "removed": 5, "changed": 12},
        {"name": "Python", "added": 5, "removed": 1, "changed": 6},
    ]
    assert detail["file_preview"] == [
        {"fingerprint": make_file_fingerprint("app-ts"), "language": "TypeScript", "added": 6, "removed": 1},
        {"fingerprint": make_file_fingerprint("shared-py"), "language": "Python", "added": 5, "removed": 1},
        {"fingerprint": make_file_fingerprint("server-ts"), "language": "TypeScript", "added": 1, "removed": 4},
    ]
    assert detail["file_preview_truncated_count"] == 0
    assert detail["changed_files_count"] == 3
    assert detail["changed_languages_count"] == 2
    assert detail["lines_added"] == 12
    assert detail["lines_removed"] == 6
    assert detail["lines_changed"] == 18
    assert detail["top_language"] == {"name": "TypeScript", "changed": 12}
    assert detail["host_model_mix"] == [
        {
            "host": "codex",
            "model_name": "gpt-5.4",
            "events": 3,
            "active_ms": 23_000,
            "wait_ms": 5_500,
        },
        {
            "host": "claude-code",
            "model_name": "claude-sonnet",
            "events": 1,
            "active_ms": 5_000,
            "wait_ms": 1_000,
        },
    ]
    assert detail["host_model_mix_count"] == 2
    assert detail["host_model_primary"] == detail["host_model_mix"][0]

    project_sessions_body = project_sessions.json()
    assert project_sessions_body["project_name"] == "zeta-stable-demo"
    assert project_sessions_body["project_ref"] == project_ref
    assert project_sessions_body["items"][0]["last_runtime"] == detail["last_runtime"]
    assert [item["session_id"] for item in project_sessions_body["items"]] == [
        "session-beta",
        "session-alpha",
    ]


def test_session_list_routes_keep_compact_and_full_items_in_parity_by_session_key() -> None:
    app = create_reporting_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    project_root = seed_multi_session_project(client)
    project_ref = compute_project_ref(project_root)

    recent_full = client.get("/api/v1/sessions/recent?limit=10")
    recent_compact = client.get("/api/v1/sessions/recent?limit=10&compact=true")
    project_full = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10")
    project_compact = client.get(f"/api/v1/projects/{project_ref}/sessions?limit=10&compact=true")

    assert recent_full.status_code == 200
    assert recent_compact.status_code == 200
    assert project_full.status_code == 200
    assert project_compact.status_code == 200

    assert_compact_session_list_parity_by_session_key(
        recent_full.json()["items"],
        recent_compact.json()["items"],
    )
    assert_compact_session_list_parity_by_session_key(
        project_full.json()["items"],
        project_compact.json()["items"],
    )


def test_recent_session_list_parity_supports_repeated_session_ids_across_projects() -> None:
    app = create_reporting_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    post_events(
        client,
        [
            make_event(
                event_id="shared-a-1",
                session_id="shared",
                project_root="/workspace/demo-a",
                project_name="demo-a",
                git_branch="main",
                event_time="2026-04-05T09:00:00Z",
                host="codex",
                model_name="gpt-5.4",
                active_ms=6_000,
                wait_ms=500,
                language_stats={},
                file_deltas=[],
                event_name="post_tool_use",
            ),
            make_event(
                event_id="shared-b-1",
                session_id="shared",
                project_root="/workspace/demo-b",
                project_name="demo-b",
                git_branch="main",
                event_time="2026-04-05T09:00:00Z",
                host="claude-code",
                model_name="claude-sonnet",
                active_ms=4_000,
                wait_ms=700,
                language_stats={},
                file_deltas=[],
                event_name="post_tool_use",
            ),
        ],
    )

    recent_full = client.get("/api/v1/sessions/recent?limit=10")
    recent_compact = client.get("/api/v1/sessions/recent?limit=10&compact=true")

    assert recent_full.status_code == 200
    assert recent_compact.status_code == 200

    full_items = recent_full.json()["items"]
    compact_items = recent_compact.json()["items"]

    expected_session_keys = sorted(
        [
            (compute_project_ref("/workspace/demo-a"), "shared"),
            (compute_project_ref("/workspace/demo-b"), "shared"),
        ]
    )

    assert [(item["project_ref"], item["session_id"]) for item in full_items] == expected_session_keys
    assert [(item["project_ref"], item["session_id"]) for item in compact_items] == expected_session_keys
    assert_compact_session_list_parity_by_session_key(full_items, compact_items)


def seed_multi_session_project(client: TestClient) -> str:
    project_root = "/workspace/stable-project-aggregation"
    post_events(
        client,
        [
            make_event(
                event_id="stable-1",
                session_id="session-alpha",
                project_root=project_root,
                project_name="zeta-stable-demo",
                git_branch="feat/alpha-start",
                event_time="2026-04-05T09:00:00Z",
                host="codex",
                model_name="gpt-5.4",
                active_ms=10_000,
                wait_ms=2_000,
                language_stats={"Python": {"added": 3, "removed": 1, "changed": 4}},
                file_deltas=[
                    {
                        "fingerprint": make_file_fingerprint("shared-py"),
                        "language": "Python",
                        "added": 3,
                        "removed": 1,
                    }
                ],
                event_name="post_tool_use",
            ),
            make_event(
                event_id="stable-2",
                session_id="session-alpha",
                project_root=project_root,
                project_name="alpha-stable-demo",
                git_branch="feat/alpha-finish",
                event_time="2026-04-05T09:05:00Z",
                host="claude-code",
                model_name="claude-sonnet",
                active_ms=5_000,
                wait_ms=1_000,
                language_stats={"TypeScript": {"added": 6, "removed": 1, "changed": 7}},
                file_deltas=[
                    {
                        "fingerprint": make_file_fingerprint("app-ts"),
                        "language": "TypeScript",
                        "added": 6,
                        "removed": 1,
                    }
                ],
                event_name="stop",
            ),
            make_event(
                event_id="stable-3",
                session_id="session-beta",
                project_root=project_root,
                project_name="alpha-stable-demo",
                git_branch="feat/beta-start",
                event_time="2026-04-05T10:00:00Z",
                host="codex",
                model_name="gpt-5.4",
                active_ms=9_000,
                wait_ms=3_000,
                language_stats={"Python": {"added": 2, "removed": 0, "changed": 2}},
                file_deltas=[
                    {
                        "fingerprint": make_file_fingerprint("shared-py"),
                        "language": "Python",
                        "added": 2,
                        "removed": 0,
                    }
                ],
                event_name="post_tool_use",
            ),
            make_event(
                event_id="stable-4",
                session_id="session-beta",
                project_root=project_root,
                project_name="alpha-stable-demo",
                git_branch="feat/beta-finish",
                event_time="2026-04-05T10:10:00Z",
                host="codex",
                model_name="gpt-5.4",
                active_ms=4_000,
                wait_ms=500,
                language_stats={"TypeScript": {"added": 1, "removed": 4, "changed": 5}},
                file_deltas=[
                    {
                        "fingerprint": make_file_fingerprint("server-ts"),
                        "language": "TypeScript",
                        "added": 1,
                        "removed": 4,
                    }
                ],
                event_name="stop",
            ),
        ],
    )
    return project_root


def post_events(client: TestClient, events: list[dict[str, object]]) -> None:
    response = client.post("/api/v1/events/batch", json={"events": events})
    assert response.status_code == 202


def make_event(
    *,
    event_id: str,
    session_id: str,
    project_root: str,
    project_name: str,
    git_branch: str,
    event_time: str,
    host: str,
    model_name: str,
    active_ms: int,
    wait_ms: int,
    language_stats: dict[str, dict[str, int]],
    file_deltas: list[dict[str, object]],
    event_name: str,
) -> dict[str, object]:
    return {
        "event_id": event_id,
        "host": host,
        "host_version": "1.0.0",
        "session_id": session_id,
        "project_root": project_root,
        "project_name": project_name,
        "git_branch": git_branch,
        "event_name": event_name,
        "event_time": event_time,
        "model_name": model_name,
        "os_name": "macos",
        "editor_or_terminal": "terminal",
        "active_ms": active_ms,
        "wait_ms": wait_ms,
        "privacy_mode": "hashed",
        "language_stats": language_stats,
        "file_deltas": file_deltas,
    }


def assert_project_summary_matches_detail(
    project_item: dict[str, object],
    detail: dict[str, object],
) -> None:
    shared_summary_fields = (
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
    )
    for field_name in shared_summary_fields:
        assert project_item[field_name] == detail[field_name]


def assert_compact_session_list_parity_by_session_key(
    full_items: list[dict[str, object]],
    compact_items: list[dict[str, object]],
) -> None:
    full_by_session_key = index_session_items_by_session_key(full_items)
    compact_by_session_key = index_session_items_by_session_key(compact_items)

    assert compact_by_session_key.keys() == full_by_session_key.keys()

    for session_key, full_item in full_by_session_key.items():
        compact_item = compact_by_session_key[session_key]
        assert "host_model_mix" in full_item
        assert "host_model_mix" not in compact_item
        assert compact_item == {
            key: value for key, value in full_item.items() if key != "host_model_mix"
        }


def index_session_items_by_session_key(
    items: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    indexed_items: dict[tuple[str, str], dict[str, object]] = {}

    for item in items:
        session_key = (str(item["project_ref"]), str(item["session_id"]))
        assert session_key not in indexed_items
        indexed_items[session_key] = item

    return indexed_items
