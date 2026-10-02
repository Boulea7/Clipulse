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


def test_upgrade_database_creates_auth_session_tables_and_indexes(tmp_path: Path) -> None:
    database_path = tmp_path / "auth.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        dashboard_session_indexes = {
            row[1]
            for row in connection.execute("PRAGMA index_list('dashboard_sessions')").fetchall()
        }
        auth_rate_limit_indexes = {
            row[1]
            for row in connection.execute("PRAGMA index_list('auth_rate_limits')").fetchall()
        }
    finally:
        connection.close()

    assert "dashboard_sessions" in table_names
    assert "auth_rate_limits" in table_names
    assert "ix_dashboard_sessions_expires_at" in dashboard_session_indexes
    assert "ix_auth_rate_limits_family_client_ref_blocked_until" in auth_rate_limit_indexes


def test_upgrade_database_adds_optional_usage_columns_for_existing_events(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "usage.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"
    create_legacy_events_database(database_path)

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        columns = {
            row[1]: row[2]
            for row in connection.execute("PRAGMA table_info('events')").fetchall()
        }
        row = connection.execute(
            """
            SELECT provider, source, input_tokens, output_tokens, cache_creation_tokens,
                   cache_read_tokens, reasoning_tokens, total_tokens, cost_usd
            FROM events
            """
        ).fetchone()
    finally:
        connection.close()

    assert columns["provider"] == "VARCHAR"
    assert columns["source"] == "VARCHAR"
    assert columns["input_tokens"] == "INTEGER"
    assert columns["output_tokens"] == "INTEGER"
    assert columns["cache_creation_tokens"] == "INTEGER"
    assert columns["cache_read_tokens"] == "INTEGER"
    assert columns["reasoning_tokens"] == "INTEGER"
    assert columns["total_tokens"] == "INTEGER"
    assert columns["cost_usd"] == "FLOAT"
    assert row == (None, None, None, None, None, None, None, None, None)


def test_upgrade_database_creates_app_settings_table(tmp_path: Path) -> None:
    database_path = tmp_path / "settings.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        columns = {
            row[1]: row[2]
            for row in connection.execute("PRAGMA table_info('app_settings')").fetchall()
        }
    finally:
        connection.close()

    assert columns == {
        "key": "VARCHAR",
        "value_json": "VARCHAR",
        "updated_at": "VARCHAR",
    }


def test_upgrade_database_adds_app_settings_table_to_existing_v3_database(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "settings-v3.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"
    create_v3_events_database(database_path)

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        columns = {
            row[1]: row[2]
            for row in connection.execute("PRAGMA table_info('app_settings')").fetchall()
        }
    finally:
        connection.close()

    assert get_schema_version(database_url) == CURRENT_SCHEMA_VERSION
    assert "app_settings" in table_names
    assert columns == {
        "key": "VARCHAR",
        "value_json": "VARCHAR",
        "updated_at": "VARCHAR",
    }


def test_upgrade_database_is_idempotent_for_an_already_upgraded_database(tmp_path: Path) -> None:
    database_path = tmp_path / "idempotent.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"

    upgrade_database(database_url)
    first_version = get_schema_version(database_url)

    connection = sqlite3.connect(database_path)
    try:
        index_names_before = {
            row[1]
            for row in connection.execute("PRAGMA index_list('events')").fetchall()
        }
    finally:
        connection.close()

    upgrade_database(database_url)

    assert get_schema_version(database_url) == first_version

    connection = sqlite3.connect(database_path)
    try:
        index_names_after = {
            row[1]
            for row in connection.execute("PRAGMA index_list('events')").fetchall()
        }
    finally:
        connection.close()

    assert index_names_after == index_names_before


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


def create_v3_events_database(database_path: Path) -> None:
    create_legacy_events_database(database_path)
    connection = sqlite3.connect(database_path)
    try:
        for column_name, column_type in {
            "provider": "VARCHAR",
            "source": "VARCHAR",
            "input_tokens": "INTEGER",
            "output_tokens": "INTEGER",
            "cache_creation_tokens": "INTEGER",
            "cache_read_tokens": "INTEGER",
            "reasoning_tokens": "INTEGER",
            "total_tokens": "INTEGER",
            "cost_usd": "FLOAT",
        }.items():
            connection.execute(f"ALTER TABLE events ADD COLUMN {column_name} {column_type}")
        connection.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)")
        connection.execute("INSERT INTO schema_version (version) VALUES (3)")
        connection.commit()
    finally:
        connection.close()
