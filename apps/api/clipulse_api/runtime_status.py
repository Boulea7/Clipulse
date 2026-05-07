import os
import json
from datetime import datetime
from pathlib import Path
from time import time


def resolve_state_dir() -> Path:
    explicit = os.environ.get("CLIPULSE_STATE_DIR")
    if explicit:
        return Path(explicit)

    xdg_state_home = os.environ.get("XDG_STATE_HOME")
    if xdg_state_home:
        return Path(xdg_state_home) / "clipulse"

    home = os.environ.get("HOME")
    if home:
        return Path(home) / ".local" / "state" / "clipulse"

    return Path.home() / ".local" / "state" / "clipulse"


def collect_spool_status(state_dir: Path) -> dict[str, int | str | dict[str, int]]:
    state_dir_exists = state_dir.exists()
    state_dir_is_directory = state_dir.is_dir()
    state_dir_kind = _resolve_state_dir_kind(state_dir)
    spool_dir = state_dir / "spool"
    ready = _collect_directory_stats(
        spool_dir / "ready",
        excluded_suffixes=(".meta.json",),
    )
    processing = _collect_directory_stats(
        spool_dir / "processing",
        excluded_suffixes=(".meta.json",),
    )
    quarantine = _collect_directory_stats(
        spool_dir / "quarantine",
        excluded_suffixes=(".meta.json",),
    )
    flush_success = _read_last_successful_flush(state_dir / "flush-success.json")
    oldest_backlog_mtime = min(
        [mtime for mtime in (ready["oldest_mtime"], processing["oldest_mtime"]) if mtime is not None],
        default=None,
    )
    backlog_mode = _resolve_backlog_mode(
        state_dir_exists=state_dir_is_directory,
        ready_count=ready["count"],
        processing_count=processing["count"],
        quarantine_count=quarantine["count"],
    )
    orphan_sidecars = {
        "ready": _count_orphan_metadata_sidecars(spool_dir / "ready"),
        "processing": _count_orphan_metadata_sidecars(spool_dir / "processing"),
        "quarantine": _count_orphan_metadata_sidecars(spool_dir / "quarantine"),
    }
    orphan_sidecars["total"] = (
        orphan_sidecars["ready"]
        + orphan_sidecars["processing"]
        + orphan_sidecars["quarantine"]
    )

    ready_metadata = _collect_metadata_rollups(spool_dir / "ready")
    processing_metadata = _collect_metadata_rollups(spool_dir / "processing")
    quarantine_metadata = _collect_metadata_rollups(
        spool_dir / "quarantine",
        collect_reason_counts=True,
        collect_source_state_counts=True,
    )
    oldest_first_seen_timestamp = min(
        [
            timestamp
            for timestamp in (
                ready_metadata["oldest_first_seen_timestamp"],
                processing_metadata["oldest_first_seen_timestamp"],
                quarantine_metadata["oldest_first_seen_timestamp"],
            )
            if timestamp is not None
        ],
        default=None,
    )
    max_attempt_count = max(
        ready_metadata["max_attempt_count"],
        processing_metadata["max_attempt_count"],
        quarantine_metadata["max_attempt_count"],
    )
    latest_last_attempted = max(
        [
            candidate
            for candidate in (
                _build_last_attempted_candidate("ready", ready_metadata["latest_last_attempted_timestamp"]),
                _build_last_attempted_candidate(
                    "processing", processing_metadata["latest_last_attempted_timestamp"]
                ),
                _build_last_attempted_candidate(
                    "quarantine", quarantine_metadata["latest_last_attempted_timestamp"]
                ),
            )
            if candidate is not None
        ],
        default=None,
        key=lambda candidate: candidate["timestamp"],
    )

    return {
        "state_dir": str(state_dir),
        "state_dir_exists": state_dir_exists,
        "backlog_mode": backlog_mode,
        "state_dir_kind": state_dir_kind,
        "terminal_finalizer_markers": _count_json_files(state_dir / "terminal-finalizers"),
        "last_successful_flush_at": flush_success["last_successful_flush_at"],
        "last_successful_flush_age_seconds": _nullable_age_seconds(flush_success["timestamp"]),
        "ready": ready["count"],
        "processing": processing["count"],
        "quarantine": quarantine["count"],
        "ready_bytes": ready["bytes"],
        "processing_bytes": processing["bytes"],
        "quarantine_bytes": quarantine["bytes"],
        "orphan_sidecars": orphan_sidecars,
        "quarantine_reason_counts": quarantine_metadata["reason_counts"],
        "quarantine_meta_error_counts": quarantine_metadata["meta_error_counts"],
        "metadata_error_counts_by_state": {
            "ready": ready_metadata["meta_error_counts"],
            "processing": processing_metadata["meta_error_counts"],
            "quarantine": quarantine_metadata["meta_error_counts"],
        },
        "oldest_backlog_age_seconds": _age_seconds(oldest_backlog_mtime),
        "oldest_ready_age_seconds": _age_seconds(ready["oldest_mtime"]),
        "oldest_processing_age_seconds": _age_seconds(processing["oldest_mtime"]),
        "oldest_quarantine_age_seconds": _age_seconds(quarantine["oldest_mtime"]),
        "oldest_first_seen_age_seconds": _age_seconds(oldest_first_seen_timestamp),
        "last_attempted_age_seconds": _age_seconds(
            latest_last_attempted["timestamp"] if latest_last_attempted is not None else None
        ),
        "last_attempted_state": latest_last_attempted["state"] if latest_last_attempted is not None else None,
        "max_attempt_count": max_attempt_count,
        "quarantine_source_state_counts": quarantine_metadata["source_state_counts"],
    }


