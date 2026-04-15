import hashlib
import re
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
    if re.fullmatch(r"[0-9a-f]{12}", project_root):
        return project_root
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
    return load_project_lookup_by_ref(session, {project_ref}).get(project_ref)


def load_project_lookup_by_ref(
    session: Session,
    project_refs: set[str] | None = None,
) -> dict[str, ProjectLookup]:
    rows = session.execute(
        select(EventRecord.project_root)
        .distinct()
        .order_by(EventRecord.project_root.asc())
    ).all()

    matching_project_roots: dict[str, str] = {}
    for row in rows:
        project_root = str(row[0])
        resolved_project_ref = compute_project_ref(project_root)
        if project_refs is not None and resolved_project_ref not in project_refs:
            continue
        matching_project_roots[resolved_project_ref] = project_root

    if not matching_project_roots:
        return {}

    project_names = load_canonical_project_names(session, list(matching_project_roots.values()))
    project_lookup: dict[str, ProjectLookup] = {}
    for resolved_project_ref, project_root in matching_project_roots.items():
        project_name = project_names.get(project_root)
        if project_name is None:
            continue
        project_lookup[resolved_project_ref] = {
            "project_ref": resolved_project_ref,
            "project_root": project_root,
            "project_name": project_name,
        }

    return project_lookup


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
        select(
            EventRecord.project_root,
            EventRecord.project_name,
            EventRecord.event_time,
            EventRecord.id,
        )
        .where(EventRecord.project_root.in_(project_roots))
        .order_by(EventRecord.project_root.asc(), EventRecord.id.asc())
    )
    project_names: dict[str, str] = {}
    canonical_candidates: dict[str, tuple[object, int, str]] = {}
    for project_root, project_name, event_time, record_id in session.execute(statement):
        project_root_str = str(project_root)
        candidate = (
            parse_utc_datetime(str(event_time)),
            int(record_id or 0),
            str(project_name),
        )
        current = canonical_candidates.get(project_root_str)
        if current is None or candidate[:2] < current[:2]:
            canonical_candidates[project_root_str] = candidate
            project_names[project_root_str] = str(project_name)

    return project_names
