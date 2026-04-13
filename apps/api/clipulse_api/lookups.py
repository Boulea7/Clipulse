import hashlib
from typing import TypedDict

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .database import EventRecord
from .errors import ambiguous_session_error, project_not_found_error, session_not_found_error
from .reporting import parse_utc_datetime


class ProjectLookup(TypedDict):
    project_ref: str
    project_root: str
    project_name: str


class SessionDetailLookup(TypedDict):
    project_name: str
    project_root: str
    records: list[EventRecord]


def _sort_event_records(records: list[EventRecord]) -> list[EventRecord]:
    return sorted(
        records,
        key=lambda record: (
            parse_utc_datetime(str(record.event_time)),
            int(record.id or 0),
        ),
    )


def compute_project_ref(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:12]


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


def resolve_project_by_ref(session: Session, project_ref: str) -> ProjectLookup | None:
    rows = session.execute(
        select(EventRecord.project_root)
        .distinct()
        .order_by(EventRecord.project_root.asc())
    ).all()

    for row in rows:
        project_root = str(row[0])
        if compute_project_ref(project_root) == project_ref:
            project_name = load_canonical_project_name(session, project_root)
            if project_name is None:
                return None
            return {
                "project_ref": project_ref,
                "project_root": project_root,
                "project_name": project_name,
            }

    return None


def require_project_by_ref(session: Session, project_ref: str) -> ProjectLookup:
    project = resolve_project_by_ref(session, project_ref)
    if project is None:
        raise project_not_found_error()
    return project


def load_session_detail_records(
    session: Session,
    session_id: str,
    project_ref: str | None = None,
) -> SessionDetailLookup:
    project_root: str | None = None
    project_name: str | None = None

    if project_ref is not None:
        project = require_project_by_ref(session, project_ref)
        project_root = project["project_root"]
        project_name = project["project_name"]
    else:
        matches = session.execute(
            select(
                EventRecord.project_root,
                EventRecord.project_name,
                func.max(EventRecord.event_time),
            )
            .where(EventRecord.session_id == session_id)
            .group_by(EventRecord.project_root, EventRecord.project_name)
            .order_by(
                func.max(func.datetime(EventRecord.event_time)).asc(),
                EventRecord.project_root.asc(),
            )
        ).all()

        if not matches:
            raise session_not_found_error()

        if len(matches) > 1:
            raise ambiguous_session_error(
                {
                    "session_id": session_id,
                    "project_count": len(matches),
                    "matches": [
                        {
                            "project_ref": compute_project_ref(str(row[0])),
                            "project_name": str(row[1]),
                            "last_event_time": str(row[2]),
                        }
                        for row in matches
                    ],
                }
            )

        project_root = str(matches[0][0])
        project_name = load_canonical_project_name(session, project_root) or str(matches[0][1])

    query = reporting_query().where(
        EventRecord.session_id == session_id,
        EventRecord.project_root == project_root,
    )
    records = session.scalars(query).all()
    if not records:
        raise session_not_found_error()

    ordered_records = _sort_event_records(records)
    return {
        "records": ordered_records,
        "project_root": project_root,
        "project_name": project_name or ordered_records[0].project_name,
    }


def load_database_status(session: Session) -> dict[str, int]:
    events = int(session.scalar(select(func.count(EventRecord.id))) or 0)
    projects = int(
        session.scalar(
            select(func.count()).select_from(
                select(EventRecord.project_root).distinct().subquery()
            )
        )
        or 0
    )
    sessions = int(
        session.scalar(
            select(func.count()).select_from(
                select(EventRecord.project_root, EventRecord.session_id).distinct().subquery()
            )
        )
        or 0
    )

    return {
        "events": events,
        "projects": projects,
        "sessions": sessions,
    }


def load_canonical_project_name(session: Session, project_root: str) -> str | None:
    statement = (
        select(EventRecord.project_name)
        .where(EventRecord.project_root == project_root)
        .order_by(func.datetime(EventRecord.event_time).asc(), EventRecord.id.asc())
        .limit(1)
    )
    project_name = session.scalar(statement)
    return str(project_name) if project_name is not None else None
