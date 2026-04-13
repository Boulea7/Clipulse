import os
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from clipulse_api.database import EventRecord, create_session_factory
from clipulse_api.errors import (
    ambiguous_session_error,
    project_not_found_error,
    session_not_found_error,
)
from clipulse_api.lookups import (
    compute_project_ref,
    load_database_status,
    require_project_by_ref,
    resolve_project_by_ref,
    load_session_detail_records,
)
import clipulse_api.lookups as lookups
from clipulse_api.runtime_status import collect_spool_status, resolve_state_dir
import clipulse_api.runtime_status as runtime_status


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


def test_resolve_project_by_ref_uses_reporting_canonical_project_name() -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    project_root = "/workspace/demo-a"
    project_ref = compute_project_ref(project_root)

    with session_factory() as session:
        session.add_all(
            [
                make_event_record(
                    event_id="event-1",
                    session_id="session-a",
                    project_root=project_root,
                    project_name="zeta-demo",
                    event_time="2026-04-05T12:00:00Z",
                ),
                make_event_record(
                    event_id="event-2",
                    session_id="session-b",
                    project_root=project_root,
                    project_name="alpha-demo",
                    event_time="2026-04-05T12:05:00Z",
                ),
            ]
        )
        session.commit()

        project = resolve_project_by_ref(session, project_ref)

    assert project == {
        "project_ref": project_ref,
        "project_root": project_root,
        "project_name": "zeta-demo",
    }


def test_require_project_by_ref_returns_reporting_canonical_project_name() -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    project_root = "/workspace/demo-a"
    project_ref = compute_project_ref(project_root)

    with session_factory() as session:
        session.add_all(
            [
                make_event_record(
                    event_id="event-1",
                    session_id="session-a",
                    project_root=project_root,
                    project_name="zeta-demo",
                    event_time="2026-04-05T12:00:00Z",
                ),
                make_event_record(
                    event_id="event-2",
                    session_id="session-b",
                    project_root=project_root,
                    project_name="alpha-demo",
                    event_time="2026-04-05T12:05:00Z",
                ),
            ]
        )
        session.commit()

        project = require_project_by_ref(session, project_ref)

    assert project["project_name"] == "zeta-demo"


