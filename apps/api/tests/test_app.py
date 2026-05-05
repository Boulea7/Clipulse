import json
import hashlib
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from pathlib import Path
import re
import tomllib

from fastapi.testclient import TestClient
import pytest

import clipulse_api.app as app_module
from clipulse_api.app import (
    MAX_LIST_LIMIT,
    build_dashboard_compat_metadata,
    build_dashboard_base_href,
    build_dashboard_login_page,
    build_dashboard_locale_cookie_writes,
    build_dashboard_locale_cookie_write_script,
    build_dashboard_shell_html,
    clamp_list_limit,
    compute_event_id,
    create_dashboard_session_cookie_value,
    create_app,
    get_dashboard_login_copy,
    is_valid_dashboard_session_cookie,
    resolve_client_auth_identifier,
    resolve_dashboard_locale,
    resolve_runtime_asset_directory,
    sign_dashboard_session_value,
)
from clipulse_api.database import (
    AuthRateLimitRecord,
    DashboardSessionRecord,
    EventRecord,
    create_session_factory,
)

TEST_SERVER_TOKEN = "clipulse-test-token"
TEST_DASHBOARD_TOKEN = "clipulse-dashboard-token"
TEST_API_BEARER_TOKEN = "clipulse-api-bearer-token"
TEST_SESSION_SECRET = "clipulse-session-secret"


def make_secure_client(app) -> TestClient:
    return TestClient(app, base_url="http://clipulse.local")


def auth_headers(token: str = TEST_SERVER_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def extract_cookie_value(set_cookie_header: str, cookie_name: str) -> str | None:
    cookie = SimpleCookie()
    cookie.load(set_cookie_header)
    morsel = cookie.get(cookie_name)
    if morsel is None:
        return None
    return morsel.value


def extract_first_cookie(set_cookie_header: str) -> tuple[str, str] | None:
    cookie = SimpleCookie()
    cookie.load(set_cookie_header)
    for name, morsel in cookie.items():
        if morsel.value:
            return name, morsel.value
    return None


def get_set_cookie_headers(response) -> list[str]:
    get_list = getattr(response.headers, "get_list", None)
    if callable(get_list):
        return list(get_list("set-cookie"))
    header = response.headers.get("set-cookie")
    return [header] if header else []


def has_clearing_cookie_for_path(
    set_cookie_headers: list[str],
    cookie_name: str,
    cookie_path: str,
) -> bool:
    for header in set_cookie_headers:
        cookie = SimpleCookie()
        cookie.load(header)
        morsel = cookie.get(cookie_name)
        if morsel is not None and morsel["path"] == cookie_path and morsel["max-age"] == "0":
            return True
    return False


def create_insecure_app(database_url: str = "sqlite+pysqlite:///:memory:"):
    return create_app(
        database_url,
        allow_insecure_no_auth=True,
        allow_legacy_event_payloads=True,
    )


def load_dashboard_compatibility_contract() -> dict[str, object]:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "dashboard-compat.v1.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def get_dashboard_compatibility_contract_hash() -> str:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "dashboard-compat.v1.json"
    return f"sha256:{hashlib.sha256(contract_path.read_bytes()).hexdigest()}"


def make_file_fingerprint(seed: str) -> str:
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def load_dashboard_compatibility_contract_meta() -> dict[str, object]:
    return load_dashboard_compatibility_contract()["_meta"]


def load_events_batch_contract() -> dict[str, object]:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "events-batch.v1.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def load_dashboard_login_script() -> str:
    script_path = Path(__file__).resolve().parents[2] / "web" / "dashboard-login.js"
    return script_path.read_text(encoding="utf-8")


def test_build_dashboard_compat_metadata_reads_artifact_meta_fields() -> None:
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "dashboard-compat.v1.json"
    contract_meta = load_dashboard_compatibility_contract_meta()

    assert build_dashboard_compat_metadata(contract_path) == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": get_dashboard_compatibility_contract_hash(),
        "tier": "minimum",
        "artifact_status": "ok",
        "artifact_error_code": None,
        "artifact_error_message": None,
        "surfaces": ["dashboard-summary", "dashboard-detail"],
        "artifact_version": contract_meta["version"],
        "artifact_sections": contract_meta["sections"],
        "artifact_section_count": contract_meta["section_count"],
    }


def test_events_batch_contract_locks_hashed_project_scope_and_event_id_shape() -> None:
    contract = load_events_batch_contract()

    assert contract["_meta"]["artifact"] == "clipulse.events-batch"
    assert contract["_meta"]["version"] == "v1"
    assert "project_root" in contract["_meta"]["required_event_fields"]
    assert contract["event"]["project_root"]["pattern"] == "^[0-9a-f]{12}$"
    assert contract["event"]["event_id"]["pattern"] == "^[0-9a-f]{64}$"
    assert contract["event"]["privacy_mode"]["allowed"] == ["hashed"]


def test_build_dashboard_compat_metadata_falls_back_when_contract_is_missing() -> None:
    missing_contract_path = Path(__file__).resolve().parent / "missing-dashboard-compat.v1.json"

    assert build_dashboard_compat_metadata(missing_contract_path) == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": f"sha256:{hashlib.sha256('/contracts/dashboard-compat.v1.json'.encode('utf-8')).hexdigest()}",
        "tier": "minimum",
        "artifact_status": "missing",
        "artifact_error_code": None,
        "artifact_error_message": None,
        "surfaces": ["dashboard-summary", "dashboard-detail"],
        "artifact_version": None,
        "artifact_sections": [],
        "artifact_section_count": 0,
    }


def test_build_dashboard_compat_metadata_falls_back_when_contract_is_malformed(tmp_path) -> None:
    malformed_contract_path = tmp_path / "dashboard-compat.v1.json"
    malformed_contract_path.write_text("{not-json", encoding="utf-8")

    assert build_dashboard_compat_metadata(malformed_contract_path) == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": f"sha256:{hashlib.sha256(malformed_contract_path.read_bytes()).hexdigest()}",
        "tier": "minimum",
        "artifact_status": "malformed",
        "artifact_error_code": "parse_error",
        "artifact_error_message": "compat artifact is not valid JSON",
        "surfaces": ["dashboard-summary", "dashboard-detail"],
        "artifact_version": None,
        "artifact_sections": [],
        "artifact_section_count": 0,
    }


def test_build_dashboard_compat_metadata_marks_utf8_read_failures() -> None:
    unreadable_contract_path = Path(__file__).resolve().parent / "invalid-dashboard-compat.v1.json"
    unreadable_contract_path.write_bytes(b"\xff\xfe")

    try:
        assert build_dashboard_compat_metadata(unreadable_contract_path) == {
            "pointer": "/contracts/dashboard-compat.v1.json",
            "hash": f"sha256:{hashlib.sha256(unreadable_contract_path.read_bytes()).hexdigest()}",
            "tier": "minimum",
            "artifact_status": "malformed",
            "artifact_error_code": "read_error",
            "artifact_error_message": "compat artifact could not be read as UTF-8 text",
            "surfaces": ["dashboard-summary", "dashboard-detail"],
            "artifact_version": None,
            "artifact_sections": [],
            "artifact_section_count": 0,
        }
    finally:
        unreadable_contract_path.unlink(missing_ok=True)


def test_build_dashboard_compat_metadata_marks_unexpected_meta_contract_as_malformed(
    tmp_path,
) -> None:
    invalid_contract_path = tmp_path / "dashboard-compat.v1.json"
    invalid_contract_path.write_text(
        json.dumps(
            {
                "_meta": {
                    "artifact": "clipulse.other-contract",
                    "version": "v1",
                    "sections": ["sessionListItem"],
                    "section_count": 1,
                }
            }
        ),
        encoding="utf-8",
    )

    assert build_dashboard_compat_metadata(invalid_contract_path) == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": f"sha256:{hashlib.sha256(invalid_contract_path.read_bytes()).hexdigest()}",
        "tier": "minimum",
        "artifact_status": "malformed",
        "artifact_error_code": "parse_error",
        "artifact_error_message": "compat artifact `_meta` is missing required dashboard metadata",
        "surfaces": ["dashboard-summary", "dashboard-detail"],
        "artifact_version": None,
        "artifact_sections": [],
        "artifact_section_count": 0,
    }


def test_build_dashboard_compat_metadata_rejects_boolean_section_count(tmp_path) -> None:
    invalid_contract_path = tmp_path / "dashboard-compat.v1.json"
    invalid_contract_path.write_text(
        json.dumps(
            {
                "_meta": {
                    "artifact": "clipulse.dashboard-compat",
                    "version": "v1",
                    "sections": ["sessionListItem"],
                    "section_count": True,
                },
                "sessionListItem": {},
            }
        ),
        encoding="utf-8",
    )

    assert build_dashboard_compat_metadata(invalid_contract_path) == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": f"sha256:{hashlib.sha256(invalid_contract_path.read_bytes()).hexdigest()}",
        "tier": "minimum",
        "artifact_status": "malformed",
        "artifact_error_code": "parse_error",
        "artifact_error_message": "compat artifact `_meta` is missing required dashboard metadata",
        "surfaces": ["dashboard-summary", "dashboard-detail"],
        "artifact_version": None,
        "artifact_sections": [],
        "artifact_section_count": 0,
    }


def test_healthz_returns_204_with_empty_body() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/healthz")

    assert response.status_code == 204
    assert response.content == b""
    assert response.text == ""


def test_create_app_uses_clipulse_database_url_env_when_default_argument_is_used(
    monkeypatch,
) -> None:
    captured: dict[str, str] = {}
    env_database_url = "sqlite+pysqlite:///env-configured.sqlite3"
    monkeypatch.setenv("CLIPULSE_DATABASE_URL", env_database_url)

    def capture_session_factory(database_url: str):
        captured["database_url"] = database_url
        return create_session_factory("sqlite+pysqlite:///:memory:")

    monkeypatch.setattr(app_module, "create_session_factory", capture_session_factory)

    create_app(allow_insecure_no_auth=True)

    assert captured["database_url"] == env_database_url


def test_create_app_prefers_explicit_database_url_over_env(monkeypatch) -> None:
    captured: dict[str, str] = {}
    monkeypatch.setenv("CLIPULSE_DATABASE_URL", "sqlite+pysqlite:///env-configured.sqlite3")

    def capture_session_factory(database_url: str):
        captured["database_url"] = database_url
        return create_session_factory("sqlite+pysqlite:///:memory:")

    monkeypatch.setattr(app_module, "create_session_factory", capture_session_factory)

    create_app("sqlite+pysqlite:///explicit.sqlite3", allow_insecure_no_auth=True)

    assert captured["database_url"] == "sqlite+pysqlite:///explicit.sqlite3"


