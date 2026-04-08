from clipulse_api.database import EventRecord, FileDeltaRecord, LanguageStatRecord
from clipulse_api.reporting import (
    build_file_preview,
    build_project_detail,
    build_project_list_items,
    build_session_detail,
    build_session_list_items,
    build_top_language,
    sort_project_items,
    sort_session_items,
)


def test_build_file_preview_respects_limit_and_clamps_non_positive_values() -> None:
    file_deltas = [
        {"fingerprint": "a", "language": "Python", "added": 3, "removed": 1},
        {"fingerprint": "b", "language": "TypeScript", "added": 2, "removed": 0},
        {"fingerprint": "c", "language": "Markdown", "added": 1, "removed": 0},
    ]

    assert build_file_preview(file_deltas, limit=2) == [
        {"fingerprint": "a", "language": "Python", "added": 3, "removed": 1},
        {"fingerprint": "b", "language": "TypeScript", "added": 2, "removed": 0},
    ]
    assert build_file_preview(file_deltas, limit=0) == []
    assert build_file_preview(file_deltas, limit=-1) == []


def test_build_top_language_returns_none_for_empty_language_list() -> None:
    assert build_top_language([]) is None


def test_sort_project_items_orders_by_active_time_then_project_name() -> None:
    items = [
        {"project_name": "zeta", "active_ms": 100},
        {"project_name": "alpha", "active_ms": 250},
        {"project_name": "beta", "active_ms": 250},
    ]

    assert sort_project_items(items) == [
        {"project_name": "alpha", "active_ms": 250},
        {"project_name": "beta", "active_ms": 250},
        {"project_name": "zeta", "active_ms": 100},
    ]


def test_sort_project_items_uses_project_ref_as_a_stable_tie_break_when_names_match() -> None:
    items = [
        {"project_name": "demo", "project_ref": "project-z", "active_ms": 250},
        {"project_name": "demo", "project_ref": "project-a", "active_ms": 250},
    ]

    assert sort_project_items(items) == [
        {"project_name": "demo", "project_ref": "project-a", "active_ms": 250},
        {"project_name": "demo", "project_ref": "project-z", "active_ms": 250},
    ]


def test_sort_session_items_orders_by_latest_time_then_session_id() -> None:
    items = [
        {"session_id": "session-b", "last_event_time": "2026-04-05T12:00:00Z"},
        {"session_id": "session-a", "last_event_time": "2026-04-05T12:00:00Z"},
        {"session_id": "session-c", "last_event_time": "2026-04-05T12:05:00Z"},
    ]

    assert sort_session_items(items) == [
        {"session_id": "session-c", "last_event_time": "2026-04-05T12:05:00Z"},
        {"session_id": "session-a", "last_event_time": "2026-04-05T12:00:00Z"},
        {"session_id": "session-b", "last_event_time": "2026-04-05T12:00:00Z"},
    ]


def test_sort_session_items_uses_project_ref_as_a_stable_tie_break_for_same_session_and_time() -> None:
    items = [
        {
            "session_id": "session-a",
            "project_ref": "project-z",
            "last_event_time": "2026-04-05T12:00:00Z",
        },
        {
            "session_id": "session-a",
            "project_ref": "project-a",
            "last_event_time": "2026-04-05T12:00:00Z",
        },
    ]

    assert sort_session_items(items) == [
        {
            "session_id": "session-a",
            "project_ref": "project-a",
            "last_event_time": "2026-04-05T12:00:00Z",
        },
        {
            "session_id": "session-a",
            "project_ref": "project-z",
            "last_event_time": "2026-04-05T12:00:00Z",
        },
    ]


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


def test_build_session_detail_uses_host_and_model_as_stable_host_model_mix_tie_breaks() -> None:
    records = [
        make_record(
            event_id="event-1",
            session_id="session-1",
            project_root="/workspace/demo",
            project_name="demo",
            host="z-host",
            model_name="z-model",
            git_branch="feat/demo",
            event_time="2026-04-05T12:00:00Z",
            active_ms=10_000,
            wait_ms=1_000,
            languages=[],
            file_deltas=[],
        ),
        make_record(
            event_id="event-2",
            session_id="session-1",
            project_root="/workspace/demo",
            project_name="demo",
            host="a-host",
            model_name="a-model",
            git_branch="feat/demo",
            event_time="2026-04-05T12:05:00Z",
            active_ms=10_000,
            wait_ms=1_000,
            languages=[],
            file_deltas=[],
        ),
    ]

    detail = build_session_detail(records, "/workspace/demo", lambda project_root: "project-demo")

    assert detail["host_model_mix"] == [
        {
            "host": "a-host",
            "model_name": "a-model",
            "events": 1,
            "active_ms": 10_000,
            "wait_ms": 1_000,
        },
        {
            "host": "z-host",
            "model_name": "z-model",
            "events": 1,
            "active_ms": 10_000,
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


def test_build_project_detail_limits_file_preview_to_top_three_sorted_entries() -> None:
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
            languages=[],
            file_deltas=[
                ("delta-b", "TypeScript", 2, 2),
                ("delta-a", "Python", 1, 3),
                ("delta-d", "Markdown", 1, 0),
            ],
        ),
        make_record(
            event_id="event-2",
            session_id="session-b",
            project_root="/workspace/demo",
            project_name="demo",
            host="claude-code",
            model_name="claude-sonnet",
            git_branch="main",
            event_time="2026-04-05T12:05:00Z",
            active_ms=8_000,
            wait_ms=1_000,
            languages=[],
            file_deltas=[("delta-c", "Go", 2, 1)],
        ),
    ]

    detail = build_project_detail(records, "/workspace/demo", lambda project_root: "project-demo")

    assert detail["changed_files_count"] == 4
    assert detail["file_preview"] == [
        {"fingerprint": "delta-a", "language": "Python", "added": 1, "removed": 3},
        {"fingerprint": "delta-b", "language": "TypeScript", "added": 2, "removed": 2},
        {"fingerprint": "delta-c", "language": "Go", "added": 2, "removed": 1},
    ]


