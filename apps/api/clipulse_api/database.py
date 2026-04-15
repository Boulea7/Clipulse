import hashlib
import re
from collections.abc import Generator

from sqlalchemy import ForeignKey, create_engine, text
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
    validates,
)
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


PROJECT_SCOPE_KEY_LENGTH = 12
PROJECT_SCOPE_KEY_PATTERN = re.compile(r"^[0-9a-f]{12}$")


def compute_project_scope_key(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:PROJECT_SCOPE_KEY_LENGTH]


def is_project_scope_key(value: str) -> bool:
    return bool(PROJECT_SCOPE_KEY_PATTERN.fullmatch(value))


def normalize_project_scope_key(value: str) -> str:
    stripped_value = value.strip()
    if is_project_scope_key(stripped_value):
        return stripped_value
    return compute_project_scope_key(stripped_value)


class EventRecord(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(unique=True, index=True)
    host: Mapped[str]
    host_version: Mapped[str]
    session_id: Mapped[str]
    project_root: Mapped[str]
    project_name: Mapped[str]
    git_branch: Mapped[str]
    event_name: Mapped[str]
    event_time: Mapped[str]
    model_name: Mapped[str]
    os_name: Mapped[str]
    editor_or_terminal: Mapped[str]
    active_ms: Mapped[int]
    wait_ms: Mapped[int]
    privacy_mode: Mapped[str]
    language_stats: Mapped[list["LanguageStatRecord"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )
    file_deltas: Mapped[list["FileDeltaRecord"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )

    @validates("project_root")
    def normalize_project_root(self, _key: str, project_root: str) -> str:
        return normalize_project_scope_key(project_root)


class LanguageStatRecord(Base):
    __tablename__ = "language_stats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    name: Mapped[str]
    added: Mapped[int]
    removed: Mapped[int]
    changed: Mapped[int]
    event: Mapped[EventRecord] = relationship(back_populates="language_stats")


class FileDeltaRecord(Base):
    __tablename__ = "file_deltas"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    fingerprint: Mapped[str]
    language: Mapped[str]
    added: Mapped[int]
    removed: Mapped[int]
    event: Mapped[EventRecord] = relationship(back_populates="file_deltas")


def create_session_factory(database_url: str) -> sessionmaker[Session]:
    engine_kwargs = {}
    if database_url.endswith(":memory:"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        engine_kwargs["poolclass"] = StaticPool

    engine = create_engine(database_url, **engine_kwargs)
    Base.metadata.create_all(engine)
    _ensure_runtime_indexes(engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_session(session_factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


def _ensure_runtime_indexes(engine) -> None:
    with engine.begin() as connection:
        rows = connection.execute(text("SELECT id, project_root FROM events")).all()
        for event_id, project_root in rows:
            normalized_project_root = normalize_project_scope_key(str(project_root))
            if normalized_project_root == str(project_root):
                continue
            connection.execute(
                text("UPDATE events SET project_root = :project_root WHERE id = :event_id"),
                {
                    "project_root": normalized_project_root,
                    "event_id": int(event_id),
                },
            )

        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_events_project_root_session_id "
                "ON events (project_root, session_id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_events_event_time "
                "ON events (event_time)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_events_session_id_project_root_event_time_id "
                "ON events (session_id, project_root, event_time, id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_events_project_root_event_time_id "
                "ON events (project_root, event_time, id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_language_stats_event_id "
                "ON language_stats (event_id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_file_deltas_event_id "
                "ON file_deltas (event_id)"
            )
        )
