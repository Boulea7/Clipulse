import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

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


class LanguageStatPayload(BaseModel):
    added: int = 0
    removed: int = 0
    changed: int = 0


class FileDeltaPayload(BaseModel):
    fingerprint: str
    language: str
    added: int = 0
    removed: int = 0


class EventPayload(BaseModel):
    event_id: str | None = None
    host: str
    host_version: str
    session_id: str
    project_root: str
    project_name: str
    git_branch: str
    event_name: str
    event_time: str
    model_name: str
    os_name: str
    editor_or_terminal: str
    active_ms: int = 0
    wait_ms: int = 0
    privacy_mode: str
    language_stats: dict[str, LanguageStatPayload] = Field(default_factory=dict)
    file_deltas: list[FileDeltaPayload] = Field(default_factory=list)


class EventBatchPayload(BaseModel):
    events: list[EventPayload]


class TopLanguageResponse(BaseModel):
    name: str
    changed: int


class HostModelMixResponse(BaseModel):
    host: str
    model_name: str
    events: int
    active_ms: int
    wait_ms: int


class FilePreviewResponse(BaseModel):
    fingerprint: str
    language: str
    added: int
    removed: int


class LanguageTotalsResponse(BaseModel):
    name: str
    added: int
    removed: int
    changed: int


class ProjectListItemResponse(BaseModel):
    project_name: str
    project_ref: str
    events: int
    active_ms: int
    wait_ms: int
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix_count: int
    host_model_primary: HostModelMixResponse | None = None


class SessionListItemResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str
    model_name: str
    git_branch: str
    first_event_time: str
    last_event_time: str
    event_count: int
    events: int
    active_ms: int
    wait_ms: int
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix: list[HostModelMixResponse] = Field(default_factory=list)
    host_model_mix_count: int
    host_model_primary: HostModelMixResponse | None = None


class SessionDetailResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str
    model_name: str
    git_branch: str
    first_event_time: str
    last_event_time: str
    event_count: int
    events: int
    active_ms: int
    wait_ms: int
    languages: list[LanguageTotalsResponse] = Field(default_factory=list)
    file_deltas: list[FilePreviewResponse] = Field(default_factory=list)
    file_preview: list[FilePreviewResponse] = Field(default_factory=list)
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    host_model_mix: list[HostModelMixResponse] = Field(default_factory=list)
    top_language: TopLanguageResponse | None = None


class ProjectDetailResponse(BaseModel):
    project_name: str
    project_ref: str
    active_ms: int
    wait_ms: int
    event_count: int
    session_count: int
    languages: list[LanguageTotalsResponse] = Field(default_factory=list)
    file_preview: list[FilePreviewResponse] = Field(default_factory=list)
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix: list[HostModelMixResponse] = Field(default_factory=list)


class ProjectListResponse(BaseModel):
    items: list[ProjectListItemResponse]


class SessionListResponse(BaseModel):
    items: list[SessionListItemResponse]


class ProjectSessionsResponse(BaseModel):
    project_name: str
    project_ref: str
    items: list[SessionListItemResponse]