def test_build_project_detail_returns_empty_rollup_for_no_records() -> None:
    detail = build_project_detail([], "/workspace/demo", lambda project_root: "project-demo")

    assert detail == {
        "project_name": "unknown",
        "project_ref": "project-demo",
        "active_ms": 0,
        "wait_ms": 0,
        "event_count": 0,
        "session_count": 0,
        "languages": [],
        "file_preview": [],
        "changed_files_count": 0,
        "changed_languages_count": 0,
        "lines_added": 0,
        "lines_removed": 0,
        "lines_changed": 0,
        "top_language": None,
        "host_model_mix": [],
    }


def test_build_session_list_items_rolls_up_logical_session_but_keeps_last_scalar_view() -> None:
    records = [
        make_record(
            event_id="event-1",
            session_id="session-a",
            project_root="/workspace/demo",
            project_name="demo",
            host="claude-code",
            model_name="claude-sonnet",
            git_branch="feat/demo",
            event_time="2026-04-05T12:00:00Z",
            active_ms=10_000,
            wait_ms=2_000,
            languages=[("TypeScript", 4, 1, 5)],
            file_deltas=[("ts-file", "TypeScript", 4, 1)],
        ),
        make_record(
            event_id="event-2",
            session_id="session-a",
            project_root="/workspace/demo",
            project_name="demo",
            host="codex",
            model_name="gpt-5.4",
            git_branch="feat/demo-next",
            event_time="2026-04-05T12:05:00Z",
            active_ms=8_000,
            wait_ms=1_000,
            languages=[("Markdown", 2, 0, 2)],
            file_deltas=[("readme-file", "Markdown", 2, 0)],
        ),
    ]

    items = build_session_list_items(records, lambda project_root: "project-demo")

    assert items == [
        {
            "session_id": "session-a",
            "project_name": "demo",
            "project_ref": "project-demo",
            "host": "codex",
            "model_name": "gpt-5.4",
            "git_branch": "feat/demo-next",
            "first_event_time": "2026-04-05T12:00:00Z",
            "last_event_time": "2026-04-05T12:05:00Z",
            "event_count": 2,
            "events": 2,
            "active_ms": 18_000,
            "wait_ms": 3_000,
            "changed_files_count": 2,
            "changed_languages_count": 2,
            "lines_added": 6,
            "lines_removed": 1,
            "lines_changed": 7,
            "top_language": {"name": "TypeScript", "changed": 5},
            "host_model_mix": [
                {
                    "host": "claude-code",
                    "model_name": "claude-sonnet",
                    "events": 1,
                    "active_ms": 10_000,
                    "wait_ms": 2_000,
                },
                {
                    "host": "codex",
                    "model_name": "gpt-5.4",
                    "events": 1,
                    "active_ms": 8_000,
                    "wait_ms": 1_000,
                },
            ],
            "host_model_mix_count": 2,
            "host_model_primary": {
                "host": "claude-code",
                "model_name": "claude-sonnet",
                "events": 1,
                "active_ms": 10_000,
                "wait_ms": 2_000,
            },
        }
    ]


def test_build_project_list_items_uses_primary_host_model_by_active_time() -> None:
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
            active_ms=7_000,
            wait_ms=1_000,
            languages=[("TypeScript", 3, 1, 4)],
            file_deltas=[("ts-file", "TypeScript", 3, 1)],
        ),
        make_record(
            event_id="event-2",
            session_id="session-b",
            project_root="/workspace/demo",
            project_name="demo",
            host="claude-code",
            model_name="claude-sonnet",
            git_branch="main",
            event_time="2026-04-05T12:10:00Z",
            active_ms=11_000,
            wait_ms=2_000,
            languages=[("Markdown", 2, 0, 2)],
            file_deltas=[("readme-file", "Markdown", 2, 0)],
        ),
    ]

    items = build_project_list_items(records, lambda project_root: "project-demo")

    assert items == [
        {
            "project_name": "demo",
            "project_ref": "project-demo",
            "events": 2,
            "active_ms": 18_000,
            "wait_ms": 3_000,
            "changed_files_count": 2,
            "changed_languages_count": 2,
            "lines_added": 5,
            "lines_removed": 1,
            "lines_changed": 6,
            "top_language": {"name": "TypeScript", "changed": 4},
            "host_model_mix_count": 2,
            "host_model_primary": {
                "host": "claude-code",
                "model_name": "claude-sonnet",
                "events": 1,
                "active_ms": 11_000,
                "wait_ms": 2_000,
            },
        }
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