def test_load_session_detail_records_defensively_sorts_records_when_query_order_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    target_root = "/workspace/demo-b"

    def unsorted_reporting_query():
        return select(EventRecord).options(
            selectinload(EventRecord.language_stats),
            selectinload(EventRecord.file_deltas),
        )

    monkeypatch.setattr(lookups, "reporting_query", unsorted_reporting_query)

    with session_factory() as session:
        session.add_all(
            [
                make_event_record(
                    event_id="event-late",
                    session_id="shared",
                    project_root=target_root,
                    project_name="demo-b",
                    event_time="2026-04-05T12:06:00Z",
                ),
                make_event_record(
                    event_id="event-early",
                    session_id="shared",
                    project_root=target_root,
                    project_name="demo-b",
                    event_time="2026-04-05T12:05:00Z",
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
    assert [record.event_id for record in records] == ["event-early", "event-late"]


def test_load_session_detail_records_defensively_sorts_by_parsed_utc_time_for_mixed_formats(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_factory = create_session_factory("sqlite+pysqlite:///:memory:")
    target_root = "/workspace/demo-b"

    def unsorted_reporting_query():
        return select(EventRecord).options(
            selectinload(EventRecord.language_stats),
            selectinload(EventRecord.file_deltas),
        )

    monkeypatch.setattr(lookups, "reporting_query", unsorted_reporting_query)

    with session_factory() as session:
        session.add_all(
            [
                make_event_record(
                    event_id="event-zulu",
                    session_id="shared",
                    project_root=target_root,
                    project_name="demo-b",
                    event_time="2026-04-05T11:30:00Z",
                ),
                make_event_record(
                    event_id="event-offset",
                    session_id="shared",
                    project_root=target_root,
                    project_name="demo-b",
                    event_time="2026-04-05T12:00:00+01:00",
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
    assert [record.event_id for record in records] == ["event-offset", "event-zulu"]


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


def test_collect_spool_status_ignores_non_json_files(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    ready_dir = state_dir / "spool" / "ready"
    ready_dir.mkdir(parents=True)

    payload = ready_dir / "job-1.json"
    payload.write_text('{"events":[1]}', encoding="utf-8")
    (ready_dir / "README.txt").write_text("ignore me", encoding="utf-8")
    (ready_dir / "job-1.meta.json").write_text("{}", encoding="utf-8")

    status = collect_spool_status(state_dir)

    assert status["ready"] == 1
    assert status["ready_bytes"] == payload.stat().st_size


def test_collect_spool_status_treats_orphan_sidecars_as_zero_payload_backlog(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    ready_dir = state_dir / "spool" / "ready"
    processing_dir = state_dir / "spool" / "processing"
    quarantine_dir = state_dir / "spool" / "quarantine"
    ready_dir.mkdir(parents=True)
    processing_dir.mkdir(parents=True)
    quarantine_dir.mkdir(parents=True)

    (ready_dir / "job-1.meta.json").write_text("{}", encoding="utf-8")
    (processing_dir / "job-2.meta.json").write_text("{}", encoding="utf-8")
    (quarantine_dir / "job-3.meta.json").write_text("{}", encoding="utf-8")

    assert collect_spool_status(state_dir) == {
        "state_dir": str(state_dir),
        "backlog_mode": "empty",
        "ready": 0,
        "processing": 0,
        "quarantine": 0,
        "ready_bytes": 0,
        "processing_bytes": 0,
        "quarantine_bytes": 0,
        "oldest_backlog_age_seconds": 0,
        "oldest_quarantine_age_seconds": 0,
    }


def test_collect_spool_status_uses_payload_mtime_instead_of_sidecar_mtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state_dir = tmp_path / "state"
    ready_dir = state_dir / "spool" / "ready"
    processing_dir = state_dir / "spool" / "processing"
    ready_dir.mkdir(parents=True)
    processing_dir.mkdir(parents=True)

    ready_payload = ready_dir / "job-1.json"
    processing_payload = processing_dir / "job-2.json"
    ready_sidecar = ready_dir / "job-1.meta.json"
    ready_payload.write_text('{"events":[1]}', encoding="utf-8")
    processing_payload.write_text('{"events":[2]}', encoding="utf-8")
    ready_sidecar.write_text("{}", encoding="utf-8")

    ready_mtime = 100.0
    processing_mtime = 130.0
    sidecar_mtime = 10.0
    monkeypatch.setattr(runtime_status, "time", lambda: 200.0)
    os.utime(ready_payload, (ready_mtime, ready_mtime))
    os.utime(processing_payload, (processing_mtime, processing_mtime))
    os.utime(ready_sidecar, (sidecar_mtime, sidecar_mtime))

    status = collect_spool_status(state_dir)

    assert status["oldest_backlog_age_seconds"] == 100


def test_collect_spool_status_returns_zeroes_when_spool_directories_are_missing(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "missing-state"

    assert collect_spool_status(state_dir) == {
        "state_dir": str(state_dir),
        "backlog_mode": "missing_state_dir",
        "ready": 0,
        "processing": 0,
        "quarantine": 0,
        "ready_bytes": 0,
        "processing_bytes": 0,
        "quarantine_bytes": 0,
        "oldest_backlog_age_seconds": 0,
        "oldest_quarantine_age_seconds": 0,
    }


def test_collect_spool_status_uses_payload_mtime_for_quarantine_age_instead_of_sidecar_mtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state_dir = tmp_path / "state"
    quarantine_dir = state_dir / "spool" / "quarantine"
    quarantine_dir.mkdir(parents=True)

    quarantine_payload = quarantine_dir / "job-3.json"
    quarantine_sidecar = quarantine_dir / "job-3.meta.json"
    quarantine_payload.write_text('{"events":[3]}', encoding="utf-8")
    quarantine_sidecar.write_text("{}", encoding="utf-8")

    payload_mtime = 150.0
    sidecar_mtime = 25.0
    monkeypatch.setattr(runtime_status, "time", lambda: 200.0)
    os.utime(quarantine_payload, (payload_mtime, payload_mtime))
    os.utime(quarantine_sidecar, (sidecar_mtime, sidecar_mtime))

    status = collect_spool_status(state_dir)

    assert status["oldest_quarantine_age_seconds"] == 50


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
