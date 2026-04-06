import os
from pathlib import Path


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

    return {
        "state_dir": str(state_dir),
        "ready": _count_files(spool_dir / "ready"),
        "processing": _count_files(spool_dir / "processing"),
        "quarantine": _count_files(
            spool_dir / "quarantine",
            excluded_suffixes=(".meta.json",),
        ),
    }


def _count_files(
    directory: Path,
    excluded_suffixes: tuple[str, ...] = (),
) -> int:
    if not directory.exists():
        return 0

    return sum(
        1
        for path in directory.iterdir()
        if path.is_file() and not path.name.endswith(excluded_suffixes)
    )
