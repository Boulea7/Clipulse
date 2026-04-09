from collections.abc import Callable
from datetime import UTC, datetime

from .database import EventRecord

ProjectRefBuilder = Callable[[str], str]


def parse_utc_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def build_file_preview(
    file_deltas: list[dict[str, int | str]],
    limit: int = 3,
) -> list[dict[str, int | str]]:
    normalized_limit = max(limit, 0)
    return [
        {
            "fingerprint": str(item["fingerprint"]),
            "language": str(item["language"]),
            "added": int(item["added"]),
            "removed": int(item["removed"]),
        }
        for item in file_deltas[:normalized_limit]
    ]


def build_top_language(
    languages: list[dict[str, int | str]],
) -> dict[str, int | str] | None:
    if not languages:
        return None

    return {
        "name": str(languages[0]["name"]),
        "changed": int(languages[0]["changed"]),
    }


def _build_language_totals(records: list[EventRecord]) -> list[dict[str, int | str]]:
    language_totals: dict[str, dict[str, int | str]] = {}

    for record in records:
        for language in record.language_stats:
            bucket = language_totals.setdefault(
                language.name,
                {"name": language.name, "added": 0, "removed": 0, "changed": 0},
            )
            bucket["added"] = int(bucket["added"]) + language.added
            bucket["removed"] = int(bucket["removed"]) + language.removed
            bucket["changed"] = int(bucket["changed"]) + language.changed

    return sorted(
        language_totals.values(),
        key=lambda item: (-int(item["changed"]), str(item["name"])),
    )


def _build_file_delta_totals(records: list[EventRecord]) -> list[dict[str, int | str]]:
    file_delta_totals: dict[tuple[str, str], dict[str, int | str]] = {}

    for record in records:
        for delta in record.file_deltas:
            key = (delta.fingerprint, delta.language)
            bucket = file_delta_totals.setdefault(
                key,
                {
                    "fingerprint": delta.fingerprint,
                    "language": delta.language,
                    "added": 0,
                    "removed": 0,
                },
            )
            bucket["added"] = int(bucket["added"]) + delta.added
            bucket["removed"] = int(bucket["removed"]) + delta.removed

    return sorted(
        file_delta_totals.values(),
        key=lambda item: (
            -int(item["added"]) - int(item["removed"]),
            str(item["fingerprint"]),
            str(item["language"]),
        ),
    )


def _build_host_model_mix(records: list[EventRecord]) -> list[dict[str, int | str]]:
    host_model_mix_totals: dict[tuple[str, str], dict[str, int | str]] = {}

    for record in records:
        key = (record.host, record.model_name)
        bucket = host_model_mix_totals.setdefault(
            key,
            {
                "host": record.host,
                "model_name": record.model_name,
                "events": 0,
                "active_ms": 0,
                "wait_ms": 0,
            },
        )
        bucket["events"] = int(bucket["events"]) + 1
        bucket["active_ms"] = int(bucket["active_ms"]) + record.active_ms
        bucket["wait_ms"] = int(bucket["wait_ms"]) + record.wait_ms

    return sorted(
        host_model_mix_totals.values(),
        key=lambda item: (
            -int(item["active_ms"]),
            -int(item["events"]),
            str(item["host"]),
            str(item["model_name"]),
        ),
    )


def _sort_records(records: list[EventRecord]) -> list[EventRecord]:
    return sorted(
        records,
        key=lambda record: (
            parse_utc_datetime(str(record.event_time)),
            int(record.id or 0),
        ),
    )


def _canonical_project_name(records: list[EventRecord]) -> str:
    return _sort_records(records)[0].project_name


def _build_canonical_project_names(records: list[EventRecord]) -> dict[str, str]:
    return {
        project_root: _canonical_project_name(grouped_records)
        for project_root, grouped_records in _group_records_by_project(records)
    }


