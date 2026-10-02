import sys

from sqlalchemy import text

from .database import (
    Base,
    CURRENT_SCHEMA_VERSION,
    _ensure_runtime_indexes,
    create_database_engine,
    ensure_schema_version_table,
    initialize_schema_version,
    normalize_project_scope_key,
    read_schema_version,
)


def upgrade_database(database_url: str) -> int:
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)

    with engine.begin() as connection:
        ensure_schema_version_table(connection)

    version = read_schema_version(engine)
    if version is None:
        version = 0

    if version < 1:
        upgrade_to_v1(engine)
        version = 1

    if version < 2:
        upgrade_to_v2(engine)
        version = 2

    if version < 3:
        upgrade_to_v3(engine)
        version = 3

    if version < 4:
        upgrade_to_v4(engine)
        version = 4

    if version < CURRENT_SCHEMA_VERSION:
        initialize_schema_version(engine, CURRENT_SCHEMA_VERSION)
        version = CURRENT_SCHEMA_VERSION

    _ensure_runtime_indexes(engine)

    return version


def get_schema_version(database_url: str) -> int | None:
    engine = create_database_engine(database_url)
    return read_schema_version(engine)


def upgrade_to_v1(engine) -> None:
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

    initialize_schema_version(engine, 1)


def upgrade_to_v2(engine) -> None:
    Base.metadata.create_all(engine)
    initialize_schema_version(engine, 2)


def upgrade_to_v3(engine) -> None:
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info('events')")).all()
        }
        optional_columns = {
            "provider": "VARCHAR",
            "source": "VARCHAR",
            "input_tokens": "INTEGER",
            "output_tokens": "INTEGER",
            "cache_creation_tokens": "INTEGER",
            "cache_read_tokens": "INTEGER",
            "reasoning_tokens": "INTEGER",
            "total_tokens": "INTEGER",
            "cost_usd": "FLOAT",
        }
        for column_name, column_type in optional_columns.items():
            if column_name in columns:
                continue
            connection.execute(
                text(f"ALTER TABLE events ADD COLUMN {column_name} {column_type}")
            )

    initialize_schema_version(engine, 3)


def upgrade_to_v4(engine) -> None:
    Base.metadata.create_all(engine)
    initialize_schema_version(engine, 4)


def main(argv: list[str] | None = None) -> int:
    args = argv or sys.argv[1:]
    if len(args) != 2 or args[0] != "upgrade":
        raise SystemExit("usage: clipulse-migrate upgrade <database-url>")

    upgrade_database(args[1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
