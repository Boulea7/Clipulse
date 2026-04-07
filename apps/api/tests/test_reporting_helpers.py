from pathlib import Path

import pytest

from clipulse_api.database import EventRecord, create_session_factory
from clipulse_api.errors import (
    ambiguous_session_error,
    project_not_found_error,
    session_not_found_error,
)
from clipulse_api.lookups import (
    compute_project_ref,
    load_database_status,
    load_session_detail_records,
)
from clipulse_api.runtime_status import collect_spool_status, resolve_state_dir


def test_load_session_detail_records_requires_project_ref_for_ambiguous_session() -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    with session_factory() as session:
        session.add_all(
            [
                make_event_record(
                    event_id="event-1",
                    session_id="shared",
                    project_root="/workspace/demo-a",
                    project_name="demo-a",
                    event_time="2026-04-05T12:00:00Z",
                ),
                make_event_record(
                    event_id="event-2",
                    session_id="shared",
                    project_root="/workspace/demo-b",
                    project_name="demo-b",
                    event_time="2026-04-05T12:05:00Z",
                ),
            ]
        )
        session.commit()

        with pytest.raises(type(ambiguous_session_error())) as exc_info:
            load_session_detail_records(session, session_id="shared")

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "ambiguous_session"


def test_load_session_detail_records_returns_scoped_project_records() -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    target_root = "/workspace/demo-b"
    with session_factory() as session:
        session.add_all(
            [
                make_event_record(
                    event_id="event-1",
                    session_id="shared",
                    project_root="/workspace/demo-a",
                    project_name="demo-a",
                    event_time="2026-04-05T12:00:00Z",
                ),
                make_event_record(
                    event_id="event-2",
                    session_id="shared",
                    project_root=target_root,
                    project_name="demo-b",
                    event_time="2026-04-05T12:05:00Z",
                ),
                make_event_record(
                    event_id="event-3",
                    session_id="shared",
                    project_root=target_root,
                    project_name="demo-b",
                    event_time="2026-04-05T12:06:00Z",
                ),
            ]
        )
        session.commit()

        records, project_root = load_session_detail_records(
            session,
            session_id="shared",
            project_ref=compute_project_ref(target_root),
        )

    assert project_root == target_root
    assert [record.event_id for record in records] == ["event-2", "event-3"]


def test_load_session_detail_records_raises_session_not_found_for_unknown_session() -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    with session_factory() as session:
        session.add(
            make_event_record(
                event_id="event-1",
                session_id="session-a",
                project_root="/workspace/demo-a",
                project_name="demo-a",
                event_time="2026-04-05T12:00:00Z",
            )
        )
        session.commit()

        with pytest.raises(type(session_not_found_error())) as exc_info:
            load_session_detail_records(session, session_id="missing-session")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == "session_not_found"


def test_load_session_detail_records_raises_project_not_found_for_unknown_project_ref() -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    with session_factory() as session:
        session.add(
            make_event_record(
                event_id="event-1",
                session_id="session-a",
                project_root="/workspace/demo-a",
                project_name="demo-a",
                event_time="2026-04-05T12:00:00Z",
            )
        )
        session.commit()

        with pytest.raises(type(project_not_found_error())) as exc_info:
            load_session_detail_records(
                session,
                session_id="session-a",
                project_ref="does-not-exist",
            )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == "project_not_found"


def test_load_database_status_counts_events_projects_and_scoped_sessions() -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    with session_factory() as session:
        session.add_all(
            [
                make_event_record(
                    event_id="event-1",
                    session_id="session-1",
                    project_root="/workspace/demo-a",
                    project_name="demo-a",
                    event_time="2026-04-05T12:00:00Z",
                ),
                make_event_record(
                    event_id="event-2",
                    session_id="session-1",
                    project_root="/workspace/demo-a",
                    project_name="demo-a",
                    event_time="2026-04-05T12:05:00Z",
                ),
                make_event_record(
                    event_id="event-3",
                    session_id="session-1",
                    project_root="/workspace/demo-b",
                    project_name="demo-b",
                    event_time="2026-04-05T12:10:00Z",
                ),
            ]
        )
        session.commit()

        assert load_database_status(session) == {
            "events": 3,
            "projects": 2,
            "sessions": 2,
        }


def test_resolve_state_dir_prefers_explicit_env_then_xdg_then_home(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLIPULSE_STATE_DIR", "/tmp/clipulse-explicit")
    monkeypatch.setenv("XDG_STATE_HOME", "/tmp/xdg-state")

    assert resolve_state_dir() == Path("/tmp/clipulse-explicit")

    monkeypatch.delenv("CLIPULSE_STATE_DIR")

    assert resolve_state_dir() == Path("/tmp/xdg-state") / "clipulse"

    monkeypatch.delenv("XDG_STATE_HOME")

    assert resolve_state_dir() == Path.home() / ".local" / "state" / "clipulse"


def test_collect_spool_status_ignores_meta_files_and_nested_directories(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    ready_dir = state_dir / "spool" / "ready"
    processing_dir = state_dir / "spool" / "processing"
    quarantine_dir = state_dir / "spool" / "quarantine"
    ready_dir.mkdir(parents=True)
    processing_dir.mkdir(parents=True)
    quarantine_dir.mkdir(parents=True)

    ready_job = ready_dir / "job-1.json"
    processing_job = processing_dir / "job-2.json"
    quarantine_job = quarantine_dir / "job-3.json"
    ready_job.write_text('{"events":[1]}', encoding="utf-8")
    processing_job.write_text('{"events":[2]}', encoding="utf-8")
    quarantine_job.write_text('{"events":[3]}', encoding="utf-8")
    (ready_dir / "job-1.meta.json").write_text("{}", encoding="utf-8")
    (processing_dir / "job-2.meta.json").write_text("{}", encoding="utf-8")
    (quarantine_dir / "job-3.meta.json").write_text("{}", encoding="utf-8")
    (ready_dir / "nested").mkdir()

    status = collect_spool_status(state_dir)

    assert status["state_dir"] == str(state_dir)
    assert status["ready"] == 1
    assert status["processing"] == 1
    assert status["quarantine"] == 1
    assert status["ready_bytes"] == ready_job.stat().st_size
    assert status["processing_bytes"] == processing_job.stat().st_size
    assert status["quarantine_bytes"] == quarantine_job.stat().st_size
    assert status["oldest_backlog_age_seconds"] >= 0
    assert status["oldest_quarantine_age_seconds"] >= 0


def test_collect_spool_status_returns_zeroes_when_spool_directories_are_missing(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "missing-state"

    assert collect_spool_status(state_dir) == {
        "state_dir": str(state_dir),
        "ready": 0,
        "processing": 0,
        "quarantine": 0,
        "ready_bytes": 0,
        "processing_bytes": 0,
        "quarantine_bytes": 0,
        "oldest_backlog_age_seconds": 0,
        "oldest_quarantine_age_seconds": 0,
    }


def make_event_record(
    *,
    event_id: str,
    session_id: str,
    project_root: str,
    project_name: str,
    event_time: str,
) -> EventRecord:
    return EventRecord(
        event_id=event_id,
        host="codex",
        host_version="0.1.0",
        session_id=session_id,
        project_root=project_root,
        project_name=project_name,
        git_branch="main",
        event_name="stop",
        event_time=event_time,
        model_name="gpt-5.4",
        os_name="macos",
        editor_or_terminal="terminal",
        active_ms=1000,
        wait_ms=100,
        privacy_mode="hashed",
    )