def _build_rollup(records: list[EventRecord]) -> dict[str, object]:
    ordered_records = _sort_records(records)
    first = ordered_records[0]
    last = ordered_records[-1]
    languages = _build_language_totals(ordered_records)
    file_deltas = _build_file_delta_totals(ordered_records)
    file_preview = build_file_preview(file_deltas)
    host_model_mix = _build_host_model_mix(ordered_records)
    lines_added = sum(int(item["added"]) for item in file_deltas)
    lines_removed = sum(int(item["removed"]) for item in file_deltas)

    return {
        "first": first,
        "last": last,
        "event_count": len(ordered_records),
        "active_ms": sum(record.active_ms for record in ordered_records),
        "wait_ms": sum(record.wait_ms for record in ordered_records),
        "languages": languages,
        "file_deltas": file_deltas,
        "file_preview": file_preview,
        "file_preview_truncated_count": max(len(file_deltas) - len(file_preview), 0),
        "changed_files_count": len(file_deltas),
        "changed_languages_count": len(languages),
        "lines_added": lines_added,
        "lines_removed": lines_removed,
        "lines_changed": lines_added + lines_removed,
        "top_language": build_top_language(languages),
        "host_model_mix": host_model_mix,
        "host_model_mix_count": len(host_model_mix),
        "host_model_primary": host_model_mix[0] if host_model_mix else None,
    }


def _group_records_by_session(
    records: list[EventRecord],
) -> list[tuple[str, list[EventRecord]]]:
    grouped: dict[tuple[str, str], list[EventRecord]] = {}

    for record in records:
        key = (record.project_root, record.session_id)
        grouped.setdefault(key, []).append(record)

    return [
        (project_root, grouped_records)
        for (project_root, _session_id), grouped_records in grouped.items()
    ]


def _group_records_by_project(
    records: list[EventRecord],
) -> list[tuple[str, list[EventRecord]]]:
    grouped: dict[str, list[EventRecord]] = {}

    for record in records:
        grouped.setdefault(record.project_root, []).append(record)

    return list(grouped.items())


def build_session_list_items(
    records: list[EventRecord],
    project_ref_builder: ProjectRefBuilder,
) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    canonical_project_names = _build_canonical_project_names(records)

    for project_root, grouped_records in _group_records_by_session(records):
        rollup = _build_rollup(grouped_records)
        first = rollup["first"]
        last = rollup["last"]
        items.append(
            {
                "session_id": first.session_id,
                "project_name": canonical_project_names.get(project_root, first.project_name),
                "project_ref": project_ref_builder(project_root),
                "host": last.host,
                "last_host": last.host,
                "model_name": last.model_name,
                "last_model_name": last.model_name,
                "git_branch": last.git_branch,
                "last_git_branch": last.git_branch,
                "first_event_time": first.event_time,
                "last_event_time": last.event_time,
                "event_count": int(rollup["event_count"]),
                "events": int(rollup["event_count"]),
                "active_ms": int(rollup["active_ms"]),
                "wait_ms": int(rollup["wait_ms"]),
                "changed_files_count": int(rollup["changed_files_count"]),
                "changed_languages_count": int(rollup["changed_languages_count"]),
                "lines_added": int(rollup["lines_added"]),
                "lines_removed": int(rollup["lines_removed"]),
                "lines_changed": int(rollup["lines_changed"]),
                "top_language": rollup["top_language"],
                "host_model_mix": rollup["host_model_mix"],
                "host_model_mix_count": int(rollup["host_model_mix_count"]),
                "host_model_primary": rollup["host_model_primary"],
            }
        )

    return items


def build_session_detail(
    records: list[EventRecord],
    project_root: str,
    project_ref_builder: ProjectRefBuilder,
    project_name: str | None = None,
) -> dict[str, object]:
    rollup = _build_rollup(records)
    first = rollup["first"]
    last = rollup["last"]

    return {
        "session_id": first.session_id,
        "project_name": project_name or first.project_name,
        "project_ref": project_ref_builder(project_root),
        "host": last.host,
        "last_host": last.host,
        "model_name": last.model_name,
        "last_model_name": last.model_name,
        "git_branch": last.git_branch,
        "last_git_branch": last.git_branch,
        "first_event_time": first.event_time,
        "last_event_time": last.event_time,
        "event_count": int(rollup["event_count"]),
        "events": int(rollup["event_count"]),
        "active_ms": int(rollup["active_ms"]),
        "wait_ms": int(rollup["wait_ms"]),
        "languages": rollup["languages"],
        "file_deltas": rollup["file_deltas"],
        "file_preview": rollup["file_preview"],
        "file_preview_truncated_count": int(rollup["file_preview_truncated_count"]),
        "changed_files_count": int(rollup["changed_files_count"]),
        "changed_languages_count": int(rollup["changed_languages_count"]),
        "lines_added": int(rollup["lines_added"]),
        "lines_removed": int(rollup["lines_removed"]),
        "lines_changed": int(rollup["lines_changed"]),
        "host_model_mix": rollup["host_model_mix"],
        "host_model_mix_count": int(rollup["host_model_mix_count"]),
        "host_model_primary": rollup["host_model_primary"],
        "top_language": rollup["top_language"],
    }


