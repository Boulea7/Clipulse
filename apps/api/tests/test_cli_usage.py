from datetime import UTC, datetime
import json
from pathlib import Path
import sqlite3

from clipulse_api.cli import main
from clipulse_api.migrate import upgrade_database


def test_usage_cli_daily_json_reads_database(tmp_path: Path, capsys) -> None:
    database_path = tmp_path / "clipulse.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"
    seed_usage_database(database_path, database_url)

    result = main(["--database-url", database_url, "usage", "daily", "--json", "--breakdown"])

    assert result == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["range"]["type"] == "daily"
    assert payload["range"]["breakdown"] is True
    assert payload["totals"]["totalTokens"] == 1300
    assert payload["totals"]["costUSD"] == 0.42
    assert payload["rows"][0]["date"] == "2026-04-05"


def test_usage_cli_statusline_is_compact_and_private(tmp_path: Path, capsys) -> None:
    database_path = tmp_path / "clipulse.sqlite3"
    database_url = f"sqlite+pysqlite:///{database_path}"
    seed_usage_database(database_path, database_url)
    seed_today_statusline_event(database_path)

    result = main(["--database-url", database_url, "usage", "statusline"])

    assert result == 0
    output = capsys.readouterr().out.strip()
    assert output.startswith("Clipulse ·")
    assert "700 tok" in output
    assert "$0.12" in output
    assert "1.3k tok" not in output
    assert "/private/demo" not in output


def test_sources_status_json_redacts_custom_paths(tmp_path: Path, capsys, monkeypatch) -> None:
    source_dir = tmp_path / "sensitive" / "claude-projects"
    source_dir.mkdir(parents=True)
    (source_dir / "event.jsonl").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("CLIPULSE_CLAUDE_LOG_DIR", str(source_dir))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = main(["sources", "status", "--json"])

    assert result == 0
    payload = json.loads(capsys.readouterr().out)
    claude = next(source for source in payload["sources"] if source["id"] == "claude")
    assert claude["recordCount"] == 1
    assert claude["pathLabel"] == "<custom path redacted>"
    assert str(source_dir) not in json.dumps(payload)


def test_sources_status_table_reports_default_sources_without_raw_home(tmp_path: Path, capsys, monkeypatch) -> None:
    home = tmp_path / "home"
    claude_dir = home / ".claude" / "projects"
    claude_dir.mkdir(parents=True)
    (claude_dir / "session.jsonl").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))

    result = main(["source", "status"])

    assert result == 0
    output = capsys.readouterr().out
    assert "Clipulse sources status" in output
    assert "Claude Code | ready | 1 | ~/.claude/projects" in output
    assert str(home) not in output


def seed_today_statusline_event(database_path: Path) -> None:
    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            """
            INSERT INTO events (
                event_id, host, host_version, session_id, project_root, project_name,
                git_branch, event_name, event_time, model_name, os_name,
                editor_or_terminal, active_ms, wait_ms, privacy_mode,
                provider, source, total_tokens, cost_usd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "event-cli-today",
                "codex",
                "0.1.0",
                "session-cli-today",
                "def456def456",
                "today-demo",
                "main",
                "stop",
                datetime.now(UTC).replace(hour=12, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z"),
                "gpt-5.4",
                "macos",
                "terminal",
                60000,
                0,
                "hashed",
                "openai",
                "codex",
                700,
                0.12,
            ),
        )
        connection.commit()
    finally:
        connection.close()


def seed_usage_database(database_path: Path, database_url: str) -> None:
    upgrade_database(database_url)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            """
            INSERT INTO events (
                event_id, host, host_version, session_id, project_root, project_name,
                git_branch, event_name, event_time, model_name, os_name,
                editor_or_terminal, active_ms, wait_ms, privacy_mode,
                provider, source, input_tokens, output_tokens, total_tokens, cost_usd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "event-cli-1",
                "codex",
                "0.1.0",
                "session-cli",
                "abc123abc123",
                "private-demo",
                "main",
                "stop",
                "2026-04-05T12:00:00Z",
                "gpt-5.4",
                "macos",
                "terminal",
                2_520_000,
                60_000,
                "hashed",
                "openai",
                "codex",
                800,
                500,
                1300,
                0.42,
            ),
        )
        connection.commit()
    finally:
        connection.close()
