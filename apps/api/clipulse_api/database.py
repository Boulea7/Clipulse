from collections.abc import Generator

from sqlalchemy import ForeignKey, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


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
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_session(session_factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