def test_create_app_requires_explicit_auth_configuration_or_insecure_opt_in() -> None:
    try:
        create_app("sqlite+pysqlite:///:memory:")
    except RuntimeError as error:
        assert "CLIPULSE_ALLOW_INSECURE_NO_AUTH=1" in str(error)
    else:
        raise AssertionError("create_app() should fail closed without auth configuration")


def test_create_app_allows_explicit_insecure_mode() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", allow_insecure_no_auth=True)
    client = make_secure_client(app)

    response = client.get("/api/v1/overview")

    assert response.status_code == 200


def test_split_auth_tokens_keep_dashboard_login_read_only(monkeypatch) -> None:
    monkeypatch.setenv("CLIPULSE_DASHBOARD_TOKEN", TEST_DASHBOARD_TOKEN)
    monkeypatch.setenv("CLIPULSE_API_BEARER_TOKEN", TEST_API_BEARER_TOKEN)
    monkeypatch.setenv("CLIPULSE_SESSION_SECRET", TEST_SESSION_SECRET)

    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = make_secure_client(app)
    wrong_client = make_secure_client(app)

    login = client.post("/dashboard-login", json={"token": TEST_DASHBOARD_TOKEN})
    assert login.status_code == 204

    overview = client.get("/api/v1/overview")
    wrong_bearer = wrong_client.get("/api/v1/overview", headers=auth_headers(TEST_DASHBOARD_TOKEN))
    allowed_bearer = client.get("/api/v1/overview", headers=auth_headers(TEST_API_BEARER_TOKEN))
    write_response = client.post("/api/v1/events/batch", json={"events": []})

    assert overview.status_code == 200
    assert wrong_bearer.status_code == 401
    assert allowed_bearer.status_code == 200
    assert write_response.status_code == 401


def test_protected_routes_include_private_cache_headers() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    login_page = client.get("/")
    unauthorized = client.get("/api/v1/overview")
    authorized = client.get("/api/v1/overview", headers=auth_headers())
    docs = client.get("/docs", headers=auth_headers())
    asset = client.get("/static/app.js", headers=auth_headers())

    for response in [login_page, unauthorized, authorized, docs, asset]:
        assert response.headers["cache-control"] == "no-store, max-age=0"
        assert response.headers["pragma"] == "no-cache"
        assert response.headers["expires"] == "0"


def test_dashboard_logout_clears_site_data_and_private_cache_headers() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    login = client.post("/dashboard-login", json={"token": TEST_SERVER_TOKEN})
    assert login.status_code == 204

    logout = client.post("/dashboard-logout")

    assert logout.status_code == 204
    assert logout.headers["cache-control"] == "no-store, max-age=0"
    assert "clear-site-data" not in logout.headers


def test_dashboard_logout_can_opt_in_to_clear_site_data_and_revokes_dashboard_session(
    monkeypatch,
) -> None:
    monkeypatch.setenv("CLIPULSE_LOGOUT_CLEAR_SITE_DATA", "1")
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    login = client.post("/dashboard-login", json={"token": TEST_SERVER_TOKEN})
    assert login.status_code == 204

    assert client.get("/api/v1/overview").status_code == 200

    logout = client.post("/dashboard-logout")

    assert logout.status_code == 204
    assert logout.headers["clear-site-data"] == '"cache", "cookies", "storage"'
    assert client.get("/api/v1/overview").status_code == 401


def test_dashboard_logout_revokes_captured_cookie_for_new_clients() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    primary_client = make_secure_client(app)
    replay_client = make_secure_client(app)

    login = primary_client.post("/dashboard-login", json={"token": TEST_DASHBOARD_TOKEN})
    assert login.status_code == 204

    cookie_header = login.headers.get("set-cookie", "")
    cookie = extract_first_cookie(cookie_header)
    assert cookie is not None
    cookie_name, cookie_value = cookie

    cookie_request_headers = {"Cookie": f"{cookie_name}={cookie_value}"}
    assert replay_client.get("/api/v1/overview", headers=cookie_request_headers).status_code == 200

    logout = primary_client.post("/dashboard-logout")
    assert logout.status_code == 204

    replay_response = replay_client.get("/api/v1/overview", headers=cookie_request_headers)
    assert replay_response.status_code == 401
    assert replay_response.json()["detail"]["code"] == "authentication_required"


def test_dashboard_logout_clears_root_host_cookie_during_subpath_deployments() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = TestClient(app, base_url="https://clipulse.local/clipulse", root_path="/clipulse")

    login = client.post("/dashboard-login", json={"token": TEST_DASHBOARD_TOKEN})
    assert login.status_code == 204

    logout = client.post("/dashboard-logout")
    set_cookie_headers = get_set_cookie_headers(logout)

    assert logout.status_code == 204
    assert has_clearing_cookie_for_path(
        set_cookie_headers,
        "clipulse_dashboard_session",
        "/clipulse",
    )
    assert has_clearing_cookie_for_path(
        set_cookie_headers,
        "clipulse_dashboard_session",
        "/",
    )
    assert has_clearing_cookie_for_path(
        set_cookie_headers,
        "__Host-clipulse_dashboard_session",
        "/",
    )


def test_dashboard_session_auth_uses_active_cookie_when_stale_host_cookie_is_present(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_app(
        database_url,
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    replay_client = TestClient(app, base_url="https://clipulse.local/clipulse", root_path="/clipulse")
    session_factory = create_session_factory(database_url)
    now = datetime.now(UTC)
    stale_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="stale-host-token",
    )
    active_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="active-subpath-token",
    )
    with session_factory() as session:
        session.add_all(
            [
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("stale-host-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=app_module.to_utc_iso(now),
                ),
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("active-subpath-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=None,
                ),
            ]
        )
        session.commit()

    response = replay_client.get(
        "/api/v1/status",
        headers={
            "Cookie": (
                f"__Host-clipulse_dashboard_session={stale_cookie_value}; "
                f"clipulse_dashboard_session={active_cookie_value}"
            )
        },
    )

    assert response.status_code == 200


def test_dashboard_session_auth_preserves_duplicate_cookie_names(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_app(
        database_url,
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = TestClient(app)
    session_factory = create_session_factory(database_url)
    now = datetime.now(UTC)
    stale_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="stale-root-token",
    )
    active_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="active-root-token",
    )
    with session_factory() as session:
        session.add_all(
            [
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("stale-root-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=app_module.to_utc_iso(now),
                ),
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("active-root-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=None,
                ),
            ]
        )
        session.commit()

    response = client.get(
        "/api/v1/status",
        headers={
            "Cookie": (
                f"clipulse_dashboard_session={stale_cookie_value}; "
                f"clipulse_dashboard_session={active_cookie_value}"
            )
        },
    )

    assert response.status_code == 200


def test_active_dashboard_session_token_reader_skips_revoked_candidates(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    session_factory = create_session_factory(database_url)
    now = datetime.now(UTC)
    stale_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="stale-host-token",
    )
    active_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="active-subpath-token",
    )
    with session_factory() as session:
        session.add_all(
            [
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("stale-host-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=app_module.to_utc_iso(now),
                ),
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("active-subpath-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=None,
                ),
            ]
        )
        session.commit()

    assert app_module.read_active_dashboard_session_token(
        session_factory,
        {
            "__Host-clipulse_dashboard_session": stale_cookie_value,
            "clipulse_dashboard_session": active_cookie_value,
        },
        TEST_SESSION_SECRET,
    ) == "active-subpath-token"


def test_active_dashboard_session_token_reader_preserves_duplicate_cookie_names(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    session_factory = create_session_factory(database_url)
    now = datetime.now(UTC)
    stale_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="stale-root-token",
    )
    active_cookie_value = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="active-root-token",
    )
    with session_factory() as session:
        session.add_all(
            [
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("stale-root-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=app_module.to_utc_iso(now),
                ),
                DashboardSessionRecord(
                    token_hash=app_module.hash_dashboard_session_token("active-root-token"),
                    created_at=app_module.to_utc_iso(now),
                    expires_at=app_module.to_utc_iso(now + timedelta(hours=1)),
                    revoked_at=None,
                ),
            ]
        )
        session.commit()

    assert app_module.read_active_dashboard_session_token(
        session_factory,
        (
            f"clipulse_dashboard_session={stale_cookie_value}; "
            f"clipulse_dashboard_session={active_cookie_value}"
        ),
        TEST_SESSION_SECRET,
    ) == "active-root-token"


def test_dashboard_logout_revokes_access_to_all_protected_read_surfaces() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = make_secure_client(app)

    login = client.post("/dashboard-login", json={"token": TEST_DASHBOARD_TOKEN})
    assert login.status_code == 204
    assert client.get("/api/v1/status").status_code == 200
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/contracts/dashboard-compat.v1.json").status_code == 200
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200

    logout = client.post("/dashboard-logout")

    assert logout.status_code == 204
    for protected_path in (
        "/api/v1/status",
        "/static/app.js",
        "/contracts/dashboard-compat.v1.json",
        "/docs",
        "/redoc",
        "/openapi.json",
    ):
        response = client.get(protected_path)
        assert response.status_code == 401, protected_path


