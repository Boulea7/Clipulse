import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import text

from clipulse_api.database import create_session_factory
from clipulse_api.migrate import (
    CURRENT_SCHEMA_VERSION,
    get_schema_version,
    main as migrate_main,
    upgrade_database,
)


def test_upgrade_database_initializes_schema_version_for_fresh_database(tmp_path: Path) -> None:
    database_path = tmp_path / "clipulse.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"

    upgrade_database(database_url)

    assert get_schema_version(database_url) == CURRENT_SCHEMA_VERSION


def test_create_session_factory_rejects_legacy_database_until_upgrade_runs(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"
    create_legacy_events_database(database_path)

    with pytest.raises(RuntimeError, match="migration"):
        create_session_factory(database_url)


def test_upgrade_database_backfills_legacy_project_scope_keys_and_unblocks_startup(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"
    create_legacy_events_database(database_path)

    upgrade_database(database_url)

    assert get_schema_version(database_url) == CURRENT_SCHEMA_VERSION

    session_factory = create_session_factory(database_url)
    engine = session_factory.kw["bind"]
    with engine.connect() as connection:
        project_roots = [
            row[0]
            for row in connection.execute(
                text("SELECT project_root FROM events ORDER BY id ASC")
            ).all()
        ]

    assert project_roots == ["f902f0cad961"]


def test_upgrade_database_creates_runtime_indexes_without_needing_api_startup(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"
    create_legacy_events_database(database_path)

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        index_names = {
            row[1]
            for row in connection.execute("PRAGMA index_list('events')").fetchall()
        }
    finally:
        connection.close()

    assert "ix_events_project_root_session_id" in index_names
    assert "ix_events_event_time" in index_names
    assert "ix_events_session_id_project_root_event_time_id" in index_names
    assert "ix_events_project_root_event_time_id" in index_names


def test_migrate_cli_upgrade_command_initializes_schema_and_indexes(tmp_path: Path) -> None:
    database_path = tmp_path / "cli.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"

    result = migrate_main(["upgrade", database_url])

    assert result == 0
    assert get_schema_version(database_url) == CURRENT_SCHEMA_VERSION

    connection = sqlite3.connect(database_path)
    try:
        index_names = {
            row[1]
            for row in connection.execute("PRAGMA index_list('events')").fetchall()
        }
    finally:
        connection.close()

    assert "ix_events_project_root_session_id" in index_names


def create_legacy_events_database(database_path: Path) -> None:
    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            """
            CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                host TEXT NOT NULL,
                host_version TEXT NOT NULL,
                session_id TEXT NOT NULL,
                project_root TEXT NOT NULL,
                project_name TEXT NOT NULL,
                git_branch TEXT NOT NULL,
                event_name TEXT NOT NULL,
                event_time TEXT NOT NULL,
                model_name TEXT NOT NULL,
                os_name TEXT NOT NULL,
                editor_or_terminal TEXT NOT NULL,
                active_ms INTEGER NOT NULL,
                wait_ms INTEGER NOT NULL,
                privacy_mode TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO events (
                event_id,
                host,
                host_version,
                session_id,
                project_root,
                project_name,
                git_branch,
                event_name,
                event_time,
                model_name,
                os_name,
                editor_or_terminal,
                active_ms,
                wait_ms,
                privacy_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "legacy-event-1",
                "codex",
                "0.1.0",
                "session-1",
                "/workspace/private/demo",
                "demo",
                "main",
                "session_start",
                "2026-04-14T12:00:00Z",
                "gpt-5.4",
                "macos",
                "terminal",
                0,
                0,
                "hashed",
            ),
        )
        connection.commit()
    finally:
        connection.close()