def build_project_list_items(
    records: list[EventRecord],
    project_ref_builder: ProjectRefBuilder,
) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []

    for project_root, grouped_records in _group_records_by_project(records):
        rollup = _build_rollup(grouped_records)
        items.append(
            {
                "project_name": _canonical_project_name(grouped_records),
                "project_ref": project_ref_builder(project_root),
                "events": int(rollup["event_count"]),
                "active_ms": int(rollup["active_ms"]),
                "wait_ms": int(rollup["wait_ms"]),
                "changed_files_count": int(rollup["changed_files_count"]),
                "changed_languages_count": int(rollup["changed_languages_count"]),
                "lines_added": int(rollup["lines_added"]),
                "lines_removed": int(rollup["lines_removed"]),
                "lines_changed": int(rollup["lines_changed"]),
                "top_language": rollup["top_language"],
                "host_model_mix_count": int(rollup["host_model_mix_count"]),
                "host_model_primary": rollup["host_model_primary"],
            }
        )

    return items


def build_project_detail(
    records: list[EventRecord],
    project_root: str,
    project_ref_builder: ProjectRefBuilder,
) -> dict[str, object]:
    if not records:
        return {
            "project_name": "unknown",
            "project_ref": project_ref_builder(project_root),
            "active_ms": 0,
            "wait_ms": 0,
            "event_count": 0,
            "session_count": 0,
            "languages": [],
            "file_preview": [],
            "file_preview_truncated_count": 0,
            "changed_files_count": 0,
            "changed_languages_count": 0,
            "lines_added": 0,
            "lines_removed": 0,
            "lines_changed": 0,
            "top_language": None,
            "host_model_mix": [],
            "host_model_mix_count": 0,
            "host_model_primary": None,
            "last_event_time": None,
            "last_host": None,
            "last_model_name": None,
            "last_git_branch": None,
        }

    rollup = _build_rollup(records)
    last = rollup["last"]

    return {
        "project_name": _canonical_project_name(records),
        "project_ref": project_ref_builder(project_root),
        "active_ms": int(rollup["active_ms"]),
        "wait_ms": int(rollup["wait_ms"]),
        "event_count": int(rollup["event_count"]),
        "session_count": len({(record.project_root, record.session_id) for record in records}),
        "last_event_time": last.event_time,
        "last_host": last.host,
        "last_model_name": last.model_name,
        "last_git_branch": last.git_branch,
        "languages": rollup["languages"],
        "file_preview": rollup["file_preview"],
        "file_preview_truncated_count": int(rollup["file_preview_truncated_count"]),
        "changed_files_count": int(rollup["changed_files_count"]),
        "changed_languages_count": int(rollup["changed_languages_count"]),
        "lines_added": int(rollup["lines_added"]),
        "lines_removed": int(rollup["lines_removed"]),
        "lines_changed": int(rollup["lines_changed"]),
        "top_language": rollup["top_language"],
        "host_model_mix": rollup["host_model_mix"],
        "host_model_mix_count": int(rollup["host_model_mix_count"]),
        "host_model_primary": rollup["host_model_primary"],
    }


def sort_project_items(
    items: list[dict[str, object]],
) -> list[dict[str, object]]:
    return sorted(
        items,
        key=lambda item: (
            -int(item["active_ms"]),
            str(item["project_name"]),
            str(item.get("project_ref", "")),
        ),
    )


def sort_session_items(
    items: list[dict[str, object]],
) -> list[dict[str, object]]:
    sorted_items = sorted(
        items,
        key=lambda item: (
            str(item["session_id"]),
            str(item.get("project_ref", "")),
        ),
    )
    return sorted(
        sorted_items,
        key=lambda item: parse_utc_datetime(str(item["last_event_time"])),
        reverse=True,
    )
