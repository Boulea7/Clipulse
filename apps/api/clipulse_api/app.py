import hashlib
import hmac
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from html import escape
from pathlib import Path
from time import perf_counter
from typing import Annotated, Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import Depends, FastAPI, Query, Request, Response, status
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import (
    EventRecord,
    FileDeltaRecord,
    LanguageStatRecord,
    create_session_factory,
    get_session,
)
from .errors import api_error
from .reporting import (
    build_project_detail,
    build_project_list_items,
    build_session_detail,
    build_session_list_items,
    sort_project_items,
    sort_session_items,
)
from .lookups import (
    compute_project_ref,
    load_database_status,
    load_reporting_records,
    load_session_detail_records,
    require_project_by_ref,
)
from .runtime_status import build_spool_status_fallback, collect_spool_status, resolve_state_dir
from .schemas import (
    ApiErrorResponse,
    CompactProjectSessionsResponse,
    CompactSessionListItemResponse,
    CompactSessionListResponse,
    DashboardStatusResponse,
    EventBatchResponse,
    EventBatchPayload,
    EventPayload,
    ProjectDetailResponse,
    ProjectListItemResponse,
    ProjectListResponse,
    ProjectSessionsResponse,
    ReadmeSnippetResponse,
    SessionDetailResponse,
    SessionListItemResponse,
    SessionListResponse,
)


APP_VERSION = "0.1.0"
MAX_LIST_LIMIT = 100
MAX_BATCH_EVENTS = 200
MAX_LANGUAGE_STATS_ITEMS = 64
MAX_FILE_DELTAS_ITEMS = 512
MAX_GENERIC_TEXT_LENGTH = 256
MAX_PROJECT_ROOT_LENGTH = 1024
DASHBOARD_TOKEN_COOKIE_NAME = "clipulse_api_token"
DASHBOARD_LOCALE_COOKIE_NAME = "clipulse_dashboard_locale"
LEGACY_DASHBOARD_LOCALE_COOKIE_NAMES = ("clipulse_locale",)
DASHBOARD_DEFAULT_LOCALE = "en"
DASHBOARD_SUPPORTED_LOCALES = (
    "en",
    "zh-CN",
    "zh-TW",
    "es",
    "pt-BR",
    "ja",
    "ko",
    "de",
    "fr",
    "ru",
    "hi",
    "id",
    "tr",
    "it",
    "nl",
)
DASHBOARD_SESSION_TTL_SECONDS = 12 * 60 * 60
DASHBOARD_LOGIN_ERROR_MESSAGE = "Clipulse dashboard access token is required."
DASHBOARD_COMPAT_CONTRACT_POINTER = "/contracts/dashboard-compat.v1.json"
DASHBOARD_COMPAT_ARTIFACT_ID = "clipulse.dashboard-compat"
DASHBOARD_COMPAT_TIER = "minimum"
DASHBOARD_COMPAT_SURFACES = ["dashboard-summary", "dashboard-detail"]
ALLOWED_STATIC_ASSET_EXTENSIONS = {".js", ".css"}
READ_ONLY_METHODS = {"GET", "HEAD", "OPTIONS"}
PROTECTED_DOC_PATHS = {"/openapi.json", "/redoc"}
PRIVATE_CACHE_CONTROL = "no-store, max-age=0"
PRIVATE_AUTH_VARY_HEADERS = ("Authorization", "Cookie")
DASHBOARD_LOCALE_VARY_HEADERS = ("Accept-Language", "Cookie")
NOT_FOUND_RESPONSE = {
    "model": ApiErrorResponse,
    "description": "Machine-readable not found response wrapper for detail lookups.",
}
AMBIGUOUS_SESSION_RESPONSE = {
    "model": ApiErrorResponse,
    "description": "Machine-readable response wrapper when `session_id` is ambiguous across multiple projects.",
}
STATUS_RESPONSE_EXAMPLE = {
    "api": {"status": "ok", "version": APP_VERSION},
    "auth": {
        "auth_mode": "split",
        "dashboard_auth_required": True,
        "browser_session_enabled": True,
        "browser_session_scope": "read_only",
        "legacy_single_token": False,
    },
    "generated_at": "2026-04-05T13:05:30Z",
    "db": {
        "status": "ok",
        "events": 12,
        "projects": 3,
        "sessions": 4,
        "error_code": None,
        "error_message": None,
        "latest_event_time": "2026-04-05T13:05:00Z",
        "latest_event_age_seconds": 30,
        "query_duration_ms": 2,
    },
    "compat": {
        "pointer": DASHBOARD_COMPAT_CONTRACT_POINTER,
        "hash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "tier": DASHBOARD_COMPAT_TIER,
        "artifact_status": "ok",
        "artifact_error_code": None,
        "artifact_error_message": None,
        "surfaces": DASHBOARD_COMPAT_SURFACES,
        "artifact_version": "v1",
        "artifact_sections": [
            "languageBreakdownItem",
            "modelBreakdownItem",
            "hostBreakdownItem",
            "projectTopItem",
            "sessionListItem",
            "projectDetail",
            "sessionDetail",
            "timeseriesItem",
        ],
        "artifact_section_count": 8,
    },
    "spool": {
        "status": "ok",
        "error_code": None,
        "error_message": None,
        "state_dir": "<redacted>",
        "backlog_mode": "pending",
        "state_dir_kind": "directory",
        "state_dir_exists": True,
        "ready": 1,
        "processing": 0,
        "quarantine": 0,
        "ready_bytes": 256,
        "processing_bytes": 0,
        "quarantine_bytes": 0,
        "orphan_sidecars": {"ready": 0, "processing": 0, "quarantine": 0, "total": 0},
        "quarantine_reason_counts": {},
        "quarantine_meta_error_counts": {"read_error": 0, "parse_error": 0},
        "oldest_backlog_age_seconds": 42,
        "oldest_quarantine_age_seconds": 0,
        "query_duration_ms": 1,
    },
}
BADGE_SVG_EXAMPLE = (
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"260\" height=\"20\" role=\"img\" "
    "aria-label=\"Clipulse badge\"><rect width=\"120\" height=\"20\" fill=\"#1f2937\"/>"
    "<rect x=\"120\" width=\"140\" height=\"20\" fill=\"#0f766e\"/>"
    "<text x=\"60\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">today time</text>"
    "<text x=\"190\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">1m 0s</text></svg>"
)
TOP_LANGUAGE_BADGE_SVG_EXAMPLE = BADGE_SVG_EXAMPLE.replace("today time", "top language").replace(
    "1m 0s",
    "TypeScript",
)
TODAY_TIME_BADGE_SVG_EXAMPLE = BADGE_SVG_EXAMPLE
THIS_WEEK_BADGE_SVG_EXAMPLE = BADGE_SVG_EXAMPLE.replace("today time", "this week")
LOGGER = logging.getLogger(__name__)


def validate_dashboard_compat_contract_meta(contract_body: dict[str, object]) -> bool:
    meta = contract_body.get("_meta")
    if not isinstance(meta, dict):
        return False

    artifact = meta.get("artifact")
    version = meta.get("version")
    sections = meta.get("sections")
    section_count = meta.get("section_count")
    if artifact != DASHBOARD_COMPAT_ARTIFACT_ID or not isinstance(version, str):
        return False
    if (
        not isinstance(sections, list)
        or not isinstance(section_count, int)
        or isinstance(section_count, bool)
        or section_count < 0
    ):
        return False

    normalized_sections = [section for section in sections if isinstance(section, str) and section]
    if len(normalized_sections) != section_count:
        return False

    return all(isinstance(contract_body.get(section), dict) for section in normalized_sections)


def build_dashboard_compat_metadata(contract_path: Path) -> dict[str, object]:
    # Keep the status payload shape stable even if the checked-in compat artifact is absent.
    digest_source = DASHBOARD_COMPAT_CONTRACT_POINTER.encode("utf-8")
    artifact_version: str | None = None
    artifact_sections: list[str] = []
    artifact_section_count = 0
    artifact_status = "missing"
    artifact_error_code: str | None = None
    artifact_error_message: str | None = None

    if contract_path.exists():
        try:
            contract_bytes = contract_path.read_bytes()
            digest_source = contract_bytes
            contract_body = json.loads(contract_bytes.decode("utf-8"))
        except (OSError, UnicodeDecodeError):
            artifact_error_code = "read_error"
            artifact_error_message = "compat artifact could not be read as UTF-8 text"
            contract_body = None
            artifact_status = "malformed"
        except json.JSONDecodeError:
            artifact_error_code = "parse_error"
            artifact_error_message = "compat artifact is not valid JSON"
            contract_body = None
            artifact_status = "malformed"

        if isinstance(contract_body, dict):
            if validate_dashboard_compat_contract_meta(contract_body):
                artifact_status = "ok"
                artifact_error_code = None
                artifact_error_message = None
                meta = contract_body["_meta"]
                artifact_version = meta["version"]
                artifact_sections = [
                    section for section in meta["sections"] if isinstance(section, str) and section
                ]
                artifact_section_count = meta["section_count"]
            else:
                artifact_status = "malformed"
                artifact_error_code = "parse_error"
                artifact_error_message = "compat artifact `_meta` is missing required dashboard metadata"
        elif contract_body is not None:
            artifact_status = "malformed"
            artifact_error_code = "parse_error"
            artifact_error_message = "compat artifact must be a JSON object"

    return {
        "pointer": DASHBOARD_COMPAT_CONTRACT_POINTER,
        "hash": f"sha256:{hashlib.sha256(digest_source).hexdigest()}",
        "tier": DASHBOARD_COMPAT_TIER,
        "artifact_status": artifact_status,
        "artifact_error_code": artifact_error_code,
        "artifact_error_message": artifact_error_message,
        "surfaces": DASHBOARD_COMPAT_SURFACES,
        "artifact_version": artifact_version,
        "artifact_sections": artifact_sections,
        "artifact_section_count": artifact_section_count,
    }

