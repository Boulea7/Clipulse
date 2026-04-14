import hashlib
import hmac
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from html import escape
from pathlib import Path
from time import perf_counter
from typing import Annotated, Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import Depends, FastAPI, Query, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse
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
DEFAULT_TESTSERVER_HOST = "testserver"
DASHBOARD_TOKEN_COOKIE_NAME = "clipulse_api_token"
DASHBOARD_SESSION_TTL_SECONDS = 12 * 60 * 60
DASHBOARD_LOGIN_ERROR_MESSAGE = "Clipulse dashboard access token is required."
DASHBOARD_COMPAT_CONTRACT_POINTER = "/contracts/dashboard-compat.v1.json"
DASHBOARD_COMPAT_TIER = "minimum"
DASHBOARD_COMPAT_SURFACES = ["dashboard-summary", "dashboard-detail"]
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
            artifact_status = "ok"
            artifact_error_code = None
            artifact_error_message = None
            meta = contract_body.get("_meta")
            if isinstance(meta, dict):
                if isinstance(meta.get("version"), str):
                    artifact_version = meta["version"]

                sections = meta.get("sections")
                if isinstance(sections, list):
                    artifact_sections = [
                        section for section in sections if isinstance(section, str) and section
                    ]

                section_count = meta.get("section_count")
                if isinstance(section_count, int) and section_count >= 0:
                    artifact_section_count = section_count
                else:
                    artifact_section_count = len(artifact_sections)
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
    public_base_url: str | None = None,
    enable_public_reads: bool | None = None,
) -> FastAPI:
    resolved_database_url = database_url or os.environ.get(
        "CLIPULSE_DATABASE_URL",
        "sqlite+pysqlite:///clipulse.sqlite3",
    )
    env_server_token_configured = "CLIPULSE_SERVER_TOKEN" in os.environ
    token_enforcement_enabled = server_token is not None or env_server_token_configured
    resolved_server_token = (
        server_token
        if server_token is not None
        else os.environ.get("CLIPULSE_SERVER_TOKEN")
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
    app = FastAPI(title="Clipulse API", version=APP_VERSION)
    session_factory = create_session_factory(resolved_database_url)
    web_dir = Path(__file__).resolve().parents[2] / "web"
    contracts_dir = Path(__file__).resolve().parents[3] / "contracts"
    status_response_example = {
        **STATUS_RESPONSE_EXAMPLE,
        "compat": build_dashboard_compat_metadata(
            contracts_dir / DASHBOARD_COMPAT_CONTRACT_POINTER.removeprefix("/contracts/")
        ),
    }

    if web_dir.exists():
        app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")
    if contracts_dir.exists():
        app.mount("/contracts", StaticFiles(directory=str(contracts_dir)), name="contracts")

    @app.middleware("http")
    async def require_server_token(request: Request, call_next):
        path = request.url.path
        authorization = request.headers.get("Authorization", "")
        cookie_token = request.cookies.get(DASHBOARD_TOKEN_COOKIE_NAME, "")
        request.state.authenticated = False
        request.state.dashboard_authenticated = False

        has_configured_token = bool(resolved_server_token)
        is_bearer_authenticated = has_configured_token and (
            authorization == f"Bearer {resolved_server_token}"
        )
        is_dashboard_authenticated = has_configured_token and is_valid_dashboard_session_cookie(
            cookie_token,
            resolved_server_token or "",
        )
        request.state.authenticated = is_bearer_authenticated or is_dashboard_authenticated
        request.state.dashboard_authenticated = is_dashboard_authenticated

        is_protected_static_route = path.startswith("/static/") or path.startswith("/contracts/")
        if not path.startswith("/api/v1/") and not is_protected_static_route:
            if not token_enforcement_enabled:
                request.state.authenticated = True
                request.state.dashboard_authenticated = True
            return await call_next(request)

        if not token_enforcement_enabled:
            request.state.authenticated = True
            request.state.dashboard_authenticated = True
            return await call_next(request)

        is_public_read = (
            path.startswith("/api/v1/public/readme/")
            or path.startswith("/api/v1/badges/")
        )
        if is_public_read and resolved_enable_public_reads and not request.state.authenticated:
            return await call_next(request)

        if not resolved_server_token:
            return build_api_error_response(
                api_error(
                    status_code=503,
                    code="server_token_not_configured",
                    message="server token is not configured",
                    hint="Set CLIPULSE_SERVER_TOKEN before exposing Clipulse API routes.",
                )
            )

        if not request.state.authenticated:
            return build_api_error_response(
                api_error(
                    status_code=401,
                    code="authentication_required",
                    message="bearer token is required",
                    hint="Send Authorization: Bearer <token> for protected Clipulse API routes.",
                ),
                headers={"WWW-Authenticate": "Bearer"},
            )

        return await call_next(request)

    def session_dependency():
        yield from get_session(session_factory)

    SessionDep = Annotated[Session, Depends(session_dependency)]

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
                allow_request_base_url_fallback=not bool(resolved_server_token),
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
                allow_request_base_url_fallback=not bool(resolved_server_token),
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
                allow_request_base_url_fallback=not bool(resolved_server_token),
            )
        )

    @app.post("/dashboard-login", status_code=status.HTTP_204_NO_CONTENT)
    async def dashboard_login(request: Request) -> Response:
        if not token_enforcement_enabled or not resolved_server_token:
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        token = await read_dashboard_login_token(request)
        if token != resolved_server_token:
            return build_api_error_response(
                api_error(
                    status_code=401,
                    code="authentication_required",
                    message="bearer token is required",
                    hint="Provide the configured Clipulse server token to access the protected dashboard.",
                ),
                headers={"WWW-Authenticate": "Bearer"},
            )

        response = Response(status_code=status.HTTP_204_NO_CONTENT)
        response.set_cookie(
            DASHBOARD_TOKEN_COOKIE_NAME,
            create_dashboard_session_cookie_value(resolved_server_token),
            httponly=True,
            max_age=DASHBOARD_SESSION_TTL_SECONDS,
            samesite="lax",
            secure=request.url.scheme == "https",
        )
        return response

    @app.post("/dashboard-logout", status_code=status.HTTP_204_NO_CONTENT)
    async def dashboard_logout() -> Response:
        response = Response(status_code=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(DASHBOARD_TOKEN_COOKIE_NAME)
        return response

    @app.get("/")
    def dashboard_shell(request: Request) -> Response:
        if (
            token_enforcement_enabled
            and resolved_server_token
            and not getattr(request.state, "dashboard_authenticated", False)
        ):
            return HTMLResponse(build_dashboard_login_page(build_dashboard_base_href(request.scope.get("root_path", ""))))

        return HTMLResponse(build_dashboard_shell_html(web_dir, build_dashboard_base_href(request.scope.get("root_path", ""))))

    @app.get(
        "/healthz",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    def healthcheck() -> Response:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

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
    elif getattr(request.state, "authenticated", False) or (
        request.url.hostname or ""
    ) == DEFAULT_TESTSERVER_HOST:
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


def build_dashboard_base_href(root_path: str) -> str:
    normalized_root_path = normalize_url_path(root_path)
    if normalized_root_path == "/":
        return "/"

    return f"{normalized_root_path}/"


def build_dashboard_shell_html(web_dir: Path, base_href: str) -> str:
    base_tag = f'    <base href="{escape(base_href, quote=True)}" />\n'
    html = (web_dir / "index.html").read_text(encoding="utf-8")
    if "<base " in html:
        return html

    return html.replace("<title>Clipulse</title>", f"{base_tag}    <title>Clipulse</title>", 1)


def build_dashboard_login_page(base_href: str) -> str:
    safe_message = escape(DASHBOARD_LOGIN_ERROR_MESSAGE)
    login_path = normalize_url_path(f"{base_href}/dashboard-login")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="{escape(base_href, quote=True)}" />
    <title>Clipulse Dashboard Login</title>
  </head>
  <body>
    <main style="max-width: 28rem; margin: 4rem auto; font-family: sans-serif;">
      <h1>Protected Clipulse dashboard</h1>
      <p>{safe_message}</p>
      <form id="dashboard-login-form">
        <label for="dashboard-token">Server token</label>
        <input id="dashboard-token" name="token" type="password" autocomplete="current-password" style="display:block; width:100%; margin:0.5rem 0 1rem;" />
        <button type="submit">Open dashboard</button>
      </form>
      <p id="dashboard-login-error" style="color:#b91c1c; min-height:1.5rem;"></p>
    </main>
    <script>
      const form = document.getElementById('dashboard-login-form');
      const tokenInput = document.getElementById('dashboard-token');
      const errorNode = document.getElementById('dashboard-login-error');
      form.addEventListener('submit', async (event) => {{
        event.preventDefault();
        errorNode.textContent = '';
        const response = await fetch({json.dumps(login_path)}, {{
          method: 'POST',
          headers: {{ 'content-type': 'application/json' }},
          body: JSON.stringify({{ token: tokenInput.value }}),
        }});
        if (response.ok) {{
          window.location.replace('./');
          return;
        }}
        errorNode.textContent = 'Invalid token. Check CLIPULSE_SERVER_TOKEN and try again.';
      }});
    </script>
  </body>
</html>"""
