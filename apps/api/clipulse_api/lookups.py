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
        .order_by(EventRecord.event_time.asc(), EventRecord.id.asc())
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

    matching_project_root: str | None = None
    for row in rows:
        project_root = str(row[0])
        if compute_project_ref(project_root) == project_ref:
            matching_project_root = project_root
            break

    if matching_project_root is None:
        return None

    project_name = load_canonical_project_names(session, [matching_project_root]).get(
        matching_project_root
    )
    if project_name is None:
        return None

    return {
        "project_ref": project_ref,
        "project_root": matching_project_root,
        "project_name": project_name,
    }


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
                func.max(EventRecord.event_time),
            )
            .where(EventRecord.session_id == session_id)
            .group_by(EventRecord.project_root)
            .order_by(
                func.max(EventRecord.event_time).asc(),
                EventRecord.project_root.asc(),
            )
        ).all()

        if not matches:
            raise session_not_found_error()

        if len(matches) > 1:
            project_names = load_canonical_project_names(
                session,
                [str(row[0]) for row in matches],
            )
            raise ambiguous_session_error(
                {
                    "session_id": session_id,
                    "project_count": len(matches),
                    "matches": [
                        {
                            "project_ref": compute_project_ref(str(row[0])),
                            "project_name": project_names.get(str(row[0])),
                            "last_event_time": str(row[1]),
                        }
                        for row in matches
                    ],
                }
            )

        project_root = str(matches[0][0])
        project_name = load_canonical_project_name(session, project_root)

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
    return load_canonical_project_names(session, [project_root]).get(project_root)


def load_canonical_project_names(
    session: Session,
    project_roots: list[str],
) -> dict[str, str]:
    if not project_roots:
        return {}

    statement = (
        select(EventRecord.project_root, EventRecord.project_name)
        .where(EventRecord.project_root.in_(project_roots))
        .order_by(
            EventRecord.project_root.asc(),
            EventRecord.event_time.asc(),
            EventRecord.id.asc(),
        )
    )
    project_names: dict[str, str] = {}
    for project_root, project_name in session.execute(statement):
        project_root_str = str(project_root)
        if project_root_str not in project_names:
            project_names[project_root_str] = str(project_name)

    return project_names
