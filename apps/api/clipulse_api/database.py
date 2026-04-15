import hashlib
import re
from collections.abc import Generator

from sqlalchemy import ForeignKey, create_engine, inspect, text
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
SCHEMA_VERSION_TABLE_NAME = "schema_version"
CURRENT_SCHEMA_VERSION = 1


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


class MigrationRequiredError(RuntimeError):
    pass


def create_session_factory(database_url: str) -> sessionmaker[Session]:
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    ensure_database_schema_is_current(engine)
    _ensure_runtime_indexes(engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)


def create_database_engine(database_url: str):
    engine_kwargs = {}
    if database_url.endswith(":memory:"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        engine_kwargs["poolclass"] = StaticPool

    return create_engine(database_url, **engine_kwargs)


def get_session(session_factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


def ensure_database_schema_is_current(engine) -> None:
    version = read_schema_version(engine)
    if version is None:
        if has_legacy_event_rows(engine):
            raise MigrationRequiredError(
                "database migration required; run `python -m clipulse_api.migrate upgrade` before starting the API"
            )
        initialize_schema_version(engine, CURRENT_SCHEMA_VERSION)
        return

    if version < CURRENT_SCHEMA_VERSION:
        raise MigrationRequiredError(
            "database schema is outdated; run `python -m clipulse_api.migrate upgrade` before starting the API"
        )


def initialize_schema_version(engine, version: int) -> None:
    with engine.begin() as connection:
        ensure_schema_version_table(connection)
        connection.execute(text(f"DELETE FROM {SCHEMA_VERSION_TABLE_NAME}"))
        connection.execute(
            text(f"INSERT INTO {SCHEMA_VERSION_TABLE_NAME} (version) VALUES (:version)"),
            {"version": version},
        )


def read_schema_version(engine) -> int | None:
    inspector = inspect(engine)
    if not inspector.has_table(SCHEMA_VERSION_TABLE_NAME):
        return None

    with engine.connect() as connection:
        version = connection.execute(
            text(f"SELECT version FROM {SCHEMA_VERSION_TABLE_NAME} LIMIT 1")
        ).scalar()
    return int(version) if version is not None else None


def ensure_schema_version_table(connection) -> None:
    connection.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {SCHEMA_VERSION_TABLE_NAME} (
                version INTEGER NOT NULL
            )
            """
        )
    )


def has_legacy_event_rows(engine) -> bool:
    inspector = inspect(engine)
    if not inspector.has_table("events"):
        return False

    with engine.connect() as connection:
        event_count = connection.execute(text("SELECT COUNT(*) FROM events")).scalar()
    return int(event_count or 0) > 0


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