def test_protected_routes_reject_expired_dashboard_session_cookie() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = make_secure_client(app)
    expired_issued_at = str(
        int(datetime.now(UTC).timestamp()) - app_module.DASHBOARD_SESSION_TTL_SECONDS - 1
    )
    expired_cookie = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="expired-session-token",
        issued_at=expired_issued_at,
    )

    response = client.get(
        "/api/v1/overview",
        headers={"Cookie": f"clipulse_dashboard_session={expired_cookie}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "authentication_required"


def test_protected_routes_reject_tampered_dashboard_session_cookie() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = make_secure_client(app)
    valid_cookie = create_dashboard_session_cookie_value(
        TEST_SESSION_SECRET,
        session_token="tampered-session-token",
    )
    tampered_cookie = f"{valid_cookie[:-1]}{'0' if valid_cookie[-1] != '0' else '1'}"

    response = client.get(
        "/api/v1/overview",
        headers={"Cookie": f"clipulse_dashboard_session={tampered_cookie}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "authentication_required"


def test_dashboard_login_rate_limits_repeated_invalid_tokens() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = make_secure_client(app)

    for _ in range(5):
        response = client.post("/dashboard-login", json={"token": "wrong-token"})
        assert response.status_code == 401

    rate_limited = client.post("/dashboard-login", json={"token": "wrong-token"})

    assert rate_limited.status_code == 429
    assert rate_limited.headers["retry-after"].isdigit()
    assert rate_limited.json()["detail"]["code"] == "auth_rate_limited"


def test_protected_api_rate_limits_repeated_invalid_bearer_tokens() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = make_secure_client(app)

    for _ in range(10):
        response = client.get("/api/v1/overview", headers=auth_headers("wrong-token"))
        assert response.status_code == 401

    rate_limited = client.get("/api/v1/overview", headers=auth_headers("wrong-token"))

    assert rate_limited.status_code == 429
    assert rate_limited.headers["retry-after"].isdigit()
    assert rate_limited.json()["detail"]["code"] == "auth_rate_limited"


def test_resolve_client_auth_identifier_prefers_rightmost_non_trusted_forwarded_hop() -> None:
    client_ref, source = resolve_client_auth_identifier(
        peer_host="10.0.0.9",
        x_forwarded_for="198.51.100.10, invalid-hop, 10.0.0.8",
        trusted_proxy_networks=("10.0.0.0/8",),
    )

    assert client_ref == "198.51.100.10"
    assert source == "x_forwarded_for"


def test_resolve_client_auth_identifier_falls_back_to_peer_for_untrusted_or_invalid_forwarded_headers() -> None:
    assert resolve_client_auth_identifier(
        peer_host="203.0.113.7",
        x_forwarded_for="198.51.100.10",
        trusted_proxy_networks=("10.0.0.0/8",),
    ) == ("203.0.113.7", "peer")
    assert resolve_client_auth_identifier(
        peer_host="10.0.0.9",
        x_forwarded_for="unknown-hop, garbage",
        trusted_proxy_networks=("10.0.0.0/8",),
    ) == ("10.0.0.9", "peer")


def test_dashboard_login_rate_limit_uses_trusted_proxy_client_hop(monkeypatch) -> None:
    monkeypatch.setenv("CLIPULSE_TRUSTED_PROXY_CIDRS", "10.0.0.0/8")
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = TestClient(app, base_url="http://clipulse.local", client=("10.0.0.5", 4567))

    first_chain_headers = {"x-forwarded-for": "198.51.100.20, 10.0.0.8"}
    second_chain_headers = {"x-forwarded-for": "198.51.100.21, 10.0.0.8"}

    for _ in range(5):
        response = client.post(
            "/dashboard-login",
            json={"token": "wrong-token"},
            headers=first_chain_headers,
        )
        assert response.status_code == 401

    rate_limited = client.post(
        "/dashboard-login",
        json={"token": "wrong-token"},
        headers=first_chain_headers,
    )
    different_forwarded_client = client.post(
        "/dashboard-login",
        json={"token": "wrong-token"},
        headers=second_chain_headers,
    )

    assert rate_limited.status_code == 429
    assert different_forwarded_client.status_code == 401


def test_dashboard_login_rate_limit_ignores_forwarded_for_from_untrusted_peer(
    monkeypatch,
) -> None:
    monkeypatch.setenv("CLIPULSE_TRUSTED_PROXY_CIDRS", "10.0.0.0/8")
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = TestClient(app, base_url="http://clipulse.local", client=("203.0.113.7", 4567))

    first_chain_headers = {"x-forwarded-for": "198.51.100.20"}
    second_chain_headers = {"x-forwarded-for": "198.51.100.21"}

    for _ in range(5):
        response = client.post(
            "/dashboard-login",
            json={"token": "wrong-token"},
            headers=first_chain_headers,
        )
        assert response.status_code == 401

    rate_limited = client.post(
        "/dashboard-login",
        json={"token": "wrong-token"},
        headers=second_chain_headers,
    )

    assert rate_limited.status_code == 429


def test_protected_routes_include_browser_security_headers() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    responses = [
        client.get("/"),
        client.get("/api/v1/overview", headers=auth_headers()),
        client.get("/docs", headers=auth_headers()),
        client.get("/static/app.js", headers=auth_headers()),
    ]

    for response in responses:
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["x-frame-options"] == "DENY"

    assert "content-security-policy" in responses[0].headers


def test_create_app_rejects_public_reads_without_public_base_url() -> None:
    with pytest.raises(RuntimeError, match="CLIPULSE_PUBLIC_BASE_URL"):
        create_app(
            "sqlite+pysqlite:///:memory:",
            server_token=TEST_SERVER_TOKEN,
            enable_public_reads=True,
            public_base_url="",
        )


def test_dashboard_login_cookie_ignores_spoofed_forwarded_proto() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.post(
        "/dashboard-login",
        json={"token": TEST_SERVER_TOKEN},
        headers={"x-forwarded-proto": "https"},
    )

    assert response.status_code == 204
    assert "Secure" not in response.headers.get("set-cookie", "")


def test_dashboard_login_cookie_can_be_forced_secure_on_http_origin(monkeypatch) -> None:
    monkeypatch.setenv("CLIPULSE_FORCE_SECURE_SESSION_COOKIE", "1")
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.post("/dashboard-login", json={"token": TEST_SERVER_TOKEN})

    assert response.status_code == 204
    assert "Secure" in response.headers.get("set-cookie", "")


def test_dashboard_login_uses_host_prefixed_cookie_name_for_https_root_scope() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = TestClient(app, base_url="https://clipulse.local")

    response = client.post("/dashboard-login", json={"token": TEST_DASHBOARD_TOKEN})

    assert response.status_code == 204
    assert "__Host-clipulse_dashboard_session=" in response.headers.get("set-cookie", "")
    assert "Path=/" in response.headers.get("set-cookie", "")
    assert "Secure" in response.headers.get("set-cookie", "")


def test_dashboard_login_scopes_cookie_to_root_path() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = TestClient(app, base_url="http://clipulse.local/clipulse", root_path="/clipulse")

    response = client.post("/dashboard-login", json={"token": TEST_DASHBOARD_TOKEN})

    assert response.status_code == 204
    assert "clipulse_dashboard_session=" in response.headers.get("set-cookie", "")
    assert "Path=/clipulse" in response.headers.get("set-cookie", "")


def test_protected_api_routes_require_bearer_auth_outside_testserver_host() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    missing = client.get("/api/v1/overview")
    wrong = client.get("/api/v1/overview", headers=auth_headers("wrong-token"))
    allowed = client.get("/api/v1/overview", headers=auth_headers())

    assert missing.status_code == 401
    assert missing.json()["detail"]["code"] == "authentication_required"
    assert wrong.status_code == 401
    assert wrong.json()["detail"]["code"] == "authentication_required"
    assert allowed.status_code == 200


def test_host_header_testserver_does_not_bypass_protected_api_routes() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.get("/api/v1/overview", headers={"host": "testserver"})

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "authentication_required"


def test_protected_api_routes_fail_closed_when_server_token_is_not_configured() -> None:
    try:
        create_app("sqlite+pysqlite:///:memory:", server_token="")
    except RuntimeError as error:
        assert "CLIPULSE_ALLOW_INSECURE_NO_AUTH=1" in str(error)
    else:
        raise AssertionError("create_app() should fail fast when the legacy token is blank")


def test_public_badges_and_readme_routes_require_explicit_public_opt_in() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        server_token=TEST_SERVER_TOKEN,
        enable_public_reads=False,
    )
    client = make_secure_client(app)

    readme = client.get("/api/v1/public/readme/top-language")
    badge = client.get("/api/v1/badges/top-language.svg")
    authenticated = client.get("/api/v1/public/readme/top-language", headers=auth_headers())

    assert readme.status_code == 401
    assert badge.status_code == 401
    assert authenticated.status_code == 503
    assert authenticated.json()["detail"]["code"] == "public_base_url_not_configured"


def test_authenticated_public_readme_still_requires_public_base_url_on_protected_deployments() -> None:
    with pytest.raises(RuntimeError, match="CLIPULSE_PUBLIC_BASE_URL"):
        create_app(
            "sqlite+pysqlite:///:memory:",
            server_token=TEST_SERVER_TOKEN,
            enable_public_reads=True,
            public_base_url="",
        )


def test_public_readme_routes_allow_anonymous_access_when_public_reads_are_enabled() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        server_token=TEST_SERVER_TOKEN,
        public_base_url="https://clipulse.example",
        enable_public_reads=True,
    )
    client = make_secure_client(app)

    response = client.get("/api/v1/public/readme/top-language")

    assert response.status_code == 200
    assert response.json()["markdown"] == (
        "![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)"
    )


def test_public_readme_requires_public_base_url_outside_testserver_host() -> None:
    with pytest.raises(RuntimeError, match="CLIPULSE_PUBLIC_BASE_URL"):
        create_app(
            "sqlite+pysqlite:///:memory:",
            server_token=TEST_SERVER_TOKEN,
            enable_public_reads=True,
            public_base_url="",
        )


def test_public_readme_uses_configured_public_base_url_instead_of_request_host() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        server_token=TEST_SERVER_TOKEN,
        public_base_url="https://clipulse.example/nested",
        enable_public_reads=True,
    )
    client = TestClient(app, base_url="http://evil.example")

    response = client.get("/api/v1/public/readme/top-language")

    assert response.status_code == 200
    assert response.json()["markdown"] == (
        "![Clipulse Top Language](https://clipulse.example/nested/api/v1/badges/top-language.svg)"
    )


def test_public_readme_requires_public_base_url_even_when_request_host_is_testserver() -> None:
    with pytest.raises(RuntimeError, match="CLIPULSE_PUBLIC_BASE_URL"):
        create_app(
            "sqlite+pysqlite:///:memory:",
            server_token=TEST_SERVER_TOKEN,
            enable_public_reads=True,
            public_base_url="",
        )


def test_dashboard_root_does_not_set_raw_server_token_cookie() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.get("/")

    assert response.status_code == 200
    assert TEST_SERVER_TOKEN not in response.headers.get("set-cookie", "")


def test_dashboard_login_sets_signed_cookie_and_unlocks_protected_api_routes() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    login = client.post("/dashboard-login", json={"token": TEST_SERVER_TOKEN})

    assert login.status_code == 204
    assert TEST_SERVER_TOKEN not in login.headers.get("set-cookie", "")

    overview = client.get("/api/v1/overview")
    assert overview.status_code == 200


def test_dashboard_login_cookie_cannot_write_protected_api_routes() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    login = client.post("/dashboard-login", json={"token": TEST_SERVER_TOKEN})
    assert login.status_code == 204

    response = client.post(
        "/api/v1/events/batch",
        json={"events": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "authentication_required"


def test_dashboard_login_rejects_invalid_tokens() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.post("/dashboard-login", json={"token": "wrong-token"})

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "dashboard_authentication_failed"
    assert response.json()["detail"]["message"] == "dashboard access token is invalid"
    assert (
        response.json()["detail"]["hint"]
        == "Provide the configured Clipulse dashboard access token and try again."
    )
    assert "www-authenticate" not in response.headers


def test_partial_split_auth_configuration_fails_fast_for_each_missing_secret() -> None:
    incomplete_configs = [
        {
            "api_bearer_token": TEST_API_BEARER_TOKEN,
            "session_secret": TEST_SESSION_SECRET,
        },
        {
            "dashboard_token": TEST_DASHBOARD_TOKEN,
            "session_secret": TEST_SESSION_SECRET,
        },
        {
            "dashboard_token": TEST_DASHBOARD_TOKEN,
            "api_bearer_token": TEST_API_BEARER_TOKEN,
        },
    ]

    for config in incomplete_configs:
        try:
            create_app("sqlite+pysqlite:///:memory:", **config)
        except RuntimeError as error:
            assert "Clipulse protected mode requires all split auth secrets" in str(error)
        else:
            raise AssertionError("create_app() should fail fast for partial split auth config")


def test_split_auth_dashboard_cookie_can_read_protected_static_contract_docs_and_openapi() -> None:
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    client = make_secure_client(app)

    login = client.post("/dashboard-login", json={"token": TEST_DASHBOARD_TOKEN})
    assert login.status_code == 204

    responses = [
        client.get("/static/app.js"),
        client.get("/contracts/dashboard-compat.v1.json"),
        client.get("/docs"),
        client.get("/redoc"),
        client.get("/openapi.json"),
    ]

    for response in responses:
        assert response.status_code == 200


def test_static_and_contract_routes_require_auth_when_server_token_is_enabled() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    static_missing = client.get("/static/app.js")
    contract_missing = client.get("/contracts/dashboard-compat.v1.json")
    static_allowed = client.get("/static/app.js", headers=auth_headers())
    contract_allowed = client.get("/contracts/dashboard-compat.v1.json", headers=auth_headers())

    assert static_missing.status_code == 401
    assert contract_missing.status_code == 401
    assert static_allowed.status_code == 200
    assert contract_allowed.status_code == 200


def test_docs_and_openapi_routes_require_auth_when_server_token_is_enabled() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    docs_missing = client.get("/docs")
    redoc_missing = client.get("/redoc")
    openapi_missing = client.get("/openapi.json")
    docs_allowed = client.get("/docs", headers=auth_headers())
    redoc_allowed = client.get("/redoc", headers=auth_headers())
    openapi_allowed = client.get("/openapi.json", headers=auth_headers())

    assert docs_missing.status_code == 401
    assert redoc_missing.status_code == 401
    assert openapi_missing.status_code == 401
    assert docs_allowed.status_code == 200
    assert redoc_allowed.status_code == 200
    assert openapi_allowed.status_code == 200


def test_static_route_does_not_expose_web_test_sources() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    runtime_asset = client.get("/static/app.js")
    test_source = client.get("/static/app.test.ts")

    assert runtime_asset.status_code == 200
    assert test_source.status_code == 404


def test_build_dashboard_base_href_normalizes_root_path_with_trailing_slash() -> None:
    assert build_dashboard_base_href("/clipulse") == "/clipulse/"
    assert build_dashboard_base_href("/clipulse/") == "/clipulse/"
    assert build_dashboard_base_href("") == "/"


def test_dashboard_shell_html_injects_base_href_for_subpath_deployments() -> None:
    web_dir = Path(__file__).resolve().parents[2] / "web"

    html = build_dashboard_shell_html(web_dir, "/clipulse/")

    assert '<base href="/clipulse/" />' in html
    assert 'src="./static/app.js"' in html


def test_dashboard_shell_html_falls_back_when_packaged_assets_are_missing(tmp_path) -> None:
    html = build_dashboard_shell_html(tmp_path, "/")

    assert "Clipulse dashboard assets are not bundled in this package build." in html
    assert "source checkout" in html


def test_resolve_runtime_asset_directory_prefers_repo_checkout_assets(tmp_path) -> None:
    repo_dir = tmp_path / "repo-web"
    bundled_dir = tmp_path / "bundled-web"
    repo_dir.mkdir()
    bundled_dir.mkdir()

    resolved = resolve_runtime_asset_directory(repo_dir, bundled_dir)

    assert resolved == repo_dir


def test_resolve_runtime_asset_directory_falls_back_to_bundled_assets(tmp_path) -> None:
    repo_dir = tmp_path / "repo-web"
    bundled_dir = tmp_path / "bundled-web"
    bundled_dir.mkdir()

    resolved = resolve_runtime_asset_directory(repo_dir, bundled_dir)

    assert resolved == bundled_dir


def test_dashboard_login_page_posts_to_root_path_aware_login_endpoint() -> None:
    html = build_dashboard_login_page("/clipulse/")

    assert '<base href="/clipulse/" />' in html
    assert '"/clipulse/dashboard-login"' in html
    assert 'src="./static/dashboard-login.js"' in html
    assert "<script>" not in html


def test_dashboard_login_page_preserves_hash_deep_links_after_successful_login() -> None:
    script = load_dashboard_login_script()

    assert "window.location.hash" in script
    assert "nextUrl.hash = window.location.hash" in script


def test_dashboard_login_page_scopes_locale_cookie_to_dashboard_base_path() -> None:
    html = build_dashboard_login_page("/clipulse/")

    assert 'Path=/clipulse; Max-Age=31536000; SameSite=Lax' in html
    assert 'Path=/; Max-Age=31536000; SameSite=Lax' not in html
    assert 'clipulse_dashboard_locale=; Path=/; Max-Age=0; SameSite=Lax' in html
    assert 'clipulse_locale=; Path=/; Max-Age=0; SameSite=Lax' in html


def test_dashboard_login_page_does_not_clear_root_cookie_when_dashboard_is_root_scoped() -> None:
    html = build_dashboard_login_page("/")

    assert 'clipulse_dashboard_locale=; Path=/; Max-Age=0; SameSite=Lax' not in html
    assert 'clipulse_locale=; Path=/; Max-Age=0; SameSite=Lax' in html


def test_dashboard_login_page_keeps_html_escaping_out_of_inline_cookie_script() -> None:
    html = build_dashboard_login_page('/clipulse"quoted&segment')

    assert '<base href="/clipulse&quot;quoted&amp;segment"' in html
    assert 'Path=/clipulse&quot;quoted&amp;segment' not in html
    assert 'data-locale-cookie-writes=' in html
    assert 'src="./static/dashboard-login.js"' in html


def test_dashboard_locale_cookie_writes_keep_raw_cookie_text_for_js_encoding() -> None:
    writes = build_dashboard_locale_cookie_writes('/clipulse"quoted&segment')

    assert writes[0] == 'clipulse_dashboard_locale=__LOCALE__; Path=/clipulse"quoted&segment; Max-Age=31536000; SameSite=Lax'
    assert all("&quot;" not in write and "&amp;" not in write for write in writes)


def test_dashboard_locale_cookie_write_script_uses_js_string_escaping_instead_of_html_entities() -> None:
    script = build_dashboard_locale_cookie_write_script(
        "localeInput.value",
        '/clipulse"quoted&segment',
    )

    assert "&quot;" not in script
    assert "&amp;" not in script
    assert 'document.cookie = "clipulse_dashboard_locale=' in script
    assert 'Path=/clipulse\\"quoted\\u0026segment; Max-Age=31536000; SameSite=Lax' in script
    assert "localeInput.value" in script
    assert "__LOCALE__" not in script


def test_dashboard_locale_cookie_write_script_escapes_script_boundary_characters() -> None:
    html = build_dashboard_login_page('/clipulse</script>&"quoted')
    writes = build_dashboard_locale_cookie_writes('/clipulse</script>&"quoted')
    script = build_dashboard_locale_cookie_write_script(
        "localeInput.value",
        '/clipulse</script>&"quoted',
    )

    assert '<base href="/clipulse&lt;/script&gt;&amp;&quot;quoted"' in html
    assert writes[0] == 'clipulse_dashboard_locale=__LOCALE__; Path=/clipulse</script>&"quoted; Max-Age=31536000; SameSite=Lax'
    assert "&lt;" not in script
    assert "&gt;" not in script
    assert "&amp;" not in script
    assert "\\u003c" in script
    assert "\\u003e" in script
    assert "\\u0026" in script
    assert '\\"quoted' in script
    assert "__LOCALE__" not in script


def test_dashboard_login_page_includes_accessible_token_input_and_error_region() -> None:
    html = build_dashboard_login_page("/")

    assert 'id="dashboard-token-help"' in html
    assert 'autofocus' in html
    assert 'required' in html
    assert 'aria-describedby="dashboard-token-help dashboard-login-error"' in html
    assert 'role="alert"' in html
    assert 'aria-live="assertive"' in html


def test_resolve_dashboard_locale_prefers_cookie_then_accept_language() -> None:
    assert resolve_dashboard_locale("clipulse_locale=ko", "de-DE,de;q=0.8,en;q=0.5") == "ko"
    assert resolve_dashboard_locale("", "pt-BR,pt;q=0.9,en;q=0.8") == "pt-BR"
    assert resolve_dashboard_locale("", "pl-PL,pl;q=0.8") == "en"


def test_resolve_dashboard_locale_prefers_last_matching_cookie_during_path_scope_migration() -> None:
    cookie_header = (
        "clipulse_dashboard_locale=ja; "
        "clipulse_locale=ko; "
        "clipulse_dashboard_locale=de"
    )

    assert resolve_dashboard_locale(cookie_header, "fr-FR,fr;q=0.8") == "de"


def test_dashboard_login_page_renders_translated_copy_for_non_english_locale() -> None:
    html = build_dashboard_login_page("/", locale="ja")

    assert '<html lang="ja">' in html
    assert "Clipulse ダッシュボードへログイン" in html
    assert "保護された Clipulse ダッシュボード" in html
    assert "ダッシュボードを開く" in html
    assert "言語" in html


def test_dashboard_login_page_includes_localized_failure_copy_for_supported_locale() -> None:
    html = build_dashboard_login_page("/", locale="ko")

    assert "잘못된 토큰입니다. 대시보드 액세스 토큰을 확인한 뒤 다시 시도하세요." in html
    assert "대시보드 로그인에 실패했습니다. 프록시와 서버 로그를 확인한 뒤 다시 시도하세요." in html
    assert "Clipulse 서버에 연결할 수 없습니다. 네트워크 경로를 확인한 뒤 다시 시도하세요." in html
    assert "Invalid token. Check the dashboard access token and try again." not in html


@pytest.mark.parametrize("locale", ["ja", "zh-CN", "pt-BR", "de"])
def test_dashboard_login_page_renders_translated_copy_for_multiple_supported_locales(
    locale: str,
) -> None:
    html = build_dashboard_login_page("/", locale=locale)
    copy = get_dashboard_login_copy(locale)
    english_copy = get_dashboard_login_copy("en")

    assert f'<html lang="{locale}">' in html
    assert copy["heading"] in html
    assert copy["submit"] in html
    assert copy["heading"] != english_copy["heading"]
    assert copy["submit"] != english_copy["submit"]


def test_dashboard_shell_sets_cookie_and_accept_language_vary_headers_in_unprotected_mode() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = make_secure_client(app)

    response = client.get(
        "/",
        headers={"Accept-Language": "ja,en;q=0.8", "Cookie": "clipulse_dashboard_locale=ja"},
    )

    vary_values = {value.strip() for value in response.headers["vary"].split(",")}

    assert response.status_code == 200
    assert vary_values == {"Accept-Language", "Cookie"}


def test_dashboard_shell_sets_cookie_and_accept_language_vary_headers_in_protected_mode() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.get(
        "/",
        headers={"Accept-Language": "ja,en;q=0.8", "Cookie": "clipulse_dashboard_locale=ja"},
    )

    vary_values = {value.strip() for value in response.headers["vary"].split(",")}

    assert response.status_code == 200
    assert vary_values == {"Accept-Language", "Cookie"}


def test_dashboard_logout_vary_header_in_protected_mode() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.post("/dashboard-logout")
    vary_values = {value.strip() for value in response.headers["vary"].split(",")}

    assert response.status_code == 204
    assert "Cookie" in vary_values


def test_get_dashboard_login_copy_keeps_builtin_english_when_contract_locale_is_partial(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        app_module,
        "load_dashboard_login_translations",
        lambda: {
            "en": {"title": "Custom title"},
            "ja": {"submit": "ダッシュボードを開く"},
        },
    )

    copy = get_dashboard_login_copy("ja")

    assert copy["title"] == "Custom title"
    assert copy["submit"] == "ダッシュボードを開く"
    assert copy["heading"] == "Protected Clipulse dashboard"
    assert copy["invalid_token_api_message"] == "dashboard access token is invalid"


def test_get_dashboard_login_copy_warns_and_uses_builtin_english_when_contract_has_no_en_locale(
    monkeypatch,
    tmp_path,
    caplog,
) -> None:
    contract_dir = tmp_path / "contracts"
    contract_dir.mkdir()
    (contract_dir / "dashboard-login-copy.v1.json").write_text(
        json.dumps(
            {
                "_meta": {
                    "artifact": "clipulse.dashboard-login-copy",
                    "version": "v1",
                    "default_locale": "en",
                },
                "locales": {
                    "ja": {"submit": "ダッシュボードを開く"},
                },
            }
        ),
        encoding="utf-8",
    )
    app_module.load_dashboard_login_translations.cache_clear()
    monkeypatch.setattr(app_module, "resolve_runtime_asset_directory", lambda *_args: contract_dir)

    with caplog.at_level("WARNING"):
        copy = get_dashboard_login_copy("ja")

    assert copy["submit"] == "ダッシュボードを開く"
    assert copy["title"] == "Clipulse Dashboard Login"
    assert copy["heading"] == "Protected Clipulse dashboard"
    assert "dashboard login translation contract is missing required English keys" in caplog.text

    app_module.load_dashboard_login_translations.cache_clear()


def test_dashboard_login_rejects_invalid_tokens_with_localized_failure_copy() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    client = make_secure_client(app)

    response = client.post(
        "/dashboard-login",
        json={"token": "wrong-token"},
        headers={"Accept-Language": "zh-TW,zh;q=0.8"},
    )

    vary_values = {value.strip() for value in response.headers["vary"].split(",")}

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "dashboard_authentication_failed"
    assert response.json()["detail"]["message"] == "dashboard 存取 token 無效"
    assert (
        response.json()["detail"]["hint"]
        == "請提供已設定的 Clipulse dashboard 存取 token 後再試一次。"
    )
    assert vary_values == {"Accept-Language", "Cookie"}


def test_healthz_openapi_declares_204_no_content() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    healthz_responses = app.openapi()["paths"]["/healthz"]["get"]["responses"]

    assert "204" in healthz_responses
    assert "200" not in healthz_responses


def test_dashboard_compatibility_contract_is_served_for_browser_runtime() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/contracts/dashboard-compat.v1.json")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == load_dashboard_compatibility_contract()


def test_dashboard_login_translation_contract_is_served_for_browser_runtime() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/contracts/dashboard-login-copy.v1.json")
    body = response.json()

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert body["_meta"]["artifact"] == "clipulse.dashboard-login-copy"
    assert body["locales"]["en"]["title"] == "Clipulse Dashboard Login"


def test_empty_overview_returns_zeroed_metrics() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/overview")

    assert response.status_code == 200
    assert response.json()["totals"]["events"] == 0
    assert response.json()["totals"]["active_ms"] == 0
    assert response.json()["totals"]["wait_ms"] == 0


def test_event_batch_updates_overview_and_breakdowns() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
                        "fingerprint": make_file_fingerprint("src/index.ts"),
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


def test_event_batch_rejects_events_past_the_server_side_batch_limit() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    payload = {
        "events": [
            {
                "event_id": f"event-{index}",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-limit",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T12:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 100,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            }
            for index in range(201)
        ]
    }

    response = client.post("/api/v1/events/batch", json=payload)

    assert response.status_code == 202
    body = response.json()
    assert body["accepted"] == 0
    assert body["invalid"] == 201
    assert {item["reason_code"] for item in body["results"]} == {"batch_limit_exceeded"}


def test_event_batch_rejects_oversized_nested_event_collections() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    payload = {
        "events": [
            {
                "event_id": "oversized",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-limit",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T12:00:00Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 100,
                "privacy_mode": "hashed",
                "language_stats": {
                    f"Lang-{index}": {"added": 1, "removed": 0, "changed": 1}
                    for index in range(65)
                },
                "file_deltas": [
                    {
                        "fingerprint": make_file_fingerprint(f"delta-{index}"),
                        "language": "TypeScript",
                        "added": 1,
                        "removed": 0,
                    }
                    for index in range(513)
                ],
            }
        ]
    }

    response = client.post("/api/v1/events/batch", json=payload)

    assert response.status_code == 202
    body = response.json()
    assert body["accepted"] == 0
    assert body["invalid"] == 1
    assert body["results"][0]["reason_code"] in {
        "language_stats_limit_exceeded",
        "file_deltas_limit_exceeded",
    }


def test_event_batch_rejects_overlong_string_fields() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    payload = {
        "events": [
            {
                "event_id": "overlong-project-name",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-limit",
                "project_root": "/workspace/demo",
                "project_name": "x" * 300,
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T12:00:00Z",
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
    assert response.json()["results"][0]["reason_code"] == "field_too_long"


def test_event_batch_accepts_hex_file_delta_fingerprints() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)
    payload = {
        "events": [
            {
                "event_id": "event-valid-fingerprint",
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
                "file_deltas": [
                    {
                        "fingerprint": make_file_fingerprint("src/main.py"),
                        "language": "Python",
                        "added": 4,
                        "removed": 1,
                    }
                ],
            }
        ]
    }

    response = client.post("/api/v1/events/batch", json=payload)

    assert response.status_code == 202
    assert response.json()["accepted"] == 1
    assert response.json()["invalid"] == 0


def test_event_batch_rejects_raw_path_like_file_delta_fingerprints() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
                "event_id": "event-path-fingerprint",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-path",
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
                "file_deltas": [
                    {
                        "fingerprint": "src/private/secrets.py",
                        "language": "Python",
                        "added": 1,
                        "removed": 0,
                    }
                ],
            },
        ]
    }

    response = client.post("/api/v1/events/batch", json=payload)

    assert response.status_code == 202
    assert response.json() == {
        "accepted": 1,
        "duplicates": 0,
        "invalid": 1,
        "results": [
            {
                "event_id": "event-valid",
                "status": "accepted",
                "retryable": False,
                "reason_code": None,
                "details": None,
            },
            {
                "event_id": "event-path-fingerprint",
                "status": "invalid",
                "retryable": False,
                "reason_code": "schema_validation_failed",
                "details": {"field": "fingerprint"},
            },
        ],
    }


def test_packaged_backend_declares_console_scripts() -> None:
    pyproject_path = Path(__file__).resolve().parents[3] / "pyproject.toml"
    pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))

    assert pyproject["project"]["scripts"] == {
        "clipulse-api": "clipulse_api.app:main",
        "clipulse-migrate": "clipulse_api.migrate:main",
    }


def test_clipulse_api_console_entrypoint_runs_uvicorn_with_factory_defaults(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run(app: str, **kwargs) -> None:
        captured["app"] = app
        captured["kwargs"] = kwargs

    monkeypatch.setattr(app_module.uvicorn, "run", fake_run)

    app_module.main()

    assert captured == {
        "app": "clipulse_api.app:create_app",
        "kwargs": {"factory": True, "host": "127.0.0.1", "port": 8000},
    }


def test_clipulse_api_console_entrypoint_rejects_insecure_no_auth_on_non_loopback(
    monkeypatch,
) -> None:
    monkeypatch.setenv("CLIPULSE_ALLOW_INSECURE_NO_AUTH", "1")
    monkeypatch.setenv("CLIPULSE_API_HOST", "0.0.0.0")

    with pytest.raises(SystemExit, match="loopback"):
        app_module.main()


def test_event_batch_rejects_raw_project_root_when_strict_privacy_contract_is_enabled(
    tmp_path,
) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_app(database_url, allow_insecure_no_auth=True)
    client = TestClient(app)
    raw_project_root = "/workspace/private/demo"
    payload = {
        "events": [
            {
                "event_id": "hash-project-root",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-hash",
                "project_root": raw_project_root,
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T12:00:00Z",
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

    assert response.status_code == 422
    assert response.json() == {
        "accepted": 0,
        "duplicates": 0,
        "invalid": 1,
        "results": [
            {
                "event_id": "hash-project-root",
                "status": "invalid",
                "retryable": False,
                "reason_code": "invalid_project_root_scope",
                "details": {"field": "project_root"},
            }
        ],
    }


def test_event_batch_persists_hashed_project_scope_key_instead_of_raw_project_root_with_legacy_opt_in(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("CLIPULSE_ALLOW_LEGACY_EVENT_PAYLOADS", "1")
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_insecure_app(database_url)
    client = TestClient(app)
    raw_project_root = "/workspace/private/demo"
    payload = {
        "events": [
            {
                "event_id": "hash-project-root",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-hash",
                "project_root": raw_project_root,
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-05T12:00:00Z",
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
    session_factory = create_session_factory(database_url)
    with session_factory() as session:
        record = session.query(EventRecord).filter_by(event_id="hash-project-root").one()

    assert record.project_root == app_module.compute_project_ref(raw_project_root)
    assert record.project_root != raw_project_root


def test_event_batch_rejects_non_hashed_privacy_mode_in_strict_mode(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_app(database_url, allow_insecure_no_auth=True)
    client = TestClient(app)

    response = client.post(
        "/api/v1/events/batch",
        json={"events": [{
            "event_id": "wrong-privacy-mode",
            "host": "codex",
            "host_version": "0.1.0",
            "session_id": "session-hash",
            "project_root": "f902f0cad961",
            "project_name": "demo",
            "git_branch": "main",
            "event_name": "stop",
            "event_time": "2026-04-05T12:00:00Z",
            "model_name": "gpt-5.4",
            "os_name": "macos",
            "editor_or_terminal": "terminal",
            "active_ms": 1000,
            "wait_ms": 100,
            "privacy_mode": "raw",
            "language_stats": {},
            "file_deltas": [],
        }]},
    )

    assert response.status_code == 422
    assert response.json()["results"][0]["reason_code"] == "invalid_privacy_mode"
    assert response.json()["results"][0]["details"] == {"field": "privacy_mode"}


def test_event_batch_computes_missing_event_id_from_normalized_project_scope(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("CLIPULSE_ALLOW_LEGACY_EVENT_PAYLOADS", "1")
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_insecure_app(database_url)
    client = TestClient(app)
    raw_project_root = "/workspace/private/demo"
    normalized_project_root = app_module.compute_project_ref(raw_project_root)
    base_event = {
        "host": "codex",
        "host_version": "0.1.0",
        "session_id": "session-hash",
        "project_name": "demo",
        "git_branch": "main",
        "event_name": "stop",
        "event_time": "2026-04-05T12:00:00Z",
        "model_name": "gpt-5.4",
        "os_name": "macos",
        "editor_or_terminal": "terminal",
        "active_ms": 1000,
        "wait_ms": 100,
        "privacy_mode": "hashed",
        "language_stats": {},
        "file_deltas": [],
    }

    response = client.post(
        "/api/v1/events/batch",
        json={"events": [{**base_event, "project_root": raw_project_root}]},
    )

    expected_event_id = compute_event_id({**base_event, "project_root": normalized_project_root})

    assert response.status_code == 202
    assert response.json()["results"][0]["event_id"] == expected_event_id


def test_dashboard_session_cookie_helper_rejects_invalid_shapes_expiry_and_tampering() -> None:
    valid_cookie = create_dashboard_session_cookie_value(TEST_SESSION_SECRET)
    _issued_at, session_token, _signature = valid_cookie.split(":", 2)
    expired_issued_at = str(
        int(datetime.now(UTC).timestamp()) - app_module.DASHBOARD_SESSION_TTL_SECONDS - 1
    )
    expired_cookie = (
        f"{expired_issued_at}:{session_token}:{sign_dashboard_session_value(TEST_SESSION_SECRET, expired_issued_at, session_token)}"
    )
    tampered_cookie = f"{valid_cookie[:-1]}{'0' if valid_cookie[-1] != '0' else '1'}"

    assert is_valid_dashboard_session_cookie(valid_cookie, TEST_SESSION_SECRET) is True
    assert is_valid_dashboard_session_cookie("", TEST_SESSION_SECRET) is False
    assert is_valid_dashboard_session_cookie("not-a-cookie", TEST_SESSION_SECRET) is False
    assert is_valid_dashboard_session_cookie(expired_cookie, TEST_SESSION_SECRET) is False
    assert is_valid_dashboard_session_cookie(tampered_cookie, TEST_SESSION_SECRET) is False


def test_openapi_documents_summary_list_limit_query_semantics() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
    assert str(MAX_LIST_LIMIT) in projects_parameters["limit"]["description"]
    assert str(MAX_LIST_LIMIT) in recent_parameters["limit"]["description"]
    assert str(MAX_LIST_LIMIT) in project_sessions_parameters["limit"]["description"]


def test_event_batch_returns_partial_outcomes_without_rejecting_valid_events() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
            {
                "event_id": "event-valid",
                "status": "accepted",
                "retryable": False,
                "reason_code": None,
                "details": None,
            },
            {
                "event_id": "event-valid",
                "status": "duplicate",
                "retryable": False,
                "reason_code": "duplicate_in_batch",
                "details": {"event_id": "event-valid"},
            },
            {
                "event_id": "event-invalid",
                "status": "invalid",
                "retryable": False,
                "reason_code": "invalid_event_time",
                "details": {"field": "event_time"},
            },
        ],
    }

    overview = client.get("/api/v1/overview")
    assert overview.status_code == 200
    assert overview.json()["totals"]["events"] == 1


def test_event_batch_rejects_negative_and_inconsistent_event_metrics_without_rejecting_valid_events() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
                "language_stats": {
                    "TypeScript": {"added": 2, "removed": 1, "changed": 3}
                },
                "file_deltas": [],
            },
            {
                "event_id": "event-negative",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-negative",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:00:01Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": -1,
                "wait_ms": 100,
                "privacy_mode": "hashed",
                "language_stats": {},
                "file_deltas": [],
            },
            {
                "event_id": "event-inconsistent",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-inconsistent",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:00:02Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": 1000,
                "wait_ms": 100,
                "privacy_mode": "hashed",
                "language_stats": {
                    "TypeScript": {"added": 2, "removed": 1, "changed": 4}
                },
                "file_deltas": [],
            },
        ]
    }

    response = client.post("/api/v1/events/batch", json=payload)

    assert response.status_code == 202
    assert response.json() == {
        "accepted": 1,
        "duplicates": 0,
        "invalid": 2,
        "results": [
            {
                "event_id": "event-valid",
                "status": "accepted",
                "retryable": False,
                "reason_code": None,
                "details": None,
            },
            {
                "event_id": "event-negative",
                "status": "invalid",
                "retryable": False,
                "reason_code": "negative_metric",
                "details": {"field": "active_ms"},
            },
            {
                "event_id": "event-inconsistent",
                "status": "invalid",
                "retryable": False,
                "reason_code": "language_stats_mismatch",
                "details": {"language": "TypeScript"},
            },
        ],
    }

    overview = client.get("/api/v1/overview")
    assert overview.status_code == 200
    assert overview.json()["totals"]["events"] == 1


def test_event_batch_treats_structurally_invalid_events_as_per_event_invalid_results() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
                "event_id": "event-missing-session",
                "host": "codex",
                "host_version": "0.1.0",
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
                "event_id": "event-bad-active-ms",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-bad-active-ms",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:00:02Z",
                "model_name": "gpt-5.4",
                "os_name": "macos",
                "editor_or_terminal": "terminal",
                "active_ms": "oops",
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
        "duplicates": 0,
        "invalid": 2,
        "results": [
            {
                "event_id": "event-valid",
                "status": "accepted",
                "retryable": False,
                "reason_code": None,
                "details": None,
            },
            {
                "event_id": "event-missing-session",
                "status": "invalid",
                "retryable": False,
                "reason_code": "schema_validation_failed",
                "details": {"field": "session_id"},
            },
            {
                "event_id": "event-bad-active-ms",
                "status": "invalid",
                "retryable": False,
                "reason_code": "schema_validation_failed",
                "details": {"field": "active_ms"},
            },
        ],
    }

    overview = client.get("/api/v1/overview")
    assert overview.status_code == 200
    assert overview.json()["totals"]["events"] == 1


def test_event_batch_rejects_blank_route_identity_without_rejecting_valid_events() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
                "event_id": "event-blank-session",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "   ",
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
                "event_id": "event-blank-project",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-blank-project",
                "project_root": "",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:00:02Z",
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
        "duplicates": 0,
        "invalid": 2,
        "results": [
            {
                "event_id": "event-valid",
                "status": "accepted",
                "retryable": False,
                "reason_code": None,
                "details": None,
            },
            {
                "event_id": "event-blank-session",
                "status": "invalid",
                "retryable": False,
                "reason_code": "blank_session_id",
                "details": {"field": "session_id"},
            },
            {
                "event_id": "event-blank-project",
                "status": "invalid",
                "retryable": False,
                "reason_code": "blank_project_root",
                "details": {"field": "project_root"},
            },
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


def test_compute_event_id_normalizes_non_utc_offset_timestamps() -> None:
    payload = {
        "host": "codex",
        "host_version": "0.1.0",
        "session_id": "session-normalized",
        "project_root": "abc123abc123",
        "project_name": "demo",
        "git_branch": "main",
        "event_name": "stop",
        "event_time": "2026-04-06T12:00:00+01:00",
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
        "event_time": "2026-04-06T11:00:00Z",
    }

    assert compute_event_id(payload) == compute_event_id(equivalent_payload)


def test_compute_event_id_preserves_non_zero_timestamp_milliseconds() -> None:
    payload = {
        "host": "codex",
        "host_version": "0.1.0",
        "session_id": "session-subsecond",
        "project_root": "abc123abc123",
        "project_name": "demo",
        "git_branch": "main",
        "event_name": "stop",
        "event_time": "2026-04-06T12:00:00.123+01:00",
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
        "event_time": "2026-04-06T11:00:00.123Z",
    }
    next_millisecond_payload = {
        **payload,
        "event_time": "2026-04-06T11:00:00.124Z",
    }
    whole_second_payload = {
        **payload,
        "event_time": "2026-04-06T11:00:00Z",
    }

    assert compute_event_id(payload) == compute_event_id(equivalent_payload)
    assert compute_event_id(payload) != compute_event_id(next_millisecond_payload)
    assert compute_event_id(payload) != compute_event_id(whole_second_payload)


def test_dashboard_status_reports_backlog_mode_and_missing_state_dir(monkeypatch, tmp_path) -> None:
    state_dir = tmp_path / "clipulse-state"
    monkeypatch.setenv("CLIPULSE_STATE_DIR", str(state_dir))

    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    missing_state_response = client.get("/api/v1/status")
    assert missing_state_response.status_code == 200
    assert missing_state_response.json()["generated_at"].endswith("Z")
    assert missing_state_response.json()["spool"]["status"] == "ok"
    assert missing_state_response.json()["spool"]["error_code"] is None
    assert missing_state_response.json()["spool"]["error_message"] is None
    assert isinstance(missing_state_response.json()["spool"]["query_duration_ms"], int)
    assert missing_state_response.json()["spool"]["state_dir_exists"] is False
    assert missing_state_response.json()["spool"]["backlog_mode"] == "missing_state_dir"

    ready_dir = state_dir / "spool" / "ready"
    processing_dir = state_dir / "spool" / "processing"
    quarantine_dir = state_dir / "spool" / "quarantine"
    ready_dir.mkdir(parents=True)
    processing_dir.mkdir(parents=True)
    quarantine_dir.mkdir(parents=True)
    (processing_dir / "processing-batch.json").write_text('{"events":[{"event_id":"processing-1"}]}')

    processing_only_response = client.get("/api/v1/status")
    assert processing_only_response.status_code == 200
    assert processing_only_response.json()["spool"]["status"] == "ok"
    assert processing_only_response.json()["spool"]["state_dir_exists"] is True
    assert processing_only_response.json()["spool"]["backlog_mode"] == "processing_only"
    assert processing_only_response.json()["spool"]["orphan_sidecars"] == {
        "ready": 0,
        "processing": 0,
        "quarantine": 0,
        "total": 0,
    }
    assert processing_only_response.json()["spool"]["quarantine_reason_counts"] == {}
    assert processing_only_response.json()["spool"]["quarantine_meta_error_counts"] == {
        "read_error": 0,
        "parse_error": 0,
    }

    (quarantine_dir / "quarantine-batch.json").write_text('{"events":[{"event_id":"quarantine-1"}]}')
    (quarantine_dir / "quarantine-batch.meta.json").write_text(
        '{"reason":"http_error"}',
        encoding="utf-8",
    )

    mixed_response = client.get("/api/v1/status")
    assert mixed_response.status_code == 200
    assert mixed_response.json()["spool"]["status"] == "ok"
    assert mixed_response.json()["spool"]["backlog_mode"] == "mixed"
    assert mixed_response.json()["spool"]["quarantine_reason_counts"] == {"http_error": 1}


def test_dashboard_status_treats_non_directory_state_path_as_missing(monkeypatch, tmp_path) -> None:
    state_dir_file = tmp_path / "clipulse-state-file"
    state_dir_file.write_text("not-a-directory", encoding="utf-8")
    monkeypatch.setenv("CLIPULSE_STATE_DIR", str(state_dir_file))

    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/status")

    assert response.status_code == 200
    assert response.json()["spool"]["status"] == "ok"
    assert response.json()["spool"]["state_dir_exists"] is True
    assert response.json()["spool"]["state_dir_kind"] == "file"
    assert response.json()["spool"]["backlog_mode"] == "missing_state_dir"
    assert response.json()["spool"]["ready"] == 0
    assert response.json()["spool"]["processing"] == 0
    assert response.json()["spool"]["quarantine"] == 0


def test_dashboard_status_reports_quarantine_meta_parse_and_read_failures(monkeypatch, tmp_path) -> None:
    state_dir = tmp_path / "clipulse-state"
    quarantine_dir = state_dir / "spool" / "quarantine"
    quarantine_dir.mkdir(parents=True)
    (quarantine_dir / "quarantine-good.json").write_text("{}", encoding="utf-8")
    (quarantine_dir / "quarantine-good.meta.json").write_text(
        '{"reason":"http_error"}',
        encoding="utf-8",
    )
    (quarantine_dir / "quarantine-invalid.json").write_text("{}", encoding="utf-8")
    (quarantine_dir / "quarantine-invalid.meta.json").write_text("{not-json", encoding="utf-8")
    (quarantine_dir / "quarantine-unreadable.json").write_text("{}", encoding="utf-8")
    (quarantine_dir / "quarantine-unreadable.meta.json").write_bytes(b"\xff\xfe")
    monkeypatch.setenv("CLIPULSE_STATE_DIR", str(state_dir))

    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    client = TestClient(app)

    response = client.get("/api/v1/status")

    assert response.status_code == 200
    assert response.json()["spool"]["status"] == "ok"
    assert response.json()["spool"]["quarantine_reason_counts"] == {"http_error": 1}
    assert response.json()["spool"]["quarantine_meta_error_counts"] == {
        "read_error": 1,
        "parse_error": 1,
    }


def test_dashboard_status_reports_runtime_operator_auth_metadata(monkeypatch) -> None:
    monkeypatch.setenv("CLIPULSE_TRUSTED_PROXY_CIDRS", "10.0.0.0/8")
    app = create_app(
        "sqlite+pysqlite:///:memory:",
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
        enable_public_reads=True,
        public_base_url="https://public.example/clipulse",
    )
    client = TestClient(app, base_url="http://clipulse.local", client=("10.0.0.5", 4567))

    response = client.get(
        "/api/v1/status",
        headers={
            **auth_headers(TEST_API_BEARER_TOKEN),
            "x-forwarded-for": "198.51.100.20, 10.0.0.8",
        },
    )

    assert response.status_code == 200
    assert response.json()["auth"] == {
        "auth_mode": "split",
        "dashboard_auth_required": True,
        "browser_session_enabled": True,
        "browser_session_scope": "read_only",
        "legacy_single_token": False,
        "trusted_proxy_configured": True,
        "client_ref_source": "x_forwarded_for",
        "public_reads_enabled": True,
        "public_base_url_configured": True,
    }


def test_dashboard_status_request_cleans_expired_sessions_and_stale_rate_limits(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    app = create_app(
        database_url,
        dashboard_token=TEST_DASHBOARD_TOKEN,
        api_bearer_token=TEST_API_BEARER_TOKEN,
        session_secret=TEST_SESSION_SECRET,
    )
    seed_session_factory = create_session_factory(database_url)
    now = datetime.now(UTC)
    stale_rate_limit_time = app_module.to_utc_iso(
        now - timedelta(seconds=app_module.AUTH_RATE_LIMIT_WINDOW_SECONDS + 5)
    )
    expired_block_time = app_module.to_utc_iso(
        now - timedelta(seconds=app_module.AUTH_RATE_LIMIT_BLOCK_SECONDS + 5)
    )
    active_future_time = app_module.to_utc_iso(now + timedelta(minutes=5))

    with seed_session_factory() as session:
        session.add_all(
            [
                DashboardSessionRecord(
                    token_hash="expired-session",
                    created_at=app_module.to_utc_iso(now - timedelta(hours=13)),
                    expires_at=app_module.to_utc_iso(now - timedelta(minutes=1)),
                    revoked_at=None,
                ),
                DashboardSessionRecord(
                    token_hash="active-session",
                    created_at=app_module.to_utc_iso(now),
                    expires_at=active_future_time,
                    revoked_at=None,
                ),
                AuthRateLimitRecord(
                    family="dashboard_login",
                    client_ref="stale-window",
                    failure_count=1,
                    first_failed_at=stale_rate_limit_time,
                    last_failed_at=stale_rate_limit_time,
                    blocked_until=None,
                ),
                AuthRateLimitRecord(
                    family="dashboard_login",
                    client_ref="expired-block",
                    failure_count=5,
                    first_failed_at=stale_rate_limit_time,
                    last_failed_at=stale_rate_limit_time,
                    blocked_until=expired_block_time,
                ),
                AuthRateLimitRecord(
                    family="dashboard_login",
                    client_ref="active-block",
                    failure_count=5,
                    first_failed_at=app_module.to_utc_iso(now),
                    last_failed_at=app_module.to_utc_iso(now),
                    blocked_until=active_future_time,
                ),
            ]
        )
        session.commit()

    client = make_secure_client(app)
    response = client.get("/api/v1/status", headers=auth_headers(TEST_API_BEARER_TOKEN))

    assert response.status_code == 200

    with seed_session_factory() as session:
        remaining_session_hashes = {
            record.token_hash
            for record in session.query(DashboardSessionRecord).all()
        }
        remaining_rate_limit_refs = {
            record.client_ref
            for record in session.query(AuthRateLimitRecord).all()
        }

    assert remaining_session_hashes == {"active-session"}
    assert remaining_rate_limit_refs == {"active-block"}


def test_event_batch_treats_equivalent_utc_timestamp_forms_as_duplicates() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
                "reason_code": None,
                "details": None,
            },
            {
                "event_id": response.json()["results"][0]["event_id"],
                "status": "duplicate",
                "retryable": False,
                "reason_code": "duplicate_in_batch",
                "details": {"event_id": response.json()["results"][0]["event_id"]},
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
    assert clamp_list_limit(MAX_LIST_LIMIT + 10) == MAX_LIST_LIMIT


def test_openapi_descriptions_clarify_scalar_alias_and_file_preview_contracts() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
    assert "latest event" in project_list["last_host"]["description"]
    assert "latest event" in project_list["last_model_name"]["description"]
    assert "latest event" in project_list["last_git_branch"]["description"]
    assert "rollup activity" in project_list["host_model_primary"]["description"]
    assert "rollup activity" in session_list["host_model_primary"]["description"]
    assert "rollup activity" in session_detail["host_model_primary"]["description"]
    assert "rollup activity" in project_detail["host_model_primary"]["description"]

    assert "not included in `file_preview`" in session_detail["file_preview_truncated_count"]["description"]
    assert "not included in `file_preview`" in project_detail["file_preview_truncated_count"]["description"]


def test_openapi_exposes_compact_list_query_mode_and_compact_response_models() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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


def test_event_batch_treats_unique_conflict_during_flush_as_duplicate_without_rejecting_batch(
    monkeypatch, tmp_path
) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'clipulse.sqlite3'}"
    session_factory = create_session_factory(database_url)

    with session_factory() as session:
        session.add(
            EventRecord(
                event_id="event-race",
                host="codex",
                host_version="0.1.0",
                session_id="session-existing",
                project_root="/workspace/demo",
                project_name="demo",
                git_branch="main",
                event_name="stop",
                event_time="2026-04-06T12:00:00Z",
                model_name="gpt-5.4",
                os_name="macos",
                editor_or_terminal="terminal",
                active_ms=1000,
                wait_ms=100,
                privacy_mode="hashed",
            )
        )
        session.commit()

    original_get_session = app_module.get_session

    class DuplicateBlindSession:
        def __init__(self, inner_session):
            self._inner_session = inner_session
            self._scalar_calls = 0

        def scalar(self, statement, *args, **kwargs):
            self._scalar_calls += 1
            if self._scalar_calls == 1:
                return None
            return self._inner_session.scalar(statement, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._inner_session, name)

    def patched_get_session(factory):
        for session in original_get_session(factory):
            yield DuplicateBlindSession(session)

    monkeypatch.setattr(app_module, "get_session", patched_get_session)

    app = create_insecure_app(database_url)
    client = TestClient(app)
    payload = {
        "events": [
            {
                "event_id": "event-race",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-race",
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
                "event_id": "event-fresh",
                "host": "codex",
                "host_version": "0.1.0",
                "session_id": "session-fresh",
                "project_root": "/workspace/demo",
                "project_name": "demo",
                "git_branch": "main",
                "event_name": "stop",
                "event_time": "2026-04-06T12:05:00Z",
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
                "event_id": "event-race",
                "status": "duplicate",
                "retryable": False,
                "reason_code": "duplicate_stored",
                "details": {"event_id": "event-race"},
            },
            {
                "event_id": "event-fresh",
                "status": "accepted",
                "retryable": False,
                "reason_code": None,
                "details": None,
            },
        ],
    }

    with session_factory() as session:
        event_ids = {
            record.event_id for record in session.query(EventRecord).order_by(EventRecord.event_id).all()
        }

    assert event_ids == {"event-fresh", "event-race"}


def test_openapi_uses_shared_readme_snippet_response_schema_for_public_readme_routes() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    components = app.openapi()["components"]["schemas"]

    api_status = components["ApiStatusResponse"]["properties"]
    auth_status = components["DashboardAuthStatusResponse"]["properties"]
    db_status = components["DatabaseStatusResponse"]["properties"]
    compat_status = components["DashboardStatusCompatResponse"]["properties"]
    spool_status = components["SpoolStatusResponse"]["properties"]

    assert "Always `ok`" in api_status["status"]["description"]
    assert auth_status["trusted_proxy_configured"]["type"] == "boolean"
    assert auth_status["client_ref_source"]["enum"] == ["peer", "x_forwarded_for"]
    assert "rate-limit client reference" in auth_status["client_ref_source"]["description"]
    assert "public badge and README routes" in auth_status["public_reads_enabled"]["description"]
    assert "public base URL" in auth_status["public_base_url_configured"]["description"]
    assert "`ok` when the API can query" in db_status["status"]["description"]
    assert api_status["status"]["const"] == "ok"
    assert db_status["status"]["enum"] == ["ok", "degraded"]
    assert compat_status["tier"]["const"] == "minimum"
    assert compat_status["artifact_status"]["enum"] == ["ok", "missing", "malformed"]
    assert compat_status["artifact_error_code"]["anyOf"][0]["enum"] == ["read_error", "parse_error"]
    assert "read or parsed" in compat_status["artifact_error_code"]["description"]
    assert "operator-focused" in compat_status["artifact_error_message"]["description"]
    assert compat_status["surfaces"]["items"]["enum"] == [
        "dashboard-summary",
        "dashboard-detail",
    ]
    assert "compat artifact `_meta.version`" in compat_status["artifact_version"]["description"]
    assert "compat artifact `_meta.sections`" in compat_status["artifact_sections"]["description"]
    assert "falls back to `[]`" in compat_status["artifact_sections"]["description"]
    assert "compat artifact `_meta.section_count`" in compat_status["artifact_section_count"][
        "description"
    ]
    assert "checked-in dashboard compatibility artifact" in compat_status["pointer"]["description"]
    assert "sha256 fingerprint" in compat_status["hash"]["description"]
    assert "loaded successfully" in compat_status["artifact_status"]["description"]
    assert "not the full contract body" in compat_status["surfaces"]["description"]
    assert spool_status["state_dir_kind"]["enum"] == ["directory", "file", "missing"]
    assert "exists on disk" in spool_status["state_dir_exists"]["description"]
    assert "directory, regular file, or missing path" in spool_status["state_dir_kind"]["description"]
    assert ".json payload files" in spool_status["ready"]["description"]
    assert ".json payload files" in spool_status["processing"]["description"]
    assert ".json payload files" in spool_status["quarantine"]["description"]
    assert spool_status["quarantine_meta_error_counts"]["type"] == "object"
    assert "could not be read or parsed" in spool_status["quarantine_meta_error_counts"]["description"]
    assert spool_status["metadata_error_counts_by_state"]["$ref"] == (
        "#/components/schemas/SpoolMetadataErrorCountsByState"
    )
    assert "ready, processing, and quarantine spool metadata sidecars" in spool_status[
        "metadata_error_counts_by_state"
    ]["description"]
    metadata_counts_by_state = components["SpoolMetadataErrorCountsByState"]
    state_metadata_counts = components["SpoolStateMetadataErrorCounts"]
    assert metadata_counts_by_state["type"] == "object"
    assert metadata_counts_by_state["properties"]["ready"]["$ref"] == (
        "#/components/schemas/SpoolStateMetadataErrorCounts"
    )
    assert metadata_counts_by_state["properties"]["processing"]["$ref"] == (
        "#/components/schemas/SpoolStateMetadataErrorCounts"
    )
    assert metadata_counts_by_state["properties"]["quarantine"]["$ref"] == (
        "#/components/schemas/SpoolStateMetadataErrorCounts"
    )
    assert state_metadata_counts["properties"]["read_error"]["default"] == 0
    assert state_metadata_counts["properties"]["parse_error"]["default"] == 0
    assert spool_status["oldest_first_seen_age_seconds"]["type"] == "integer"
    assert "first_seen_at" in spool_status["oldest_first_seen_age_seconds"]["description"]
    assert spool_status["oldest_ready_age_seconds"]["type"] == "integer"
    assert "`spool/ready`" in spool_status["oldest_ready_age_seconds"]["description"]
    assert spool_status["oldest_processing_age_seconds"]["type"] == "integer"
    assert "`spool/processing`" in spool_status["oldest_processing_age_seconds"]["description"]
    assert spool_status["last_attempted_age_seconds"]["type"] == "integer"
    assert "last_attempted_at" in spool_status["last_attempted_age_seconds"]["description"]
    assert spool_status["last_attempted_state"]["anyOf"] == [
        {"enum": ["ready", "processing", "quarantine"], "type": "string"},
        {"type": "null"},
    ]
    assert spool_status["max_attempt_count"]["type"] == "integer"
    assert "attempt_count" in spool_status["max_attempt_count"]["description"]
    assert spool_status["quarantine_source_state_counts"]["type"] == "object"
    assert "source_state" in spool_status["quarantine_source_state_counts"]["description"]
    assert spool_status["status"]["enum"] == ["ok", "degraded"]
    assert "degraded" in spool_status["status"]["description"]
    assert "milliseconds spent building the spool status block" in spool_status["query_duration_ms"][
        "description"
    ]
    assert "state directory is missing" in spool_status["ready"]["description"]
    assert "state directory is missing" in spool_status["oldest_backlog_age_seconds"][
        "description"
    ]


def test_openapi_status_readme_and_badge_routes_expose_examples_and_svg_metadata() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
    compat_example = status_response["content"]["application/json"]["example"]["compat"]

    status_example = status_response["content"]["application/json"]["example"]

    assert "status snapshot" in status_response["description"].lower()
    assert status_example["api"]["status"] == "ok"
    assert status_example["auth"]["trusted_proxy_configured"] is False
    assert status_example["auth"]["client_ref_source"] == "peer"
    assert status_example["auth"]["public_reads_enabled"] is False
    assert status_example["auth"]["public_base_url_configured"] is False
    assert status_example["generated_at"].endswith("Z")
    assert status_example["db"]["status"] == "ok"
    assert status_example["db"].get("error_code") is None
    assert status_example["db"].get("error_message") is None
    assert status_example["db"]["latest_event_time"] == "2026-04-05T13:05:00Z"
    assert status_example["spool"]["status"] == "ok"
    assert status_example["spool"].get("error_code") is None
    assert status_example["spool"].get("error_message") is None
    assert compat_example == {
        "pointer": "/contracts/dashboard-compat.v1.json",
        "hash": get_dashboard_compatibility_contract_hash(),
        "tier": "minimum",
        "artifact_status": "ok",
        "surfaces": ["dashboard-summary", "dashboard-detail"],
        "artifact_version": load_dashboard_compatibility_contract_meta()["version"],
        "artifact_sections": load_dashboard_compatibility_contract_meta()["sections"],
        "artifact_section_count": load_dashboard_compatibility_contract_meta()["section_count"],
    }
    assert compat_example.get("artifact_error_code") is None
    assert compat_example.get("artifact_error_message") is None
    assert status_response["content"]["application/json"]["example"]["spool"]["state_dir"] == "<redacted>"
    assert status_response["content"]["application/json"]["example"]["spool"]["state_dir_kind"] == "directory"
    assert status_response["content"]["application/json"]["example"]["spool"][
        "state_dir_exists"
    ] is True
    assert status_response["content"]["application/json"]["example"]["spool"][
        "quarantine_meta_error_counts"
    ] == {"read_error": 0, "parse_error": 0}
    assert status_response["content"]["application/json"]["example"]["spool"][
        "metadata_error_counts_by_state"
    ] == {
        "ready": {"read_error": 0, "parse_error": 0},
        "processing": {"read_error": 0, "parse_error": 0},
        "quarantine": {"read_error": 0, "parse_error": 0},
    }
    assert status_response["content"]["application/json"]["example"]["spool"][
        "oldest_ready_age_seconds"
    ] == 42
    assert status_response["content"]["application/json"]["example"]["spool"][
        "oldest_processing_age_seconds"
    ] == 0
    assert status_response["content"]["application/json"]["example"]["spool"][
        "oldest_first_seen_age_seconds"
    ] == 42
    assert status_response["content"]["application/json"]["example"]["spool"][
        "last_attempted_age_seconds"
    ] == 15
    assert status_response["content"]["application/json"]["example"]["spool"][
        "last_attempted_state"
    ] == "ready"
    assert status_response["content"]["application/json"]["example"]["spool"][
        "max_attempt_count"
    ] == 2
    assert status_response["content"]["application/json"]["example"]["spool"][
        "quarantine_source_state_counts"
    ] == {}

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


def test_openapi_status_example_auth_reflects_insecure_auth_configuration() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    status_example = app.openapi()["paths"]["/api/v1/status"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["example"]

    assert status_example["auth"] == {
        "auth_mode": "insecure_no_auth",
        "dashboard_auth_required": False,
        "browser_session_enabled": False,
        "browser_session_scope": "disabled",
        "legacy_single_token": False,
        "trusted_proxy_configured": False,
        "client_ref_source": "peer",
        "public_reads_enabled": False,
        "public_base_url_configured": False,
    }


def test_openapi_status_example_auth_reflects_legacy_single_token_configuration() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    status_example = app.openapi()["paths"]["/api/v1/status"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["example"]

    assert status_example["auth"] == {
        "auth_mode": "legacy_single_token",
        "dashboard_auth_required": True,
        "browser_session_enabled": True,
        "browser_session_scope": "read_only",
        "legacy_single_token": True,
        "trusted_proxy_configured": False,
        "client_ref_source": "peer",
        "public_reads_enabled": False,
        "public_base_url_configured": False,
    }


def test_openapi_protected_routes_declare_bearer_security_and_auth_failures() -> None:
    app = create_app("sqlite+pysqlite:///:memory:", server_token=TEST_SERVER_TOKEN)
    openapi = app.openapi()

    protected_overview = openapi["paths"]["/api/v1/overview"]["get"]
    protected_events = openapi["paths"]["/api/v1/events/batch"]["post"]
    public_readme = openapi["paths"]["/api/v1/public/readme/top-language"]["get"]
    security_schemes = openapi["components"]["securitySchemes"]

    assert security_schemes["BearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "API token",
    }
    assert protected_overview["security"] == [{"BearerAuth": []}]
    assert protected_events["security"] == [{"BearerAuth": []}]
    assert protected_overview["responses"]["401"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ApiErrorResponse"
    )
    assert protected_overview["responses"]["503"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ApiErrorResponse"
    )
    assert public_readme["responses"]["401"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ApiErrorResponse"
    )
    assert public_readme["responses"]["503"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ApiErrorResponse"
    )


def test_openapi_status_schema_clarifies_env_resolution_order_and_home_fallback() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    spool_status = app.openapi()["components"]["schemas"]["SpoolStatusResponse"]["properties"]

    assert "never exposes the absolute path" in spool_status["state_dir"]["description"]
    assert "local operator commands" in spool_status["state_dir"]["description"]
    assert "exists on disk" in spool_status["state_dir_exists"]["description"]


def test_openapi_status_compat_hash_example_uses_sha256_shape() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
    compat_example = app.openapi()["paths"]["/api/v1/status"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["example"]["compat"]

    assert re.fullmatch(r"sha256:[0-9a-f]{64}", compat_example["hash"])


def test_openapi_detail_schemas_clarify_host_model_mix_rollup_contracts() -> None:
    app = create_insecure_app("sqlite+pysqlite:///:memory:")
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
