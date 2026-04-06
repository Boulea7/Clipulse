import hashlib
from typing import TypedDict

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .database import EventRecord
from .errors import ambiguous_session_error, project_not_found_error, session_not_found_error


class ProjectLookup(TypedDict):
    project_ref: str
    project_root: str
    project_name: str


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


def require_project_by_ref(session: Session, project_ref: str) -> ProjectLookup:
    project = resolve_project_by_ref(session, project_ref)
    if project is None:
        raise project_not_found_error()
    return project


def load_session_detail_records(
    session: Session,
    session_id: str,
    project_ref: str | None = None,
) -> tuple[list[EventRecord], str]:
    query = reporting_query().where(EventRecord.session_id == session_id)
    if project_ref is not None:
        project = require_project_by_ref(session, project_ref)
        query = query.where(EventRecord.project_root == project["project_root"])

    records = session.scalars(query).all()
    if not records:
        raise session_not_found_error()

    project_roots = {record.project_root for record in records}
    if project_ref is None and len(project_roots) > 1:
        raise ambiguous_session_error()

    return records, records[0].project_root


def load_database_status(session: Session) -> dict[str, int]:
    events = int(session.scalar(select(func.count(EventRecord.id))) or 0)
    projects = len(
        session.execute(select(EventRecord.project_root).distinct().order_by(EventRecord.project_root)).all()
    )
    sessions = len(
        session.execute(
            select(EventRecord.project_root, EventRecord.session_id)
            .distinct()
            .order_by(EventRecord.project_root, EventRecord.session_id)
        ).all()
    )

    return {
        "events": events,
        "projects": projects,
        "sessions": sessions,
    }
