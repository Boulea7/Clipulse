import os
from pathlib import Path
from time import time


def resolve_state_dir() -> Path:
    explicit = os.environ.get("CLIPULSE_STATE_DIR")
    if explicit:
        return Path(explicit)

    xdg_state_home = os.environ.get("XDG_STATE_HOME")
    if xdg_state_home:
        return Path(xdg_state_home) / "clipulse"

    return Path.home() / ".local" / "state" / "clipulse"


def collect_spool_status(state_dir: Path) -> dict[str, int | str]:
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
    oldest_backlog_mtime = min(
        [mtime for mtime in (ready["oldest_mtime"], processing["oldest_mtime"]) if mtime is not None],
        default=None,
    )

    return {
        "state_dir": str(state_dir),
        "ready": ready["count"],
        "processing": processing["count"],
        "quarantine": quarantine["count"],
        "ready_bytes": ready["bytes"],
        "processing_bytes": processing["bytes"],
        "quarantine_bytes": quarantine["bytes"],
        "oldest_backlog_age_seconds": _age_seconds(oldest_backlog_mtime),
        "oldest_quarantine_age_seconds": _age_seconds(quarantine["oldest_mtime"]),
    }


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
        if not path.is_file() or path.name.endswith(excluded_suffixes):
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
