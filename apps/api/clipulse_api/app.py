import hashlib
import json
from datetime import UTC, datetime, timedelta
from html import escape
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Request, Response, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import (
    EventRecord,
    FileDeltaRecord,
    LanguageStatRecord,
    create_session_factory,
    get_session,
)
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
from .runtime_status import collect_spool_status, resolve_state_dir
from .schemas import (
    DashboardStatusResponse,
    EventBatchPayload,
    ProjectDetailResponse,
    ProjectListItemResponse,
    ProjectListResponse,
    ProjectSessionsResponse,
    SessionDetailResponse,
    SessionListItemResponse,
    SessionListResponse,
)


APP_VERSION = "0.1.0"


def create_app(database_url: str = "sqlite+pysqlite:///clipulse.sqlite3") -> FastAPI:
    app = FastAPI(title="Clipulse API", version=APP_VERSION)
    session_factory = create_session_factory(database_url)
    web_dir = Path(__file__).resolve().parents[2] / "web"

    if web_dir.exists():
        app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")

    def session_dependency():
        yield from get_session(session_factory)

    SessionDep = Annotated[Session, Depends(session_dependency)]

    @app.post("/api/v1/events/batch", status_code=status.HTTP_202_ACCEPTED)
    def ingest_events(payload: EventBatchPayload, session: SessionDep) -> dict[str, object]:
        accepted = 0
        duplicates = 0
        invalid = 0
        seen_event_ids: set[str] = set()
        results: list[dict[str, object]] = []

        for event in payload.events:
            normalized_event = event.model_dump()
            event_id = event.event_id or compute_event_id(normalized_event)
            try:
                normalized_event["event_time"] = normalize_event_time(event.event_time)
            except ValueError:
                invalid += 1
                results.append(
                    {
                        "event_id": event_id,
                        "status": "invalid",
                        "retryable": False,
                    }
                )
                continue
            if event_id in seen_event_ids:
                duplicates += 1
                results.append(
                    {
                        "event_id": event_id,
                        "status": "duplicate",
                        "retryable": False,
                    }
                )
                continue

            existing = session.scalar(
                select(EventRecord.id).where(EventRecord.event_id == event_id)
            )
            if existing is not None:
                duplicates += 1
                results.append(
                    {
                        "event_id": event_id,
                        "status": "duplicate",
                        "retryable": False,
                    }
                )
                continue

            record = EventRecord(
                event_id=event_id,
                host=event.host,
                host_version=event.host_version,
                session_id=event.session_id,
                project_root=event.project_root,
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

            session.add(record)
            seen_event_ids.add(event_id)
            accepted += 1
            results.append(
                {
                    "event_id": event_id,
                    "status": "accepted",
                    "retryable": False,
                }
            )

        session.commit()
        return {
            "accepted": accepted,
            "duplicates": duplicates,
            "invalid": invalid,
            "results": results,
        }

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

    @app.get("/api/v1/badges/top-language.svg")
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

    @app.get("/api/v1/badges/today-time.svg")
    def get_today_time_badge(session: SessionDep) -> Response:
        now = datetime.now(UTC)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        totals = get_window_totals(session, to_utc_iso(start))
        return build_badge_response("today time", format_duration_ms(totals["active_ms"]))

    @app.get("/api/v1/badges/this-week-time.svg")
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
        limit: int = 5,
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

    @app.get("/api/v1/sessions/recent", response_model=SessionListResponse)
    def get_recent_sessions(
        session: SessionDep,
        limit: int = 10,
    ) -> SessionListResponse:
        records = load_reporting_records(session)
        summaries = sort_session_items(build_session_list_items(records, compute_project_ref))
        normalized_limit = clamp_list_limit(limit)

        return SessionListResponse(
            items=[
                SessionListItemResponse.model_validate(item)
                for item in summaries[:normalized_limit]
            ]
        )

    @app.get("/api/v1/sessions/{session_id}", response_model=SessionDetailResponse)
    def get_session_detail(
        session_id: str,
        session: SessionDep,
        project_ref: str | None = None,
    ) -> SessionDetailResponse:
        records, project_root = load_session_detail_records(
            session,
            session_id=session_id,
            project_ref=project_ref,
        )
        canonical_project_name = build_project_detail(
            load_reporting_records(session, project_root=project_root),
            project_root,
            compute_project_ref,
        )["project_name"]
        return SessionDetailResponse.model_validate(
            build_session_detail(
                records,
                project_root,
                compute_project_ref,
                project_name=str(canonical_project_name),
            )
        )

    @app.get("/api/v1/projects/{project_ref}", response_model=ProjectDetailResponse)
    def get_project_detail(
        project_ref: str,
        session: SessionDep,
    ) -> ProjectDetailResponse:
        project = require_project_by_ref(session, project_ref)
        records = load_reporting_records(session, project_root=project["project_root"])
        return ProjectDetailResponse.model_validate(
            build_project_detail(records, project["project_root"], compute_project_ref)
        )

    @app.get("/api/v1/projects/{project_ref}/sessions", response_model=ProjectSessionsResponse)
    def get_project_sessions(
        project_ref: str,
        session: SessionDep,
        limit: int = 20,
    ) -> ProjectSessionsResponse:
        project = require_project_by_ref(session, project_ref)
        records = load_reporting_records(session, project_root=project["project_root"])
        project_detail = build_project_detail(records, project["project_root"], compute_project_ref)
        session_summaries = sort_session_items(build_session_list_items(records, compute_project_ref))
        normalized_limit = clamp_list_limit(limit)

        # Keep this endpoint compact for migration: session detail lives on the dedicated route.
        return ProjectSessionsResponse(
            project_ref=project_ref,
            project_name=str(project_detail["project_name"]),
            items=[
                SessionListItemResponse.model_validate(item)
                for item in session_summaries[:normalized_limit]
            ],
        )

    @app.get("/api/v1/status", response_model=DashboardStatusResponse)
    def get_dashboard_status(session: SessionDep) -> DashboardStatusResponse:
        return DashboardStatusResponse.model_validate(
            {
                "api": {"status": "ok", "version": APP_VERSION},
                "db": {"status": "ok", **load_database_status(session)},
                "spool": collect_spool_status(resolve_state_dir()),
            }
        )

    @app.get("/api/v1/public/readme/top-language")
    def get_public_top_language_markdown(request: Request) -> dict[str, str]:
        badge_url = str(request.base_url).rstrip("/") + "/api/v1/badges/top-language.svg"
        markdown = f"![Clipulse Top Language]({badge_url})"
        return {"markdown": markdown}

    @app.get("/api/v1/public/readme/today-time")
    def get_public_today_time_markdown(request: Request) -> dict[str, str]:
        return {"markdown": build_badge_markdown(request, "today-time.svg", "Clipulse Today Time")}

    @app.get("/api/v1/public/readme/this-week-time")
    def get_public_this_week_time_markdown(request: Request) -> dict[str, str]:
        return {
            "markdown": build_badge_markdown(
                request,
                "this-week-time.svg",
                "Clipulse This Week Time",
            )
        }

    @app.get("/")
    def dashboard_shell() -> FileResponse:
        return FileResponse(web_dir / "index.html")

    @app.get("/healthz")
    def healthcheck() -> Response:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return app


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
    return max(limit, 0)


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


def build_badge_markdown(request: Request, badge_name: str, alt_text: str) -> str:
    badge_url = str(request.base_url).rstrip("/") + f"/api/v1/badges/{badge_name}"
    return f"![{alt_text}]({badge_url})"


def to_utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