def create_app(database_url: str = "sqlite+pysqlite:///clipulse.sqlite3") -> FastAPI:
    app = FastAPI(title="Clipulse API", version="0.1.0")
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
            .order_by(func.sum(LanguageStatRecord.changed).desc())
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
            .order_by(func.sum(EventRecord.active_ms).desc())
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
            .order_by(func.sum(EventRecord.active_ms).desc())
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
            .order_by(func.sum(LanguageStatRecord.changed).desc())
            .limit(1)
        ).first()

        label = "top language"
        value = "none"
        if top_language:
            value = str(top_language[0])

        svg = (
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"260\" height=\"20\" role=\"img\" "
            "aria-label=\"Clipulse badge\">"
            "<rect width=\"120\" height=\"20\" fill=\"#1f2937\"/>"
            "<rect x=\"120\" width=\"140\" height=\"20\" fill=\"#0f766e\"/>"
            f"<text x=\"60\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">{label}</text>"
            f"<text x=\"190\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">{value}</text>"
            "</svg>"
        )

        return Response(content=svg, media_type="image/svg+xml")

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

        return ProjectListResponse(items=[ProjectListItemResponse.model_validate(item) for item in items[:limit]])

    @app.get("/api/v1/sessions/recent", response_model=SessionListResponse)
    def get_recent_sessions(
        session: SessionDep,
        limit: int = 10,
    ) -> SessionListResponse:
        records = load_reporting_records(session)
        summaries = sort_session_items(build_session_list_items(records, compute_project_ref))

        return SessionListResponse(
            items=[SessionListItemResponse.model_validate(item) for item in summaries[:limit]]
        )

    @app.get("/api/v1/sessions/{session_id}", response_model=SessionDetailResponse)
    def get_session_detail(
        session_id: str,
        session: SessionDep,
        project_ref: str | None = None,
    ) -> SessionDetailResponse:
        query = reporting_query().where(EventRecord.session_id == session_id)
        if project_ref:
            project = resolve_project_by_ref(session, project_ref)
            if project is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="project not found")
            query = query.where(EventRecord.project_root == project["project_root"])

        records = session.scalars(query).all()

        if not records:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")

        project_roots = {record.project_root for record in records}
        if project_ref is None and len(project_roots) > 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="project_ref is required for ambiguous session_id",
            )

        first = records[0]
        return SessionDetailResponse.model_validate(
            build_session_detail(records, first.project_root, compute_project_ref)
        )

    @app.get("/api/v1/projects/{project_ref}", response_model=ProjectDetailResponse)
    def get_project_detail(
        project_ref: str,
        session: SessionDep,
    ) -> ProjectDetailResponse:
        project = resolve_project_by_ref(session, project_ref)
        if project is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="project not found")

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
        project = resolve_project_by_ref(session, project_ref)
        if project is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="project not found")

        records = load_reporting_records(session, project_root=project["project_root"])
        session_summaries = sort_session_items(build_session_list_items(records, compute_project_ref))

        return ProjectSessionsResponse(
            project_ref=project_ref,
            project_name=project["project_name"],
            items=[SessionListItemResponse.model_validate(item) for item in session_summaries[:limit]],
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


def reporting_query():
    return (
        select(EventRecord)
        .options(
            selectinload(EventRecord.language_stats),
            selectinload(EventRecord.file_deltas),
        )
        .order_by(func.datetime(EventRecord.event_time).asc(), EventRecord.id.asc())
    )


def load_reporting_records(
    session: Session,
    project_root: str | None = None,
) -> list[EventRecord]:
    query = reporting_query()
    if project_root is not None:
        query = query.where(EventRecord.project_root == project_root)

    return session.scalars(query).all()


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
    svg = (
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"260\" height=\"20\" role=\"img\" "
        "aria-label=\"Clipulse badge\">"
        "<rect width=\"120\" height=\"20\" fill=\"#1f2937\"/>"
        "<rect x=\"120\" width=\"140\" height=\"20\" fill=\"#0f766e\"/>"
        f"<text x=\"60\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">{label}</text>"
        f"<text x=\"190\" y=\"14\" fill=\"#ffffff\" font-size=\"11\" text-anchor=\"middle\">{value}</text>"
        "</svg>"
    )
    return Response(content=svg, media_type="image/svg+xml")


def compute_event_id(payload: dict[str, object]) -> str:
    event_payload = {key: value for key, value in payload.items() if key != "event_id"}
    serialized = json.dumps(event_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def compute_project_ref(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:12]


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


def resolve_project_by_ref(session: Session, project_ref: str) -> dict[str, str] | None:
    rows = session.execute(
        select(EventRecord.project_root, EventRecord.project_name)
        .group_by(EventRecord.project_root, EventRecord.project_name)
        .order_by(EventRecord.project_name.asc())
    ).all()

    for row in rows:
        project_root = str(row[0])
        if compute_project_ref(project_root) == project_ref:
            return {
                "project_ref": project_ref,
                "project_root": project_root,
                "project_name": str(row[1]),
            }

    return None