def build_spool_status_fallback(state_dir: Path) -> dict[str, int | str | dict[str, int]]:
    state_dir_exists = state_dir.exists()
    state_dir_kind = _resolve_state_dir_kind(state_dir)

    return {
        "state_dir": str(state_dir),
        "state_dir_exists": state_dir_exists,
        "backlog_mode": "missing_state_dir" if state_dir_kind != "directory" else "unavailable",
        "state_dir_kind": state_dir_kind,
        "terminal_finalizer_markers": 0,
        "last_successful_flush_at": None,
        "last_successful_flush_age_seconds": None,
        "ready": 0,
        "processing": 0,
        "quarantine": 0,
        "ready_bytes": 0,
        "processing_bytes": 0,
        "quarantine_bytes": 0,
        "orphan_sidecars": {"ready": 0, "processing": 0, "quarantine": 0, "total": 0},
        "quarantine_reason_counts": {},
        "quarantine_meta_error_counts": {"read_error": 0, "parse_error": 0},
        "metadata_error_counts_by_state": {
            "ready": {"read_error": 0, "parse_error": 0},
            "processing": {"read_error": 0, "parse_error": 0},
            "quarantine": {"read_error": 0, "parse_error": 0},
        },
        "oldest_backlog_age_seconds": 0,
        "oldest_ready_age_seconds": 0,
        "oldest_processing_age_seconds": 0,
        "oldest_quarantine_age_seconds": 0,
        "oldest_first_seen_age_seconds": 0,
        "last_attempted_age_seconds": 0,
        "last_attempted_state": None,
        "max_attempt_count": 0,
        "quarantine_source_state_counts": {},
    }


def _resolve_backlog_mode(
    *,
    state_dir_exists: bool,
    ready_count: int,
    processing_count: int,
    quarantine_count: int,
) -> str:
    if not state_dir_exists:
        return "missing_state_dir"

    pending_count = ready_count + processing_count
    if pending_count == 0 and quarantine_count == 0:
        return "empty"

    if ready_count == 0 and processing_count > 0 and quarantine_count == 0:
        return "processing_only"

    if pending_count == 0 and quarantine_count > 0:
        return "quarantine_only"

    if pending_count > 0 and quarantine_count > 0:
        return "mixed"

    return "pending"


def _count_json_files(directory: Path) -> int:
    if not directory.exists() or not directory.is_dir():
        return 0

    try:
        return sum(1 for path in directory.iterdir() if path.is_file() and path.name.endswith(".json"))
    except OSError:
        return 0


def _resolve_state_dir_kind(state_dir: Path) -> str:
    if state_dir.is_dir():
        return "directory"
    if state_dir.exists():
        return "file"
    return "missing"


def _collect_directory_stats(
    directory: Path,
    excluded_suffixes: tuple[str, ...] = (),
) -> dict[str, int | float | None]:
    if not directory.exists():
        return {"count": 0, "bytes": 0, "oldest_mtime": None}

    count = 0
    total_bytes = 0
    oldest_mtime: float | None = None

    for path in directory.iterdir():
        if (
            not path.is_file()
            or not path.name.endswith(".json")
            or path.name.endswith(excluded_suffixes)
        ):
            continue

        stat = path.stat()
        count += 1
        total_bytes += stat.st_size
        oldest_mtime = stat.st_mtime if oldest_mtime is None else min(oldest_mtime, stat.st_mtime)

    return {
        "count": count,
        "bytes": total_bytes,
        "oldest_mtime": oldest_mtime,
    }