def create_app(
    database_url: str | None = None,
    *,
    server_token: str | None = None,
    dashboard_token: str | None = None,
    api_bearer_token: str | None = None,
    session_secret: str | None = None,
    public_base_url: str | None = None,
    enable_public_reads: bool | None = None,
    allow_insecure_no_auth: bool | None = None,
    clear_site_data_on_logout: bool | None = None,
    force_secure_session_cookie: bool | None = None,
) -> FastAPI:
    resolved_database_url = database_url or os.environ.get(
        "CLIPULSE_DATABASE_URL",
        "sqlite+pysqlite:///clipulse.sqlite3",
    )
    auth_config = resolve_auth_configuration(
        server_token=server_token,
        dashboard_token=dashboard_token,
        api_bearer_token=api_bearer_token,
        session_secret=session_secret,
        allow_insecure_no_auth=allow_insecure_no_auth,
    )
    resolved_public_base_url = (
        public_base_url
        if public_base_url is not None
        else os.environ.get("CLIPULSE_PUBLIC_BASE_URL")
    )
    resolved_enable_public_reads = (
        enable_public_reads
        if enable_public_reads is not None
        else env_flag("CLIPULSE_ENABLE_PUBLIC_READS")
    )
    resolved_clear_site_data_on_logout = (
        clear_site_data_on_logout
        if clear_site_data_on_logout is not None
        else env_flag("CLIPULSE_LOGOUT_CLEAR_SITE_DATA")
    )
    resolved_force_secure_session_cookie = (
        force_secure_session_cookie
        if force_secure_session_cookie is not None
        else env_flag("CLIPULSE_FORCE_SECURE_SESSION_COOKIE")
    )
    app = FastAPI(title="Clipulse API", version=APP_VERSION)
    session_factory = create_session_factory(resolved_database_url)
    package_dir = Path(__file__).resolve().parent
    web_dir = resolve_runtime_asset_directory(
        package_dir.parents[1] / "web",
        package_dir / "_bundled" / "web",
    )
    contracts_dir = resolve_runtime_asset_directory(
        package_dir.parents[2] / "contracts",
        package_dir / "_bundled" / "contracts",
    )
    status_response_example = {
        **STATUS_RESPONSE_EXAMPLE,
        "auth": build_dashboard_auth_metadata(auth_config),
        "compat": build_dashboard_compat_metadata(
            contracts_dir / DASHBOARD_COMPAT_CONTRACT_POINTER.removeprefix("/contracts/")
        ),
    }

    if contracts_dir.exists():
        app.mount("/contracts", StaticFiles(directory=str(contracts_dir)), name="contracts")

    @app.middleware("http")
    async def require_server_token(request: Request, call_next):
        path = request.url.path
        method = request.method.upper()
        authorization = request.headers.get("Authorization", "")
        cookie_token = request.cookies.get(DASHBOARD_TOKEN_COOKIE_NAME, "")
        request.state.authenticated = False
        request.state.dashboard_authenticated = False

        is_bearer_authenticated = bool(auth_config["api_bearer_token"]) and (
            authorization == f"Bearer {auth_config['api_bearer_token']}"
        )
        is_dashboard_authenticated = bool(auth_config["session_secret"]) and is_valid_dashboard_session_cookie(
            cookie_token,
            auth_config["session_secret"] or "",
        )
        request.state.dashboard_authenticated = is_dashboard_authenticated
        request.state.authenticated = is_bearer_authenticated

        is_protected_static_route = path.startswith("/static/") or path.startswith("/contracts/")
        is_protected_docs_route = path.startswith("/docs") or path in PROTECTED_DOC_PATHS
        is_protected_api_route = path.startswith("/api/v1/")
        is_protected_route = (
            is_protected_api_route or is_protected_static_route or is_protected_docs_route
        )
        if not is_protected_route:
            if not auth_config["protected_mode"]:
                request.state.authenticated = True
                request.state.dashboard_authenticated = True
            response = await call_next(request)
            return apply_private_response_headers(
                response,
                path=path,
                protected_mode=bool(auth_config["protected_mode"]),
                clear_site_data_on_logout=resolved_clear_site_data_on_logout,
            )

        if not auth_config["protected_mode"]:
            request.state.authenticated = True
            request.state.dashboard_authenticated = True
            return await call_next(request)

        is_public_read = (
            is_protected_api_route
            and path.startswith("/api/v1/public/readme/")
            or path.startswith("/api/v1/badges/")
        )
        if is_public_read and resolved_enable_public_reads and not is_bearer_authenticated:
            return await call_next(request)

        if is_bearer_authenticated:
            request.state.authenticated = True
            response = await call_next(request)
            return apply_private_response_headers(
                response,
                path=path,
                protected_mode=True,
                clear_site_data_on_logout=resolved_clear_site_data_on_logout,
            )

        if method in READ_ONLY_METHODS and is_dashboard_authenticated:
            request.state.authenticated = True
            response = await call_next(request)
            return apply_private_response_headers(
                response,
                path=path,
                protected_mode=True,
                clear_site_data_on_logout=resolved_clear_site_data_on_logout,
            )

        if is_dashboard_authenticated and is_protected_api_route:
            return apply_private_response_headers(
                build_api_error_response(
                    api_error(
                        status_code=401,
                        code="authentication_required",
                        message="bearer token is required",
                        hint="Send Authorization: Bearer <token> for Clipulse write routes.",
                    ),
                    headers={"WWW-Authenticate": "Bearer"},
                ),
                path=path,
                protected_mode=True,
                clear_site_data_on_logout=resolved_clear_site_data_on_logout,
            )

        if not request.state.authenticated:
            return apply_private_response_headers(
                build_api_error_response(
                    api_error(
                        status_code=401,
                        code="authentication_required",
                        message="bearer token is required",
                        hint="Send Authorization: Bearer <token> for protected Clipulse API routes.",
                    ),
                    headers={"WWW-Authenticate": "Bearer"},
                ),
                path=path,
                protected_mode=True,
                clear_site_data_on_logout=resolved_clear_site_data_on_logout,
            )

        response = await call_next(request)
        return apply_private_response_headers(
            response,
            path=path,
            protected_mode=True,
            clear_site_data_on_logout=resolved_clear_site_data_on_logout,
        )

    def session_dependency():
        yield from get_session(session_factory)

    SessionDep = Annotated[Session, Depends(session_dependency)]

    @app.get("/static/{asset_path:path}", response_class=FileResponse, include_in_schema=False)
    def get_static_asset(asset_path: str) -> Response:
        asset_file = resolve_static_asset_path(web_dir, asset_path)
        if asset_file is None:
            return Response(status_code=status.HTTP_404_NOT_FOUND)
        return FileResponse(asset_file)

    @app.post(
        "/api/v1/events/batch",
        status_code=status.HTTP_202_ACCEPTED,
        response_model=EventBatchResponse,
    )
    def ingest_events(payload: EventBatchPayload, session: SessionDep) -> EventBatchResponse:
        accepted = 0
        duplicates = 0
        invalid = 0
        seen_event_ids: set[str] = set()
        results: list[dict[str, object] | None] = [None] * len(payload.events)
        pending_events: list[tuple[int, str, EventPayload, dict[str, object]]] = []

        if len(payload.events) > MAX_BATCH_EVENTS:
            return EventBatchResponse.model_validate(
                {
                    "accepted": 0,
                    "duplicates": 0,
                    "invalid": len(payload.events),
                    "results": [
                        invalid_event_result(
                            extract_result_event_id(raw_event),
                            "batch_limit_exceeded",
                            {"max_items": MAX_BATCH_EVENTS},
                        )
                        for raw_event in payload.events
                    ],
                }
            )

        for index, raw_event in enumerate(payload.events):
            event_id = extract_result_event_id(raw_event)
            try:
                event = EventPayload.model_validate(raw_event)
            except ValidationError as exc:
                invalid += 1
                results[index] = (
                    invalid_event_result(
                        event_id,
                        "schema_validation_failed",
                        describe_validation_error(exc),
                    )
                )
                continue

            normalized_event = event.model_dump()
            normalized_event["project_root"] = compute_project_ref(event.project_root)
            event_id = event.event_id or compute_event_id(normalized_event)
            try:
                normalized_event["event_time"] = normalize_event_time(event.event_time)
            except ValueError:
                invalid += 1
                results[index] = invalid_event_result(
                    event_id,
                    "invalid_event_time",
                    {"field": "event_time"},
                )
                continue
            invariant_error = get_event_invariant_error(event)
            if invariant_error is not None:
                invalid += 1
                reason_code, details = invariant_error
                results[index] = invalid_event_result(event_id, reason_code, details)
                continue
            if event_id in seen_event_ids:
                duplicates += 1
                results[index] = duplicate_event_result(event_id, "duplicate_in_batch")
                continue

            seen_event_ids.add(event_id)
            pending_events.append((index, event_id, event, normalized_event))

        existing_event_ids = load_existing_event_ids(
            session,
            [event_id for _index, event_id, _event, _normalized_event in pending_events],
        )

        for index, event_id, event, normalized_event in pending_events:
            if event_id in existing_event_ids:
                duplicates += 1
                results[index] = duplicate_event_result(event_id, "duplicate_stored")
                continue

            record = build_event_record(event_id, event, normalized_event)

            savepoint = session.begin_nested()
            try:
                session.add(record)
                session.flush()
            except IntegrityError as exc:
                savepoint.rollback()
                if not is_duplicate_event_integrity_error(exc):
                    raise
                duplicates += 1
                results[index] = duplicate_event_result(event_id, "duplicate_race")
                continue
            else:
                savepoint.commit()

            accepted += 1
            results[index] = accepted_event_result(event_id)

        session.commit()
        return EventBatchResponse.model_validate(
            {
                "accepted": accepted,
                "duplicates": duplicates,
                "invalid": invalid,
                "results": [result for result in results if result is not None],
            }
        )

    @app.get("/api/v1/overview")
    def get_overview(session: SessionDep) -> dict[str, dict[str, int]]:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=today_start.weekday())
        totals = get_window_totals(session, None)
        today = get_window_totals(session, to_utc_iso(today_start))
        this_week = get_window_totals(session, to_utc_iso(week_start))

        return {
            "totals": totals,
            "today": today,
            "this_week": this_week,
        }

    @app.get("/api/v1/breakdown/languages")
    def get_language_breakdown(session: SessionDep) -> dict[str, list[dict[str, int | str]]]:
        rows = session.execute(
            select(
                LanguageStatRecord.name,
                func.sum(LanguageStatRecord.added),
                func.sum(LanguageStatRecord.removed),
                func.sum(LanguageStatRecord.changed),
            )
            .group_by(LanguageStatRecord.name)
            .order_by(func.sum(LanguageStatRecord.changed).desc(), LanguageStatRecord.name.asc())
        ).all()

        return {
            "items": [
                {
                    "name": str(row[0]),
                    "added": int(row[1] or 0),
                    "removed": int(row[2] or 0),
                    "changed": int(row[3] or 0),
                }
                for row in rows
            ]
        }

    @app.get("/api/v1/breakdown/models")
    def get_model_breakdown(session: SessionDep) -> dict[str, list[dict[str, int | str]]]:
        rows = session.execute(
            select(
                EventRecord.model_name,
                func.count(EventRecord.id),
                func.sum(EventRecord.active_ms),
                func.sum(EventRecord.wait_ms),
            )
            .group_by(EventRecord.model_name)
            .order_by(func.sum(EventRecord.active_ms).desc(), EventRecord.model_name.asc())
        ).all()

        return {
            "items": [
                {
                    "name": str(row[0]),
                    "events": int(row[1] or 0),
                    "active_ms": int(row[2] or 0),
                    "wait_ms": int(row[3] or 0),
                }
                for row in rows
            ]
        }

    @app.get("/api/v1/breakdown/hosts")
    def get_host_breakdown(session: SessionDep) -> dict[str, list[dict[str, int | str]]]:
        rows = session.execute(
            select(
                EventRecord.host,
                func.count(EventRecord.id),
                func.sum(EventRecord.active_ms),
                func.sum(EventRecord.wait_ms),
            )
            .group_by(EventRecord.host)
            .order_by(func.sum(EventRecord.active_ms).desc(), EventRecord.host.asc())
        ).all()

        return {
            "items": [
                {
                    "name": str(row[0]),
                    "events": int(row[1] or 0),
                    "active_ms": int(row[2] or 0),
                    "wait_ms": int(row[3] or 0),
                }
                for row in rows
            ]
        }

    @app.get(
        "/api/v1/badges/top-language.svg",
        response_class=Response,
        response_description="SVG badge for the current top language rollup.",
        responses={
            200: {
                "description": "SVG badge for the current top language rollup.",
                "content": {"image/svg+xml": {"example": TOP_LANGUAGE_BADGE_SVG_EXAMPLE}},
            }
        },
    )
    def get_top_language_badge(session: SessionDep) -> Response:
        top_language = session.execute(
            select(
                LanguageStatRecord.name,
                func.sum(LanguageStatRecord.changed),
            )
            .group_by(LanguageStatRecord.name)
            .order_by(func.sum(LanguageStatRecord.changed).desc(), LanguageStatRecord.name.asc())
            .limit(1)
        ).first()

        label = "top language"
        value = "none"
        if top_language:
            value = str(top_language[0])

        return build_badge_response(label, value)

    @app.get(
        "/api/v1/badges/today-time.svg",
        response_class=Response,
        response_description="SVG badge for today's active coding time.",
        responses={
            200: {
                "description": "SVG badge for today's active coding time.",
                "content": {"image/svg+xml": {"example": TODAY_TIME_BADGE_SVG_EXAMPLE}},
            }
        },
    )
    def get_today_time_badge(session: SessionDep) -> Response:
        now = datetime.now(UTC)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        totals = get_window_totals(session, to_utc_iso(start))
        return build_badge_response("today time", format_duration_ms(totals["active_ms"]))

    @app.get(
        "/api/v1/badges/this-week-time.svg",
        response_class=Response,
        response_description="SVG badge for this week's active coding time.",
        responses={
            200: {
                "description": "SVG badge for this week's active coding time.",
                "content": {"image/svg+xml": {"example": THIS_WEEK_BADGE_SVG_EXAMPLE}},
            }
        },
    )
    def get_this_week_time_badge(session: SessionDep) -> Response:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=today_start.weekday())
        totals = get_window_totals(session, to_utc_iso(week_start))
        return build_badge_response("this week", format_duration_ms(totals["active_ms"]))

    @app.get("/api/v1/timeseries")
    def get_timeseries(session: SessionDep) -> dict[str, list[dict[str, int | str]]]:
        normalized_date = func.date(func.datetime(EventRecord.event_time))
        rows = session.execute(
            select(
                normalized_date,
                func.count(EventRecord.id),
                func.sum(EventRecord.active_ms),
                func.sum(EventRecord.wait_ms),
            )
            .group_by(normalized_date)
            .order_by(normalized_date.asc())
        ).all()

        return {
            "items": [
                {
                    "date": str(row[0]),
                    "events": int(row[1] or 0),
                    "active_ms": int(row[2] or 0),
                    "wait_ms": int(row[3] or 0),
                }
                for row in rows
            ]
        }

    @app.get("/api/v1/projects/top", response_model=ProjectListResponse)
    def get_top_projects(
        session: SessionDep,
        limit: int = Query(
            default=5,
            description=f"Maximum number of summary-first project rollups to return. `0` returns an empty list instead of failing. Values above the server-side maximum of `{MAX_LIST_LIMIT}` are clamped instead of rejected.",
        ),
    ) -> ProjectListResponse:
        records = load_reporting_records(session)
        items = sort_project_items(build_project_list_items(records, compute_project_ref))
        normalized_limit = clamp_list_limit(limit)

        return ProjectListResponse(
            items=[
                ProjectListItemResponse.model_validate(item)
                for item in items[:normalized_limit]
            ]
        )

    @app.get(
        "/api/v1/sessions/recent",
        response_model=SessionListResponse | CompactSessionListResponse,
    )
    def get_recent_sessions(
        session: SessionDep,
        limit: int = Query(
            default=10,
            description=f"Maximum number of summary-first recent session rollups to return. `0` returns an empty list instead of failing. Values above the server-side maximum of `{MAX_LIST_LIMIT}` are clamped instead of rejected.",
        ),
        compact: bool = Query(
            default=False,
            description="When `true`, omits `host_model_mix` from each session list item while keeping `host_model_mix_count` and `host_model_primary`. When `false`, preserve the backward-compatible full list contract.",
        ),
    ) -> SessionListResponse | CompactSessionListResponse:
        records = load_reporting_records(session)
        summaries = sort_session_items(
            build_session_list_items(
                records,
                compute_project_ref,
                include_host_model_mix=not compact,
            )
        )
        normalized_limit = clamp_list_limit(limit)

        item_model = CompactSessionListItemResponse if compact else SessionListItemResponse
        response_model = CompactSessionListResponse if compact else SessionListResponse

        return response_model(
            items=[item_model.model_validate(item) for item in summaries[:normalized_limit]]
        )

    @app.get(
        "/api/v1/sessions/{session_id}",
        response_model=SessionDetailResponse,
        responses={
            404: NOT_FOUND_RESPONSE,
            409: AMBIGUOUS_SESSION_RESPONSE,
        },
    )
    def get_session_detail(
        session_id: str,
        session: SessionDep,
        project_ref: str | None = Query(
            default=None,
            description="Optional project_ref that scopes session detail lookup when the same session_id appears in multiple projects. Supply it to disambiguate ambiguous session_id matches.",
        ),
    ) -> SessionDetailResponse:
        detail_lookup = load_session_detail_records(
            session,
            session_id=session_id,
            project_ref=project_ref,
        )
        return SessionDetailResponse.model_validate(
            build_session_detail(
                detail_lookup["records"],
                detail_lookup["project_root"],
                compute_project_ref,
                project_name=str(detail_lookup["project_name"]),
            )
        )

    @app.get(
        "/api/v1/projects/{project_ref}",
        response_model=ProjectDetailResponse,
        responses={404: NOT_FOUND_RESPONSE},
    )
    def get_project_detail(
        project_ref: str,
        session: SessionDep,
    ) -> ProjectDetailResponse:
        project = require_project_by_ref(session, project_ref)
        records = load_reporting_records(session, project_root=project["project_root"])
        return ProjectDetailResponse.model_validate(
            build_project_detail(records, project["project_root"], compute_project_ref)
        )

    @app.get(
        "/api/v1/projects/{project_ref}/sessions",
        response_model=ProjectSessionsResponse | CompactProjectSessionsResponse,
        responses={404: NOT_FOUND_RESPONSE},
    )
    def get_project_sessions(
        project_ref: str,
        session: SessionDep,
        limit: int = Query(
            default=20,
            description=f"Maximum number of summary-first project-scoped session rollups to return. `0` returns an empty list instead of failing. Values above the server-side maximum of `{MAX_LIST_LIMIT}` are clamped instead of rejected.",
        ),
        compact: bool = Query(
            default=False,
            description="When `true`, omits `host_model_mix` from each project-scoped session list item while keeping `host_model_mix_count` and `host_model_primary`. When `false`, preserve the backward-compatible full list contract.",
        ),
    ) -> ProjectSessionsResponse | CompactProjectSessionsResponse:
        project = require_project_by_ref(session, project_ref)
        records = load_reporting_records(session, project_root=project["project_root"])
        project_detail = build_project_detail(records, project["project_root"], compute_project_ref)
        session_summaries = sort_session_items(
            build_session_list_items(
                records,
                compute_project_ref,
                include_host_model_mix=not compact,
            )
        )
        normalized_limit = clamp_list_limit(limit)

        # Keep this endpoint summary-first: session detail lives on the dedicated route,
        # but the default list payload still keeps host_model_mix for backward compatibility.
        item_model = CompactSessionListItemResponse if compact else SessionListItemResponse
        response_model = CompactProjectSessionsResponse if compact else ProjectSessionsResponse

        return response_model(
            project_ref=project_ref,
            project_name=str(project_detail["project_name"]),
            items=[item_model.model_validate(item) for item in session_summaries[:normalized_limit]],
        )

    @app.get(
        "/api/v1/status",
        response_model=DashboardStatusResponse,
        response_description="Self-hosted status snapshot for the API, database, and local spool state.",
        responses={
            200: {
                "description": "Self-hosted status snapshot for the API, database, and local spool state.",
                "content": {"application/json": {"example": status_response_example}},
            }
        },
    )
    def get_dashboard_status(session: SessionDep) -> DashboardStatusResponse:
        state_dir = resolve_state_dir()
        generated_at = to_utc_iso(datetime.now(UTC))
        return DashboardStatusResponse.model_validate(
            {
                "api": {"status": "ok", "version": APP_VERSION},
                "auth": build_dashboard_auth_metadata(auth_config),
                "generated_at": generated_at,
                "db": build_database_status(session, generated_at),
                "compat": build_dashboard_compat_metadata(
                    contracts_dir / DASHBOARD_COMPAT_CONTRACT_POINTER.removeprefix("/contracts/")
                ),
                "spool": build_spool_status(state_dir),
            }
        )

    @app.get(
        "/api/v1/public/readme/top-language",
        response_model=ReadmeSnippetResponse,
        response_description="README markdown snippet that embeds the live top-language badge.",
        responses={
            200: {
                "description": "README markdown snippet that embeds the live top-language badge.",
                "content": {
                    "application/json": {
                        "example": {
                            "markdown": "![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)"
                        }
                    }
                },
            }
        },
    )
    def get_public_top_language_markdown(request: Request) -> ReadmeSnippetResponse:
        return ReadmeSnippetResponse(
            markdown=build_badge_markdown(
                request,
                "top-language.svg",
                "Clipulse Top Language",
                public_base_url=resolved_public_base_url,
                allow_request_base_url_fallback=should_allow_public_base_url_fallback(
                    request,
                    auth_config["dashboard_token"],
                ),
            )
        )

    @app.get(
        "/api/v1/public/readme/today-time",
        response_model=ReadmeSnippetResponse,
        response_description="README markdown snippet that embeds the live today-time badge.",
        responses={
            200: {
                "description": "README markdown snippet that embeds the live today-time badge.",
                "content": {
                    "application/json": {
                        "example": {
                            "markdown": "![Clipulse Today Time](https://clipulse.example/api/v1/badges/today-time.svg)"
                        }
                    }
                },
            }
        },
    )
    def get_public_today_time_markdown(request: Request) -> ReadmeSnippetResponse:
        return ReadmeSnippetResponse(
            markdown=build_badge_markdown(
                request,
                "today-time.svg",
                "Clipulse Today Time",
                public_base_url=resolved_public_base_url,
                allow_request_base_url_fallback=should_allow_public_base_url_fallback(
                    request,
                    auth_config["dashboard_token"],
                ),
            )
        )

    @app.get(
        "/api/v1/public/readme/this-week-time",
        response_model=ReadmeSnippetResponse,
        response_description="README markdown snippet that embeds the live this-week-time badge.",
        responses={
            200: {
                "description": "README markdown snippet that embeds the live this-week-time badge.",
                "content": {
                    "application/json": {
                        "example": {
                            "markdown": "![Clipulse This Week Time](https://clipulse.example/api/v1/badges/this-week-time.svg)"
                        }
                    }
                },
            }
        },
    )
    def get_public_this_week_time_markdown(request: Request) -> ReadmeSnippetResponse:
        return ReadmeSnippetResponse(
            markdown=build_badge_markdown(
                request,
                "this-week-time.svg",
                "Clipulse This Week Time",
                public_base_url=resolved_public_base_url,
                allow_request_base_url_fallback=should_allow_public_base_url_fallback(
                    request,
                    auth_config["dashboard_token"],
                ),
            )
        )

    @app.post("/dashboard-login", status_code=status.HTTP_204_NO_CONTENT)
    async def dashboard_login(request: Request) -> Response:
        if not auth_config["protected_mode"] or not auth_config["dashboard_token"]:
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        token = await read_dashboard_login_token(request)
        if token != auth_config["dashboard_token"]:
            locale = resolve_dashboard_locale(
                request.headers.get("cookie"),
                request.headers.get("accept-language"),
            )
            copy = get_dashboard_login_copy(locale)
            response = build_api_error_response(
                api_error(
                    status_code=401,
                    code="dashboard_authentication_failed",
                    message=copy["invalid_token_api_message"],
                    hint=copy["invalid_token_api_hint"],
                ),
            )
            merge_vary_headers(response, DASHBOARD_LOCALE_VARY_HEADERS)
            return response

        response = Response(status_code=status.HTTP_204_NO_CONTENT)
        response.set_cookie(
            DASHBOARD_TOKEN_COOKIE_NAME,
            create_dashboard_session_cookie_value(auth_config["session_secret"] or ""),
            httponly=True,
            max_age=DASHBOARD_SESSION_TTL_SECONDS,
            samesite="lax",
            secure=should_use_secure_dashboard_cookie(
                request,
                force_secure_session_cookie=resolved_force_secure_session_cookie,
            ),
        )
        return response

    @app.post("/dashboard-logout", status_code=status.HTTP_204_NO_CONTENT)
    async def dashboard_logout() -> Response:
        response = Response(status_code=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(DASHBOARD_TOKEN_COOKIE_NAME)
        return response

    @app.get("/")
    def dashboard_shell(request: Request) -> Response:
        locale = resolve_dashboard_locale(
            request.headers.get("cookie"),
            request.headers.get("accept-language"),
        )
        if (
            auth_config["protected_mode"]
            and auth_config["dashboard_token"]
            and not getattr(request.state, "dashboard_authenticated", False)
        ):
            response = HTMLResponse(
                build_dashboard_login_page(
                    build_dashboard_base_href(request.scope.get("root_path", "")),
                    locale=locale,
                )
            )
            merge_vary_headers(response, DASHBOARD_LOCALE_VARY_HEADERS)
            return response

        response = HTMLResponse(
            build_dashboard_shell_html(
                web_dir,
                build_dashboard_base_href(request.scope.get("root_path", "")),
                locale=locale,
            )
        )
        merge_vary_headers(response, DASHBOARD_LOCALE_VARY_HEADERS)
        return response

    @app.get(
        "/healthz",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    def healthcheck() -> Response:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema

        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        components = schema.setdefault("components", {})
        security_schemes = components.setdefault("securitySchemes", {})
        security_schemes["BearerAuth"] = {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "API token",
        }

        for path, operations in schema.get("paths", {}).items():
            if not path.startswith("/api/v1/"):
                continue

            is_public_read = path.startswith("/api/v1/public/readme/") or path.startswith(
                "/api/v1/badges/"
            )
            for method_name, operation in operations.items():
                if method_name not in {"get", "post", "put", "patch", "delete"}:
                    continue

                responses = operation.setdefault("responses", {})
                responses.setdefault("401", build_openapi_api_error_response("Authentication required."))
                responses.setdefault("503", build_openapi_api_error_response("Server configuration required."))

                if not is_public_read and auth_config["protected_mode"]:
                    operation["security"] = [{"BearerAuth": []}]

        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi

    return app


def build_database_status(session: Session, generated_at: str) -> dict[str, object]:
    started_at = perf_counter()
    try:
        totals = load_database_status(session)
        latest_event_time = load_latest_event_time(session)
        latest_event_age_seconds = (
            compute_event_age_seconds(latest_event_time, generated_at)
            if latest_event_time is not None
            else None
        )
        status_value = "ok"
        error_code = None
        error_message = None
    except Exception:
        LOGGER.exception("Database status collection failed.")
        totals = {"events": 0, "projects": 0, "sessions": 0}
        latest_event_time = None
        latest_event_age_seconds = None
        status_value = "degraded"
        error_code = "database_query_failed"
        error_message = sanitize_status_error_message("database")

    return {
        "status": status_value,
        **totals,
        "error_code": error_code,
        "error_message": error_message,
        "latest_event_time": latest_event_time,
        "latest_event_age_seconds": latest_event_age_seconds,
        "query_duration_ms": build_query_duration_ms(started_at),
    }


def build_dashboard_auth_metadata(
    auth_config: dict[str, object],
) -> dict[str, object]:
    auth_enabled = bool(auth_config["protected_mode"])
    return {
        "auth_mode": auth_config["auth_mode"],
        "dashboard_auth_required": auth_enabled,
        "browser_session_enabled": auth_enabled,
        "browser_session_scope": "read_only" if auth_enabled else "disabled",
        "legacy_single_token": bool(auth_config["legacy_single_token"]),
    }


def should_allow_public_base_url_fallback(
    request: Request,
    server_token: str | None,
) -> bool:
    del request
    del server_token
    return False


def resolve_auth_configuration(
    *,
    server_token: str | None,
    dashboard_token: str | None,
    api_bearer_token: str | None,
    session_secret: str | None,
    allow_insecure_no_auth: bool | None,
) -> dict[str, object]:
    resolved_allow_insecure_no_auth = (
        allow_insecure_no_auth
        if allow_insecure_no_auth is not None
        else env_flag("CLIPULSE_ALLOW_INSECURE_NO_AUTH")
    )
    resolved_server_token = normalize_optional_secret(
        server_token if server_token is not None else os.environ.get("CLIPULSE_SERVER_TOKEN")
    )
    resolved_dashboard_token = normalize_optional_secret(
        dashboard_token
        if dashboard_token is not None
        else os.environ.get("CLIPULSE_DASHBOARD_TOKEN")
    )
    resolved_api_bearer_token = normalize_optional_secret(
        api_bearer_token
        if api_bearer_token is not None
        else os.environ.get("CLIPULSE_API_BEARER_TOKEN")
    )
    resolved_session_secret = normalize_optional_secret(
        session_secret
        if session_secret is not None
        else os.environ.get("CLIPULSE_SESSION_SECRET")
    )
    split_config_present = any(
        value is not None
        for value in [
            resolved_dashboard_token,
            resolved_api_bearer_token,
            resolved_session_secret,
        ]
    )

    if split_config_present:
        missing_names = [
            name
            for name, value in [
                ("CLIPULSE_DASHBOARD_TOKEN", resolved_dashboard_token),
                ("CLIPULSE_API_BEARER_TOKEN", resolved_api_bearer_token),
                ("CLIPULSE_SESSION_SECRET", resolved_session_secret),
            ]
            if value is None
        ]
        if missing_names:
            raise RuntimeError(
                "Clipulse protected mode requires all split auth secrets: "
                + ", ".join(missing_names)
            )
        return {
            "auth_mode": "split",
            "protected_mode": True,
            "legacy_single_token": False,
            "dashboard_token": resolved_dashboard_token,
            "api_bearer_token": resolved_api_bearer_token,
            "session_secret": resolved_session_secret,
        }

    if resolved_server_token is not None:
        return {
            "auth_mode": "legacy_single_token",
            "protected_mode": True,
            "legacy_single_token": True,
            "dashboard_token": resolved_server_token,
            "api_bearer_token": resolved_server_token,
            "session_secret": resolved_server_token,
        }

    if resolved_allow_insecure_no_auth:
        return {
            "auth_mode": "insecure_no_auth",
            "protected_mode": False,
            "legacy_single_token": False,
            "dashboard_token": None,
            "api_bearer_token": None,
            "session_secret": None,
        }

    raise RuntimeError(
        "Clipulse requires auth configuration. Set CLIPULSE_DASHBOARD_TOKEN, "
        "CLIPULSE_API_BEARER_TOKEN, and CLIPULSE_SESSION_SECRET, or opt into "
        "local insecure mode with CLIPULSE_ALLOW_INSECURE_NO_AUTH=1."
    )


def normalize_optional_secret(value: str | None) -> str | None:
    if value is None:
        return None

    stripped_value = value.strip()
    return stripped_value or None


def apply_private_response_headers(
    response: Response,
    *,
    path: str,
    protected_mode: bool,
    clear_site_data_on_logout: bool = False,
) -> Response:
    if not should_apply_private_response_headers(path, protected_mode):
        return response

    response.headers["Cache-Control"] = PRIVATE_CACHE_CONTROL
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    merge_vary_headers(response, get_private_vary_headers(path))
    if path == "/dashboard-logout" and clear_site_data_on_logout:
        response.headers["Clear-Site-Data"] = '"cache", "cookies", "storage"'
    return response


def should_apply_private_response_headers(path: str, protected_mode: bool) -> bool:
    if not protected_mode:
        return False

    return (
        path == "/"
        or path in {"/dashboard-login", "/dashboard-logout"}
        or path.startswith("/api/v1/")
        or path.startswith("/static/")
        or path.startswith("/contracts/")
        or path.startswith("/docs")
        or path in PROTECTED_DOC_PATHS
    )


def get_private_vary_headers(path: str) -> tuple[str, ...]:
    if path in {"/", "/dashboard-login"}:
        return DASHBOARD_LOCALE_VARY_HEADERS
    if path == "/dashboard-logout":
        return ("Cookie",)
    return PRIVATE_AUTH_VARY_HEADERS


def merge_vary_headers(response: Response, values: tuple[str, ...]) -> None:
    existing = {
        item.strip()
        for item in response.headers.get("Vary", "").split(",")
        if item.strip()
    }
    response.headers["Vary"] = ", ".join([*sorted(existing.union(values))])


def resolve_runtime_asset_directory(
    repo_directory: Path,
    bundled_directory: Path,
) -> Path:
    if repo_directory.exists():
        return repo_directory
    return bundled_directory


def build_spool_status(state_dir: Path) -> dict[str, object]:
    started_at = perf_counter()
    try:
        spool_status = collect_spool_status(state_dir)
        status_value = "ok"
        error_code = None
        error_message = None
    except Exception:
        LOGGER.exception("Spool status collection failed.")
        spool_status = build_spool_status_fallback(state_dir)
        status_value = "degraded"
        error_code = "spool_status_failed"
        error_message = sanitize_status_error_message("spool")

    return {
        "status": status_value,
        "error_code": error_code,
        "error_message": error_message,
        **{**spool_status, "state_dir": "<redacted>"},
        "query_duration_ms": build_query_duration_ms(started_at),
    }


def get_window_totals(session: Session, start_iso: str | None) -> dict[str, int]:
    query = select(
        func.count(EventRecord.id),
        func.coalesce(func.sum(EventRecord.active_ms), 0),
        func.coalesce(func.sum(EventRecord.wait_ms), 0),
    )
    if start_iso is not None:
        query = query.where(func.datetime(EventRecord.event_time) >= func.datetime(start_iso))

    totals = session.execute(query).one()

    return {
        "events": int(totals[0] or 0),
        "active_ms": int(totals[1] or 0),
        "wait_ms": int(totals[2] or 0),
    }


def clamp_list_limit(limit: int) -> int:
    return min(max(limit, 0), MAX_LIST_LIMIT)


def is_duplicate_event_integrity_error(error: IntegrityError) -> bool:
    message = str(error.orig).lower() if error.orig is not None else str(error).lower()
    return "unique constraint failed" in message and "events.event_id" in message


def format_duration_ms(duration_ms: int) -> str:
    total_seconds = max(duration_ms // 1000, 0)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {seconds}s"
    return f"{seconds}s"


def build_badge_response(label: str, value: str) -> Response:
    safe_label = escape(label, quote=True)
    safe_value = escape(value, quote=True)
    svg = (
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"260\" height=\"20\" role=\"img\" "
        "aria-label=\"Clipulse badge\">"
        "<rect width=\"120\" height=\"20\" fill=\"#1f2937\"/>"
        "<rect x=\"120\" width=\"140\" height=\"20\" fill=\"#0f766e\"/>"
        f"<text x=\"60\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">{safe_label}</text>"
        f"<text x=\"190\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">{safe_value}</text>"
        "</svg>"
    )
    return Response(content=svg, media_type="image/svg+xml")


def compute_event_id(payload: dict[str, object]) -> str:
    event_payload = {key: value for key, value in payload.items() if key != "event_id"}
    event_time = event_payload.get("event_time")
    if isinstance(event_time, str):
        try:
            event_payload["event_time"] = normalize_event_time(event_time)
        except ValueError:
            # Keep the original timestamp text for invalid payloads so callers
            # can still produce a stable id for per-event error reporting.
            pass
    serialized = json.dumps(event_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def normalize_event_time(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return to_utc_iso(parsed.astimezone(UTC))


def describe_validation_error(error: ValidationError) -> dict[str, object]:
    error_entry = error.errors()[0] if error.errors() else {}
    location = error_entry.get("loc") if isinstance(error_entry, dict) else None
    field = None
    if isinstance(location, tuple) and location:
        field = str(location[-1])

    details: dict[str, object] = {}
    if field:
        details["field"] = field

    return details


def get_event_invariant_error(
    event: EventPayload,
) -> tuple[str, dict[str, object]] | None:
    if not event.session_id.strip():
        return ("blank_session_id", {"field": "session_id"})
    if not event.project_root.strip():
        return ("blank_project_root", {"field": "project_root"})

    if event.active_ms < 0:
        return ("negative_metric", {"field": "active_ms"})
    if event.wait_ms < 0:
        return ("negative_metric", {"field": "wait_ms"})

    if len(event.language_stats) > MAX_LANGUAGE_STATS_ITEMS:
        return ("language_stats_limit_exceeded", {"max_items": MAX_LANGUAGE_STATS_ITEMS})
    if len(event.file_deltas) > MAX_FILE_DELTAS_ITEMS:
        return ("file_deltas_limit_exceeded", {"max_items": MAX_FILE_DELTAS_ITEMS})

    for field_name, max_length in EVENT_TEXT_LIMITS.items():
        field_value = getattr(event, field_name)
        if len(field_value) > max_length:
            return ("field_too_long", {"field": field_name, "max_length": max_length})

    for language, stats in event.language_stats.items():
        if len(language) > MAX_GENERIC_TEXT_LENGTH:
            return ("field_too_long", {"field": "language_stats", "max_length": MAX_GENERIC_TEXT_LENGTH})
        if (
            stats.added < 0
            or stats.removed < 0
            or stats.changed < 0
        ):
            return ("negative_metric", {"field": "language_stats", "language": language})
        if stats.changed != stats.added + stats.removed:
            return ("language_stats_mismatch", {"language": language})

    for delta in event.file_deltas:
        if len(delta.fingerprint) > MAX_GENERIC_TEXT_LENGTH:
            return ("field_too_long", {"field": "file_deltas.fingerprint", "max_length": MAX_GENERIC_TEXT_LENGTH})
        if len(delta.language) > MAX_GENERIC_TEXT_LENGTH:
            return ("field_too_long", {"field": "file_deltas.language", "max_length": MAX_GENERIC_TEXT_LENGTH})
        if delta.added < 0:
            return ("negative_metric", {"field": "file_deltas.added"})
        if delta.removed < 0:
            return ("negative_metric", {"field": "file_deltas.removed"})

    return None


def load_existing_event_ids(session: Session, event_ids: list[str]) -> set[str]:
    if not event_ids:
        return set()

    rows = session.execute(
        select(EventRecord.event_id).where(EventRecord.event_id.in_(event_ids))
    ).all()
    return {str(row[0]) for row in rows}


def build_event_record(
    event_id: str,
    event: EventPayload,
    normalized_event: dict[str, object],
) -> EventRecord:
    record = EventRecord(
        event_id=event_id,
        host=event.host,
        host_version=event.host_version,
        session_id=event.session_id,
        project_root=compute_project_ref(event.project_root),
        project_name=event.project_name,
        git_branch=event.git_branch,
        event_name=event.event_name,
        event_time=str(normalized_event["event_time"]),
        model_name=event.model_name,
        os_name=event.os_name,
        editor_or_terminal=event.editor_or_terminal,
        active_ms=event.active_ms,
        wait_ms=event.wait_ms,
        privacy_mode=event.privacy_mode,
    )

    for name, stats in event.language_stats.items():
        record.language_stats.append(
            LanguageStatRecord(
                name=name,
                added=stats.added,
                removed=stats.removed,
                changed=stats.changed,
            )
        )

    for delta in event.file_deltas:
        record.file_deltas.append(
            FileDeltaRecord(
                fingerprint=delta.fingerprint,
                language=delta.language,
                added=delta.added,
                removed=delta.removed,
            )
        )

    return record


def build_event_result(
    event_id: str,
    status: str,
    *,
    retryable: bool = False,
    reason_code: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, object]:
    return {
        "event_id": event_id,
        "status": status,
        "retryable": retryable,
        "reason_code": reason_code,
        "details": details,
    }


def accepted_event_result(event_id: str) -> dict[str, object]:
    return build_event_result(event_id, "accepted")


def duplicate_event_result(
    event_id: str,
    reason_code: str,
    details: dict[str, Any] | None = None,
) -> dict[str, object]:
    return build_event_result(
        event_id,
        "duplicate",
        reason_code=reason_code,
        details=details or {"event_id": event_id},
    )


def invalid_event_result(
    event_id: str,
    reason_code: str,
    details: dict[str, Any] | None = None,
) -> dict[str, object]:
    return build_event_result(
        event_id,
        "invalid",
        reason_code=reason_code,
        details=details,
    )


def extract_result_event_id(payload: dict[str, object]) -> str:
    event_id = payload.get("event_id")
    if isinstance(event_id, str) and event_id:
        return event_id

    return compute_event_id(payload)


def build_badge_markdown(
    request: Request,
    badge_name: str,
    alt_text: str,
    *,
    public_base_url: str | None = None,
    allow_request_base_url_fallback: bool = False,
) -> str:
    badge_url = build_badge_url(
        request,
        badge_name,
        public_base_url=public_base_url,
        allow_request_base_url_fallback=allow_request_base_url_fallback,
    )
    return f"![{alt_text}]({badge_url})"


def build_badge_url(
    request: Request,
    badge_name: str,
    *,
    public_base_url: str | None = None,
    allow_request_base_url_fallback: bool = False,
) -> str:
    resolved_public_base_url = (public_base_url or "").strip()
    if resolved_public_base_url:
        base_url = urlsplit(resolved_public_base_url)
    elif allow_request_base_url_fallback:
        base_url = urlsplit(str(request.base_url))
    else:
        raise api_error(
            status_code=503,
            code="public_base_url_not_configured",
            message="public base URL is not configured",
            hint="Set CLIPULSE_PUBLIC_BASE_URL before generating README snippets outside local tests.",
        )
    normalized_path = normalize_url_path(f"{base_url.path}/api/v1/badges/{badge_name}")
    return urlunsplit((base_url.scheme, base_url.netloc, normalized_path, "", ""))


def normalize_url_path(path: str) -> str:
    parts = [part for part in path.split("/") if part]
    if not parts:
        return "/"
    return "/" + "/".join(parts)


def load_latest_event_time(session: Session) -> str | None:
    latest_event_time = session.scalar(
        select(EventRecord.event_time)
        .order_by(func.datetime(EventRecord.event_time).desc(), EventRecord.id.desc())
        .limit(1)
    )
    if latest_event_time is None:
        return None

    return normalize_event_time(str(latest_event_time))


def build_query_duration_ms(started_at: float) -> int:
    return max(int((perf_counter() - started_at) * 1000), 0)


def compute_event_age_seconds(event_time: str, generated_at: str) -> int:
    event_dt = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
    generated_dt = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    return max(int((generated_dt - event_dt).total_seconds()), 0)


def to_utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


EVENT_TEXT_LIMITS = {
    "host": 64,
    "host_version": 128,
    "session_id": 256,
    "project_root": MAX_PROJECT_ROOT_LENGTH,
    "project_name": MAX_GENERIC_TEXT_LENGTH,
    "git_branch": MAX_GENERIC_TEXT_LENGTH,
    "event_name": 128,
    "model_name": 128,
    "os_name": 64,
    "editor_or_terminal": 64,
    "privacy_mode": 64,
}


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def sanitize_status_error_message(scope: str) -> str:
    return f"{scope} status is degraded; inspect server logs for details."


def build_api_error_response(
    error: Exception,
    *,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    detail = getattr(error, "detail", None)
    status_code = getattr(error, "status_code", status.HTTP_500_INTERNAL_SERVER_ERROR)
    return JSONResponse(status_code=status_code, content={"detail": detail}, headers=headers)


async def read_dashboard_login_token(request: Request) -> str:
    try:
        payload = await request.json()
    except Exception:
        return ""

    if not isinstance(payload, dict):
        return ""

    token = payload.get("token")
    if isinstance(token, str):
        return token.strip()

    return ""


def create_dashboard_session_cookie_value(server_token: str) -> str:
    issued_at = str(int(datetime.now(UTC).timestamp()))
    signature = sign_dashboard_session_value(server_token, issued_at)
    return f"{issued_at}:{signature}"


def is_valid_dashboard_session_cookie(cookie_value: str, server_token: str) -> bool:
    if not cookie_value or not server_token:
        return False

    issued_at, separator, signature = cookie_value.partition(":")
    if not separator or not issued_at.isdigit() or not signature:
        return False

    max_age_deadline = int(datetime.now(UTC).timestamp()) - DASHBOARD_SESSION_TTL_SECONDS
    if int(issued_at) < max_age_deadline:
        return False

    expected_signature = sign_dashboard_session_value(server_token, issued_at)
    return hmac.compare_digest(signature, expected_signature)


def sign_dashboard_session_value(server_token: str, issued_at: str) -> str:
    return hmac.new(
        server_token.encode("utf-8"),
        f"dashboard:{issued_at}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def normalize_dashboard_locale(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip().replace("_", "-")
    if not normalized:
        return None

    lowered = normalized.lower()
    if lowered == "en" or lowered.startswith("en-"):
        return "en"
    if lowered in {"zh-tw", "zh-hk", "zh-mo"} or lowered.startswith("zh-hant"):
        return "zh-TW"
    if lowered in {"zh-cn", "zh-sg"} or lowered.startswith("zh-hans") or lowered.startswith("zh-"):
        return "zh-CN"
    if lowered == "pt-br" or lowered.startswith("pt-"):
        return "pt-BR"

    for locale in DASHBOARD_SUPPORTED_LOCALES:
        if locale.lower() == lowered or locale.lower() == lowered.split("-")[0]:
            return locale

    return None


def read_dashboard_locale_cookie(cookie_header: str | None) -> str | None:
    if not cookie_header:
        return None

    matched_locale: str | None = None
    for raw_cookie in cookie_header.split(";"):
        name, _, raw_value = raw_cookie.strip().partition("=")
        if name not in (DASHBOARD_LOCALE_COOKIE_NAME, *LEGACY_DASHBOARD_LOCALE_COOKIE_NAMES):
            continue
        normalized_locale = normalize_dashboard_locale(raw_value)
        if normalized_locale is not None:
            matched_locale = normalized_locale

    return matched_locale


def resolve_dashboard_locale(cookie_header: str | None, accept_language_header: str | None) -> str:
    cookie_locale = read_dashboard_locale_cookie(cookie_header)
    if cookie_locale is not None:
        return cookie_locale

    if accept_language_header:
        for raw_part in accept_language_header.split(","):
            candidate = raw_part.split(";", 1)[0].strip()
            normalized = normalize_dashboard_locale(candidate)
            if normalized is not None:
                return normalized

    return DASHBOARD_DEFAULT_LOCALE


def build_dashboard_base_href(root_path: str) -> str:
    normalized_root_path = normalize_url_path(root_path)
    if normalized_root_path == "/":
        return "/"

    return f"{normalized_root_path}/"


DASHBOARD_LOGIN_TRANSLATIONS_FALLBACK = {
    "en": {
        "title": "Clipulse Dashboard Login",
        "heading": "Protected Clipulse dashboard",
        "message": DASHBOARD_LOGIN_ERROR_MESSAGE,
        "help": "Enter the dashboard access token for this Clipulse deployment.",
        "token_label": "Dashboard access token",
        "submit": "Open dashboard",
        "invalid_token": "Invalid token. Check the dashboard access token and try again.",
        "failed": "Dashboard login failed. Check the proxy and server logs, then retry.",
        "network_failed": "Could not reach the Clipulse server. Check the network path and retry.",
        "language": "Language",
        "invalid_token_api_message": "dashboard access token is invalid",
        "invalid_token_api_hint": "Provide the configured Clipulse dashboard access token and try again.",
    }
}
DASHBOARD_LOGIN_COPY_ARTIFACT_ID = "clipulse.dashboard-login-copy"
DASHBOARD_LOGIN_COPY_REQUIRED_KEYS = tuple(DASHBOARD_LOGIN_TRANSLATIONS_FALLBACK["en"].keys())

DASHBOARD_LOCALE_OPTIONS = [
    ("en", "English"),
    ("zh-CN", "简体中文"),
    ("zh-TW", "繁體中文"),
    ("es", "Español"),
    ("pt-BR", "Português (Brasil)"),
    ("ja", "日本語"),
    ("ko", "한국어"),
    ("de", "Deutsch"),
    ("fr", "Français"),
    ("ru", "Русский"),
    ("hi", "हिन्दी"),
    ("id", "Bahasa Indonesia"),
    ("tr", "Türkçe"),
    ("it", "Italiano"),
    ("nl", "Nederlands"),
]


def get_dashboard_locale_cookie_path(base_href: str) -> str:
    return normalize_url_path(base_href)


def build_dashboard_locale_cookie_writes(cookie_path: str) -> list[str]:
    statements = [
        f"{DASHBOARD_LOCALE_COOKIE_NAME}=__LOCALE__; Path={cookie_path}; Max-Age=31536000; SameSite=Lax"
    ]
    if cookie_path != "/":
        statements.append(
            f"{DASHBOARD_LOCALE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax"
        )
    for legacy_cookie_name in LEGACY_DASHBOARD_LOCALE_COOKIE_NAMES:
        statements.append(
            f"{legacy_cookie_name}=; Path=/; Max-Age=0; SameSite=Lax"
        )

    return statements


def build_dashboard_locale_cookie_write_script(locale_value_expression: str, cookie_path: str) -> str:
    # Keep inline <script> string literals safe even if cookie_path ever contains HTML-significant bytes.
    def serialize_js_string_literal(value: str) -> str:
        return (
            json.dumps(value)
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
        )

    script_lines: list[str] = []
    for statement in build_dashboard_locale_cookie_writes(cookie_path):
        if "__LOCALE__" not in statement:
            script_lines.append(f"document.cookie = {serialize_js_string_literal(statement)};")
            continue

        prefix, _, suffix = statement.partition("__LOCALE__")
        script_lines.append(
            f"document.cookie = {serialize_js_string_literal(prefix)} + {locale_value_expression} + {serialize_js_string_literal(suffix)};"
        )

    return "\n        ".join(script_lines)


def build_dashboard_login_translations(parsed: object) -> dict[str, dict[str, str]]:
    translations = {
        "en": dict(DASHBOARD_LOGIN_TRANSLATIONS_FALLBACK["en"]),
    }
    warning_messages: list[str] = []
    if not isinstance(parsed, dict):
        warning_messages.append("dashboard login translation contract must be a JSON object")
    else:
        meta = parsed.get("_meta")
        if (
            isinstance(meta, dict)
            and meta.get("artifact") not in {None, DASHBOARD_LOGIN_COPY_ARTIFACT_ID}
        ):
            warning_messages.append("dashboard login translation contract artifact id did not match")

        locales = parsed.get("locales")
        if not isinstance(locales, dict):
            warning_messages.append(
                "dashboard login translation contract is missing a valid locales map"
            )
        else:
            for locale, copy in locales.items():
                if not isinstance(locale, str) or not isinstance(copy, dict):
                    continue
                normalized_copy = {
                    key: value
                    for key, value in copy.items()
                    if key in DASHBOARD_LOGIN_COPY_REQUIRED_KEYS and isinstance(value, str)
                }
                if locale == "en":
                    translations["en"] = {
                        **translations["en"],
                        **normalized_copy,
                    }
                elif normalized_copy:
                    translations[locale] = normalized_copy

            english_copy = locales.get("en")
            if not isinstance(english_copy, dict):
                warning_messages.append(
                    "dashboard login translation contract is missing required English keys"
                )
            else:
                missing_keys = [
                    key
                    for key in DASHBOARD_LOGIN_COPY_REQUIRED_KEYS
                    if not isinstance(english_copy.get(key), str)
                ]
                if missing_keys:
                    warning_messages.append(
                        "dashboard login translation contract is missing required English keys"
                    )

    for message in dict.fromkeys(warning_messages):
        LOGGER.warning("%s; using built-in English fallback where needed.", message)

    return translations


@lru_cache(maxsize=1)
def load_dashboard_login_translations() -> dict[str, dict[str, str]]:
    package_dir = Path(__file__).resolve().parent
    contracts_dir = resolve_runtime_asset_directory(
        package_dir.parents[2] / "contracts",
        package_dir / "_bundled" / "contracts",
    )
    translation_path = contracts_dir / "dashboard-login-copy.v1.json"

    try:
        parsed = json.loads(translation_path.read_text(encoding="utf-8"))
        return build_dashboard_login_translations(parsed)
    except (OSError, json.JSONDecodeError):
        LOGGER.exception("Falling back to built-in dashboard login translations.")

    return DASHBOARD_LOGIN_TRANSLATIONS_FALLBACK


def get_dashboard_login_copy(locale: str) -> dict[str, str]:
    translations = load_dashboard_login_translations()
    english_copy = {
        **DASHBOARD_LOGIN_TRANSLATIONS_FALLBACK["en"],
        **translations.get("en", {}),
    }
    return {
        **english_copy,
        **translations.get(locale, {}),
    }


def build_dashboard_shell_html(web_dir: Path, base_href: str, *, locale: str = DASHBOARD_DEFAULT_LOCALE) -> str:
    base_tag = f'    <base href="{escape(base_href, quote=True)}" />\n'
    index_path = web_dir / "index.html"
    if not index_path.exists():
        return build_packaged_dashboard_fallback_page(base_href)

    html = index_path.read_text(encoding="utf-8")
    if "<base " in html:
        return html.replace('<html lang="en">', f'<html lang="{escape(locale, quote=True)}">', 1)

    next_html = html.replace("<title>Clipulse</title>", f"{base_tag}    <title>Clipulse</title>", 1)
    return next_html.replace('<html lang="en">', f'<html lang="{escape(locale, quote=True)}">', 1)


def build_dashboard_login_page(base_href: str, *, locale: str = DASHBOARD_DEFAULT_LOCALE) -> str:
    copy = get_dashboard_login_copy(locale)
    safe_message = escape(copy["message"])
    login_path = normalize_url_path(f"{base_href}/dashboard-login")
    locale_cookie_path = get_dashboard_locale_cookie_path(base_href)
    locale_cookie_write_script = build_dashboard_locale_cookie_write_script(
        "localeInput.value",
        locale_cookie_path,
    )
    locale_options = "".join(
        (
            f'<option value="{escape(option_locale, quote=True)}"'
            f'{" selected" if option_locale == locale else ""}>'
            f"{escape(option_label)}</option>"
        )
        for option_locale, option_label in DASHBOARD_LOCALE_OPTIONS
    )
    return f"""<!doctype html>
<html lang="{escape(locale, quote=True)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="{escape(base_href, quote=True)}" />
    <title>{escape(copy["title"])}</title>
  </head>
  <body>
    <main style="max-width: 28rem; margin: 4rem auto; font-family: sans-serif;">
      <h1>{escape(copy["heading"])}</h1>
      <p>{safe_message}</p>
      <label for="dashboard-locale" style="display:block; margin-bottom:0.5rem;">{escape(copy["language"])}</label>
      <select id="dashboard-locale" name="locale" style="display:block; width:100%; margin:0 0 1rem;">
        {locale_options}
      </select>
      <p id="dashboard-token-help">{escape(copy["help"])}</p>
      <form id="dashboard-login-form">
        <label for="dashboard-token">{escape(copy["token_label"])}</label>
        <input id="dashboard-token" name="token" type="password" autocomplete="current-password" autofocus required aria-describedby="dashboard-token-help dashboard-login-error" style="display:block; width:100%; margin:0.5rem 0 1rem;" />
        <button id="dashboard-login-submit" type="submit">{escape(copy["submit"])}</button>
      </form>
      <p id="dashboard-login-error" role="alert" aria-live="assertive" style="color:#b91c1c; min-height:1.5rem;"></p>
    </main>
    <script>
      const form = document.getElementById('dashboard-login-form');
      const localeInput = document.getElementById('dashboard-locale');
      const submitButton = document.getElementById('dashboard-login-submit');
      const tokenInput = document.getElementById('dashboard-token');
      const errorNode = document.getElementById('dashboard-login-error');
      localeInput.addEventListener('change', () => {{
        {locale_cookie_write_script}
        const nextUrl = new URL(window.location.href);
        window.location.replace(nextUrl.toString());
      }});
      form.addEventListener('submit', async (event) => {{
        event.preventDefault();
        errorNode.textContent = '';
        tokenInput.setAttribute('aria-invalid', 'false');
        submitButton.disabled = true;
        try {{
          const response = await fetch({json.dumps(login_path)}, {{
            method: 'POST',
            headers: {{ 'content-type': 'application/json' }},
            body: JSON.stringify({{ token: tokenInput.value }}),
          }});
          if (response.ok) {{
            {locale_cookie_write_script}
            const nextUrl = new URL('./', window.location.href);
            nextUrl.hash = window.location.hash;
            window.location.replace(nextUrl.toString());
            return;
          }}
          if (response.status === 401) {{
            errorNode.textContent = {json.dumps(copy["invalid_token"])};
            tokenInput.setAttribute('aria-invalid', 'true');
            tokenInput.focus();
            tokenInput.select();
            return;
          }}
          errorNode.textContent = {json.dumps(copy["failed"])};
          tokenInput.setAttribute('aria-invalid', 'true');
          tokenInput.focus();
        }} catch (_error) {{
          errorNode.textContent = {json.dumps(copy["network_failed"])};
          tokenInput.setAttribute('aria-invalid', 'true');
          tokenInput.focus();
        }} finally {{
          submitButton.disabled = false;
        }}
      }});
    </script>
  </body>
</html>"""


def build_packaged_dashboard_fallback_page(base_href: str) -> str:
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="{escape(base_href, quote=True)}" />
    <title>Clipulse Backend Package</title>
  </head>
  <body>
    <main style="max-width: 42rem; margin: 4rem auto; font-family: sans-serif; line-height: 1.6;">
      <h1>Clipulse dashboard assets are not bundled in this package build.</h1>
      <p>
        This Python artifact is suitable for backend packaging checks and API-only usage, but the
        full dashboard still expects a source checkout that includes <code>apps/web</code> and
        <code>contracts</code>.
      </p>
      <p>
        Use the source checkout deployment flow for the complete dashboard surface, or keep using
        the packaged backend only for API-focused validation.
      </p>
    </main>
  </body>
</html>"""


def resolve_static_asset_path(web_dir: Path, asset_path: str) -> str | None:
    requested_path = Path(asset_path)
    if requested_path.is_absolute() or ".." in requested_path.parts:
        return None

    resolved_path = (web_dir / requested_path).resolve()
    try:
        resolved_path.relative_to(web_dir.resolve())
    except ValueError:
        return None

    if resolved_path.suffix not in ALLOWED_STATIC_ASSET_EXTENSIONS or not resolved_path.is_file():
        return None

    return str(resolved_path)


def build_openapi_api_error_response(description: str) -> dict[str, object]:
    return {
        "description": description,
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/ApiErrorResponse"},
            }
        },
    }


def should_use_secure_dashboard_cookie(
    request: Request,
    *,
    force_secure_session_cookie: bool = False,
) -> bool:
    return force_secure_session_cookie or request.url.scheme == "https"
