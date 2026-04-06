from clipulse_api.database import EventRecord, FileDeltaRecord, LanguageStatRecord
from clipulse_api.reporting import build_project_detail, build_session_detail


def test_build_session_detail_rolls_up_languages_files_and_host_model_mix() -> None:
    records = [
        make_record(
            event_id="event-1",
            session_id="session-1",
            project_root="/workspace/demo",
            project_name="demo",
            host="codex",
            model_name="gpt-5.4",
            git_branch="feat/demo",
            event_time="2026-04-05T12:00:00Z",
            active_ms=12_000,
            wait_ms=3_000,
            languages=[("TypeScript", 5, 1, 6)],
            file_deltas=[("ts-file", "TypeScript", 5, 1)],
        ),
        make_record(
            event_id="event-2",
            session_id="session-1",
            project_root="/workspace/demo",
            project_name="demo",
            host="claude-code",
            model_name="claude-sonnet",
            git_branch="feat/demo",
            event_time="2026-04-05T12:05:00Z",
            active_ms=6_000,
            wait_ms=1_000,
            languages=[("Python", 3, 0, 3)],
            file_deltas=[("py-file", "Python", 3, 0)],
        ),
    ]

    detail = build_session_detail(records, "/workspace/demo", lambda project_root: "project-demo")

    assert detail["project_ref"] == "project-demo"
    assert detail["event_count"] == 2
    assert detail["active_ms"] == 18_000
    assert detail["wait_ms"] == 4_000
    assert detail["changed_files_count"] == 2
    assert detail["changed_languages_count"] == 2
    assert detail["lines_changed"] == 9
    assert detail["top_language"] == {"name": "TypeScript", "changed": 6}
    assert detail["host_model_mix"] == [
        {
            "host": "codex",
            "model_name": "gpt-5.4",
            "events": 1,
            "active_ms": 12_000,
            "wait_ms": 3_000,
        },
        {
            "host": "claude-code",
            "model_name": "claude-sonnet",
            "events": 1,
            "active_ms": 6_000,
            "wait_ms": 1_000,
        },
    ]


def test_build_project_detail_counts_unique_sessions_and_file_preview() -> None:
    records = [
        make_record(
            event_id="event-1",
            session_id="session-a",
            project_root="/workspace/demo",
            project_name="demo",
            host="codex",
            model_name="gpt-5.4",
            git_branch="main",
            event_time="2026-04-05T12:00:00Z",
            active_ms=10_000,
            wait_ms=2_000,
            languages=[("TypeScript", 4, 1, 5)],
            file_deltas=[("ts-file", "TypeScript", 4, 1)],
        ),
        make_record(
            event_id="event-2",
            session_id="session-b",
            project_root="/workspace/demo",
            project_name="demo",
            host="codex",
            model_name="gpt-5.4",
            git_branch="main",
            event_time="2026-04-05T13:00:00Z",
            active_ms=8_000,
            wait_ms=1_000,
            languages=[("Markdown", 2, 0, 2)],
            file_deltas=[("readme-file", "Markdown", 2, 0)],
        ),
    ]

    detail = build_project_detail(records, "/workspace/demo", lambda project_root: "project-demo")

    assert detail["project_name"] == "demo"
    assert detail["project_ref"] == "project-demo"
    assert detail["session_count"] == 2
    assert detail["changed_files_count"] == 2
    assert detail["file_preview"] == [
        {"fingerprint": "ts-file", "language": "TypeScript", "added": 4, "removed": 1},
        {"fingerprint": "readme-file", "language": "Markdown", "added": 2, "removed": 0},
    ]


def make_record(
    *,
    event_id: str,
    session_id: str,
    project_root: str,
    project_name: str,
    host: str,
    model_name: str,
    git_branch: str,
    event_time: str,
    active_ms: int,
    wait_ms: int,
    languages: list[tuple[str, int, int, int]],
    file_deltas: list[tuple[str, str, int, int]],
) -> EventRecord:
    record = EventRecord(
        event_id=event_id,
        host=host,
        host_version="0.1.0",
        session_id=session_id,
        project_root=project_root,
        project_name=project_name,
        git_branch=git_branch,
        event_name="stop",
        event_time=event_time,
        model_name=model_name,
        os_name="macos",
        editor_or_terminal="terminal",
        active_ms=active_ms,
        wait_ms=wait_ms,
        privacy_mode="hashed",
    )
    record.language_stats = [
        LanguageStatRecord(name=name, added=added, removed=removed, changed=changed)
        for name, added, removed, changed in languages
    ]
    record.file_deltas = [
        FileDeltaRecord(fingerprint=fingerprint, language=language, added=added, removed=removed)
        for fingerprint, language, added, removed in file_deltas
    ]
    return record
