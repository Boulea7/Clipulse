import json
import hashlib
from pathlib import Path
import re

from fastapi.testclient import TestClient

from clipulse_api.app import clamp_list_limit, compute_event_id, create_app


def load_dashboard_compatibility_contract() -> dict[str, object]:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "dashboard-compat.v1.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def get_dashboard_compatibility_contract_hash() -> str:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "dashboard-compat.v1.json"
    return f"sha256:{hashlib.sha256(contract_path.read_bytes()).hexdigest()}"


def test_healthz_returns_204_with_empty_body() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/healthz")

    assert response.status_code == 204
    assert response.content == b""
    assert response.text == ""


def test_healthz_openapi_declares_204_no_content() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    healthz_responses = app.openapi()["paths"]["/healthz"]["get"]["responses"]

    assert "204" in healthz_responses
    assert "200" not in healthz_responses


def test_dashboard_compatibility_contract_is_served_for_browser_runtime() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/contracts/dashboard-compat.v1.json")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == load_dashboard_compatibility_contract()


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


def test_openapi_documents_summary_list_limit_query_semantics() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    openapi = app.openapi()

    projects_parameters = {
        parameter["name"]: parameter
        for parameter in openapi["paths"]["/api/v1/projects/top"]["get"]["parameters"]
    }
    recent_parameters = {
        parameter["name"]: parameter
        for parameter in openapi["paths"]["/api/v1/sessions/recent"]["get"]["parameters"]
    }
    project_sessions_parameters = {
        parameter["name"]: parameter
        for parameter in openapi["paths"]["/api/v1/projects/{project_ref}/sessions"]["get"][
            "parameters"
        ]
    }

    assert "summary-first" in projects_parameters["limit"]["description"].lower()
    assert "summary-first" in recent_parameters["limit"]["description"].lower()
    assert "summary-first" in project_sessions_parameters["limit"]["description"].lower()
    assert "`0` returns an empty list" in projects_parameters["limit"]["description"]
    assert "`0` returns an empty list" in recent_parameters["limit"]["description"]
    assert "`0` returns an empty list" in project_sessions_parameters["limit"]["description"]


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


def test_compute_event_id_normalizes_equivalent_utc_timestamps() -> None:
    payload = {
        "host": "codex",
        "host_version": "0.1.0",
        "session_id": "session-normalized",
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
    }

    equivalent_payload = {
        **payload,
        "event_time": "2026-04-06T12:00:00+00:00",
    }

    assert compute_event_id(payload) == compute_event_id(equivalent_payload)