def _age_seconds(oldest_mtime: float | None) -> int:
    if oldest_mtime is None:
        return 0

    return max(int(time() - oldest_mtime), 0)


def _nullable_age_seconds(timestamp: float | None) -> int | None:
    if timestamp is None:
        return None

    return max(int(time() - timestamp), 0)


def _read_last_successful_flush(marker_path: Path) -> dict[str, object]:
    try:
        payload = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {"last_successful_flush_at": None, "timestamp": None}

    value = payload.get("last_successful_flush_at") if isinstance(payload, dict) else None
    timestamp = _parse_metadata_timestamp(value)
    if timestamp is None:
        return {"last_successful_flush_at": None, "timestamp": None}

    return {"last_successful_flush_at": value, "timestamp": timestamp}


def _count_orphan_metadata_sidecars(directory: Path) -> int:
    if not directory.exists():
        return 0

    orphan_count = 0
    for path in directory.iterdir():
        if not path.is_file() or not path.name.endswith(".meta.json"):
            continue

        payload_path = path.with_name(path.name.removesuffix(".meta.json") + ".json")
        if not payload_path.exists():
            orphan_count += 1

    return orphan_count


def _collect_metadata_rollups(
    directory: Path,
    *,
    collect_reason_counts: bool = False,
    collect_source_state_counts: bool = False,
) -> dict[str, object]:
    if not directory.exists():
        return {
            "oldest_first_seen_timestamp": None,
            "latest_last_attempted_timestamp": None,
            "max_attempt_count": 0,
            "reason_counts": {},
            "source_state_counts": {},
            "meta_error_counts": {"read_error": 0, "parse_error": 0},
        }

    reason_counts: dict[str, int] = {}
    source_state_counts: dict[str, int] = {}
    meta_error_counts = {"read_error": 0, "parse_error": 0}
    oldest_first_seen_timestamp: float | None = None
    latest_last_attempted_timestamp: float | None = None
    max_attempt_count = 0
    for path in directory.iterdir():
        if not path.is_file() or not path.name.endswith(".meta.json"):
            continue

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            meta_error_counts["read_error"] += 1
            continue
        except json.JSONDecodeError:
            meta_error_counts["parse_error"] += 1
            continue

        first_seen_timestamp = _parse_metadata_timestamp(payload.get("first_seen_at"))
        if first_seen_timestamp is not None:
            oldest_first_seen_timestamp = (
                first_seen_timestamp
                if oldest_first_seen_timestamp is None
                else min(oldest_first_seen_timestamp, first_seen_timestamp)
            )
        last_attempted_timestamp = _parse_metadata_timestamp(payload.get("last_attempted_at"))
        if last_attempted_timestamp is not None:
            latest_last_attempted_timestamp = (
                last_attempted_timestamp
                if latest_last_attempted_timestamp is None
                else max(latest_last_attempted_timestamp, last_attempted_timestamp)
            )

        attempt_count = payload.get("attempt_count")
        if isinstance(attempt_count, int) and not isinstance(attempt_count, bool) and attempt_count >= 0:
            max_attempt_count = max(max_attempt_count, attempt_count)

        if collect_reason_counts:
            reason = payload.get("reason")
            if isinstance(reason, str) and reason:
                reason_counts[reason] = reason_counts.get(reason, 0) + 1

        if collect_source_state_counts:
            source_state = payload.get("source_state")
            if isinstance(source_state, str) and source_state:
                source_state_counts[source_state] = source_state_counts.get(source_state, 0) + 1

    return {
        "oldest_first_seen_timestamp": oldest_first_seen_timestamp,
        "latest_last_attempted_timestamp": latest_last_attempted_timestamp,
        "max_attempt_count": max_attempt_count,
        "reason_counts": reason_counts,
        "source_state_counts": source_state_counts,
        "meta_error_counts": meta_error_counts,
    }


def _parse_metadata_timestamp(value: object) -> float | None:
    if not isinstance(value, str) or not value:
        return None

    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        return datetime.fromisoformat(normalized).timestamp()
    except (ValueError, OverflowError, OSError):
        return None


def _build_last_attempted_candidate(
    state: str,
    timestamp: object,
) -> dict[str, float | str] | None:
    if not isinstance(timestamp, (int, float)):
        return None

    return {"state": state, "timestamp": float(timestamp)}