def test_event_batch_treats_equivalent_utc_timestamp_forms_as_duplicates() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    payload = {
        "events": [
            {
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-normalized",
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
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-normalized",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:00:00+00:00",
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
        "invalid": 0,
        "results": [
            {
                "event_id": response.json()["results"][0]["event_id"],
                "status": "accepted",
                "retryable": False,
            },
            {
                "event_id": response.json()["results"][0]["event_id"],
                "status": "duplicate",
                "retryable": False,
            },
        ],
    }

    overview = client.get("/api/v1/overview")
    assert overview.status_code == 200
    assert overview.json()["totals"]["events"] == 1


def test_clamp_list_limit_preserves_positive_values_and_zeroes_negatives() -> None:
    assert clamp_list_limit(5) == 5
    assert clamp_list_limit(0) == 0
    assert clamp_list_limit(-3) == 0


def test_openapi_descriptions_clarify_scalar_alias_and_file_preview_contracts() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    components = app.openapi()["components"]["schemas"]

    project_list = components["ProjectListItemResponse"]["properties"]
    session_list = components["SessionListItemResponse"]["properties"]
    compact_session_list = components["CompactSessionListItemResponse"]["properties"]
    session_detail = components["SessionDetailResponse"]["properties"]
    project_detail = components["ProjectDetailResponse"]["properties"]

    assert "alias of `last_host`" in session_list["host"]["description"]
    assert "alias of `last_model_name`" in session_list["model_name"]["description"]
    assert "alias of `last_git_branch`" in session_list["git_branch"]["description"]
    assert "latest event" in session_list["last_host"]["description"]
    assert "latest event" in session_list["last_model_name"]["description"]
    assert "latest event" in session_list["last_git_branch"]["description"]

    assert "alias of `last_host`" in session_detail["host"]["description"]
    assert "alias of `last_model_name`" in session_detail["model_name"]["description"]
    assert "alias of `last_git_branch`" in session_detail["git_branch"]["description"]
    assert "backward-compatible `events` alias" in project_list["event_count"]["description"]
    assert "alias of `event_count`" in project_detail["events"]["description"]
    assert "backward-compatible `events` alias" in session_list["event_count"]["description"]
    assert "alias of `event_count`" in session_list["events"]["description"]
    assert "backward-compatible `events` alias" in compact_session_list["event_count"][
        "description"
    ]
    assert "alias of `event_count`" in compact_session_list["events"]["description"]
    assert "backward-compatible `events` alias" in session_detail["event_count"][
        "description"
    ]
    assert "alias of `event_count`" in session_detail["events"]["description"]
    assert "latest event" in project_detail["last_host"]["description"]
    assert "latest event" in project_detail["last_model_name"]["description"]
    assert "latest event" in project_detail["last_git_branch"]["description"]
    assert "rollup activity" in project_list["host_model_primary"]["description"]
    assert "rollup activity" in session_list["host_model_primary"]["description"]
    assert "rollup activity" in session_detail["host_model_primary"]["description"]
    assert "rollup activity" in project_detail["host_model_primary"]["description"]

    assert "not included in `file_preview`" in session_detail["file_preview_truncated_count"]["description"]
    assert "not included in `file_preview`" in project_detail["file_preview_truncated_count"]["description"]


def test_openapi_exposes_compact_list_query_mode_and_compact_response_models() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    openapi = app.openapi()

    recent_get = openapi["paths"]["/api/v1/sessions/recent"]["get"]
    project_sessions_get = openapi["paths"]["/api/v1/projects/{project_ref}/sessions"]["get"]
    components = openapi["components"]["schemas"]

    recent_parameters = {parameter["name"]: parameter for parameter in recent_get["parameters"]}
    project_parameters = {
        parameter["name"]: parameter for parameter in project_sessions_get["parameters"]
    }

    assert recent_parameters["compact"]["schema"]["type"] == "boolean"
    assert recent_parameters["compact"]["schema"]["default"] is False
    assert project_parameters["compact"]["schema"]["type"] == "boolean"
    assert project_parameters["compact"]["schema"]["default"] is False
    assert "omits `host_model_mix`" in recent_parameters["compact"]["description"]
    assert "full list contract" in recent_parameters["compact"]["description"]
    assert "omits `host_model_mix`" in project_parameters["compact"]["description"]
    assert "full list contract" in project_parameters["compact"]["description"]

    recent_any_of = recent_get["responses"]["200"]["content"]["application/json"]["schema"]["anyOf"]
    project_any_of = project_sessions_get["responses"]["200"]["content"]["application/json"][
        "schema"
    ]["anyOf"]

    assert recent_any_of == [
        {"$ref": "#/components/schemas/SessionListResponse"},
        {"$ref": "#/components/schemas/CompactSessionListResponse"},
    ]
    assert project_any_of == [
        {"$ref": "#/components/schemas/ProjectSessionsResponse"},
        {"$ref": "#/components/schemas/CompactProjectSessionsResponse"},
    ]

    assert "CompactSessionListItemResponse" in components
    assert "host_model_mix" not in components["CompactSessionListItemResponse"]["properties"]
    assert "CompactSessionListResponse" in components
    assert "CompactProjectSessionsResponse" in components


def test_openapi_documents_detail_route_error_wrappers_and_project_ref_disambiguation() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    openapi = app.openapi()
    components = openapi["components"]["schemas"]

    session_detail_get = openapi["paths"]["/api/v1/sessions/{session_id}"]["get"]
    project_detail_get = openapi["paths"]["/api/v1/projects/{project_ref}"]["get"]
    project_sessions_get = openapi["paths"]["/api/v1/projects/{project_ref}/sessions"]["get"]
    session_parameters = {parameter["name"]: parameter for parameter in session_detail_get["parameters"]}

    assert "ApiErrorResponse" in components
    assert components["ApiErrorResponse"]["properties"]["detail"] == {
        "$ref": "#/components/schemas/ApiErrorDetail"
    }

    assert session_detail_get["responses"]["404"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ApiErrorResponse"
    }
    assert session_detail_get["responses"]["409"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ApiErrorResponse"
    }
    assert project_detail_get["responses"]["404"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ApiErrorResponse"
    }
    assert project_sessions_get["responses"]["404"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ApiErrorResponse"
    }
    assert "ambigu" in session_detail_get["responses"]["409"]["description"].lower()
    assert "not found" in session_detail_get["responses"]["404"]["description"].lower()
    assert "not found" in project_detail_get["responses"]["404"]["description"].lower()
    assert "not found" in project_sessions_get["responses"]["404"]["description"].lower()

    assert session_parameters["project_ref"]["required"] is False
    assert session_parameters["project_ref"]["schema"] == {
        "anyOf": [{"type": "string"}, {"type": "null"}],
        "description": session_parameters["project_ref"]["schema"]["description"],
        "title": "Project Ref",
    }
    assert "ambiguous" in session_parameters["project_ref"]["description"].lower()
    assert "session_id" in session_parameters["project_ref"]["description"]
    assert "project_ref" in session_parameters["project_ref"]["description"]


def test_openapi_exposes_schema_backed_ingest_batch_response_model() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    openapi = app.openapi()
    components = openapi["components"]["schemas"]
    batch_post = openapi["paths"]["/api/v1/events/batch"]["post"]

    assert "EventBatchResponse" in components
    assert "EventBatchResultResponse" in components
    assert batch_post["responses"]["202"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/EventBatchResponse"
    }
    assert components["EventBatchResponse"]["properties"]["results"] == {
        "items": {"$ref": "#/components/schemas/EventBatchResultResponse"},
        "title": "Results",
        "type": "array",
    }
    assert components["EventBatchResultResponse"]["properties"]["status"]["enum"] == [
        "accepted",
        "duplicate",
        "invalid",
    ]


def test_openapi_uses_shared_readme_snippet_response_schema_for_public_readme_routes() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    openapi = app.openapi()
    components = openapi["components"]["schemas"]

    readme_schema = components["ReadmeSnippetResponse"]["properties"]

    assert "markdown" in readme_schema
    assert "Markdown snippet" in readme_schema["markdown"]["description"]

    for path in (
        "/api/v1/public/readme/top-language",
        "/api/v1/public/readme/today-time",
        "/api/v1/public/readme/this-week-time",
    ):
        response_schema = openapi["paths"][path]["get"]["responses"]["200"]["content"][
            "application/json"
        ]["schema"]
        assert response_schema == {"$ref": "#/components/schemas/ReadmeSnippetResponse"}


def test_openapi_status_schemas_clarify_ok_payload_counting_and_missing_state_zeroing() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    components = app.openapi()["components"]["schemas"]

    api_status = components["ApiStatusResponse"]["properties"]
    db_status = components["DatabaseStatusResponse"]["properties"]
    compat_status = components["DashboardStatusCompatResponse"]["properties"]
    spool_status = components["SpoolStatusResponse"]["properties"]

    assert "Always `ok`" in api_status["status"]["description"]
    assert "Always `ok`" in db_status["status"]["description"]
    assert api_status["status"]["const"] == "ok"
    assert db_status["status"]["const"] == "ok"
    assert compat_status["tier"]["const"] == "minimum"
    assert compat_status["surfaces"]["items"]["enum"] == [
        "dashboard-summary",
        "dashboard-detail",
    ]
    assert "checked-in dashboard compatibility artifact" in compat_status["pointer"]["description"]
    assert "sha256 fingerprint" in compat_status["hash"]["description"]
    assert "not the full contract body" in compat_status["surfaces"]["description"]
    assert ".json payload files" in spool_status["ready"]["description"]
    assert ".json payload files" in spool_status["processing"]["description"]
    assert ".json payload files" in spool_status["quarantine"]["description"]
    assert "state directory is missing" in spool_status["ready"]["description"]
    assert "state directory is missing" in spool_status["oldest_backlog_age_seconds"][
        "description"
    ]


def test_openapi_status_readme_and_badge_routes_expose_examples_and_svg_metadata() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    openapi = app.openapi()

    status_response = openapi["paths"]["/api/v1/status"]["get"]["responses"]["200"]
    top_language_readme = openapi["paths"]["/api/v1/public/readme/top-language"]["get"][
        "responses"
    ]["200"]
    today_readme = openapi["paths"]["/api/v1/public/readme/today-time"]["get"]["responses"]["200"]
    week_readme = openapi["paths"]["/api/v1/public/readme/this-week-time"]["get"]["responses"][
        "200"
    ]
    top_language_badge = openapi["paths"]["/api/v1/badges/top-language.svg"]["get"]["responses"][
        "200"
    ]
    today_badge = openapi["paths"]["/api/v1/badges/today-time.svg"]["get"]["responses"]["200"]
    week_badge = openapi["paths"]["/api/v1/badges/this-week-time.svg"]["get"]["responses"]["200"]
    readme_schema = openapi["components"]["schemas"]["ReadmeSnippetResponse"]

    assert "status snapshot" in status_response["description"].lower()
    assert status_response["content"]["application/json"]["example"]["api"]["status"] == "ok"
    assert status_response["content"]["application/json"]["example"]["compat"] == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": get_dashboard_compatibility_contract_hash(),
        "tier": "minimum",
        "surfaces": ["dashboard-summary", "dashboard-detail"],
    }
    assert status_response["content"]["application/json"]["example"]["spool"]["state_dir"].endswith(
        "/.local/state/clipulse"
    )

    assert top_language_readme["content"]["application/json"]["example"] == {
        "markdown": "![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)"
    }
    assert today_readme["content"]["application/json"]["example"] == {
        "markdown": "![Clipulse Today Time](https://clipulse.example/api/v1/badges/today-time.svg)"
    }
    assert week_readme["content"]["application/json"]["example"] == {
        "markdown": "![Clipulse This Week Time](https://clipulse.example/api/v1/badges/this-week-time.svg)"
    }
    assert "example" not in readme_schema

    assert top_language_badge["description"].lower().startswith("svg badge")
    assert "top language" in top_language_badge["content"]["image/svg+xml"]["example"].lower()
    assert today_badge["description"].lower().startswith("svg badge")
    assert "today time" in today_badge["content"]["image/svg+xml"]["example"].lower()
    assert today_badge["content"]["image/svg+xml"]["example"].startswith("<svg")
    assert "application/json" not in today_badge["content"]

    assert week_badge["description"].lower().startswith("svg badge")
    assert "this week" in week_badge["content"]["image/svg+xml"]["example"].lower()
    assert week_badge["content"]["image/svg+xml"]["example"].startswith("<svg")
    assert "application/json" not in week_badge["content"]


def test_openapi_status_schema_clarifies_env_resolution_order_and_home_fallback() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    spool_status = app.openapi()["components"]["schemas"]["SpoolStatusResponse"]["properties"]

    assert "`CLIPULSE_STATE_DIR`" in spool_status["state_dir"]["description"]
    assert "`XDG_STATE_HOME/clipulse`" in spool_status["state_dir"]["description"]
    assert "`HOME/.local/state/clipulse`" in spool_status["state_dir"]["description"]


def test_openapi_status_compat_hash_example_uses_sha256_shape() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    compat_example = app.openapi()["paths"]["/api/v1/status"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["example"]["compat"]

    assert re.fullmatch(r"sha256:[0-9a-f]{64}", compat_example["hash"])


def test_openapi_detail_schemas_clarify_host_model_mix_rollup_contracts() -> None:
    app = create_app("sqlite+pysqlite:///:memory:")
    components = app.openapi()["components"]["schemas"]

    session_detail = components["SessionDetailResponse"]["properties"]
    project_detail = components["ProjectDetailResponse"]["properties"]

    assert "full host/model rollup" in session_detail["host_model_mix"]["description"].lower()
    assert "primary aggregate" in session_detail["host_model_mix"]["description"].lower()
    assert "distinct host/model aggregates" in session_detail["host_model_mix_count"][
        "description"
    ].lower()
    assert "full rollup" in session_detail["host_model_mix_count"]["description"].lower()

    assert "full host/model rollup" in project_detail["host_model_mix"]["description"].lower()
    assert "primary aggregate" in project_detail["host_model_mix"]["description"].lower()
    assert "distinct host/model aggregates" in project_detail["host_model_mix_count"][
        "description"
    ].lower()
    assert "full rollup" in project_detail["host_model_mix_count"]["description"].lower()
