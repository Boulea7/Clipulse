import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


COUNT_LIMIT = 10_000


@dataclass(frozen=True)
class SourceCandidate:
    source_id: str
    label: str
    env_var: str | None
    default_parts: tuple[str, ...]
    suffixes: tuple[str, ...]


SOURCE_CANDIDATES = (
    SourceCandidate(
        source_id="claude",
        label="Claude Code",
        env_var="CLIPULSE_CLAUDE_LOG_DIR",
        default_parts=(".claude", "projects"),
        suffixes=(".jsonl", ".json"),
    ),
    SourceCandidate(
        source_id="codex",
        label="Codex",
        env_var="CLIPULSE_CODEX_LOG_DIR",
        default_parts=(".codex", "sessions"),
        suffixes=(".jsonl", ".json"),
    ),
    SourceCandidate(
        source_id="gemini",
        label="Gemini CLI",
        env_var="CLIPULSE_GEMINI_LOG_DIR",
        default_parts=(".gemini", "tmp"),
        suffixes=(".jsonl", ".json"),
    ),
    SourceCandidate(
        source_id="opencode",
        label="OpenCode",
        env_var="CLIPULSE_OPENCODE_LOG_DIR",
        default_parts=(".local", "share", "opencode"),
        suffixes=(".jsonl", ".json", ".db", ".sqlite", ".sqlite3"),
    ),
)


def build_source_status(*, home: Path | None = None, environ: dict[str, str] | None = None) -> dict[str, object]:
    safe_home = home or Path.home()
    safe_environ = dict(os.environ if environ is None else environ)
    sources = [
        _build_candidate_status(candidate, home=safe_home, environ=safe_environ)
        for candidate in SOURCE_CANDIDATES
    ]
    detected = sum(1 for source in sources if source["exists"])
    readable = sum(1 for source in sources if source["readable"])
    records = sum(int(source["recordCount"]) for source in sources)

    return {
        "version": 1,
        "summary": {
            "sources": len(sources),
            "detected": detected,
            "readable": readable,
            "recordCount": records,
        },
        "sources": sources,
    }


def _build_candidate_status(
    candidate: SourceCandidate,
    *,
    home: Path,
    environ: dict[str, str],
) -> dict[str, object]:
    raw_override = environ.get(candidate.env_var or "") if candidate.env_var else None
    path = Path(raw_override).expanduser() if raw_override else home.joinpath(*candidate.default_parts)
    exists = path.exists()
    is_directory = path.is_dir()
    readable = False
    record_count = 0
    capped = False
    error = None

    if exists and is_directory:
        try:
            record_count, capped = _count_matching_files(path, candidate.suffixes)
            readable = True
        except OSError:
            error = "read_error"
    elif exists:
        error = "not_directory"

    return {
        "id": candidate.source_id,
        "label": candidate.label,
        "pathLabel": _format_path_label(path, home=home, default_path=home.joinpath(*candidate.default_parts)),
        "configuredBy": candidate.env_var if raw_override else "default",
        "exists": exists,
        "readable": readable,
        "recordCount": record_count,
        "capped": capped,
        "error": error,
    }


def _count_matching_files(root: Path, suffixes: Iterable[str]) -> tuple[int, bool]:
    normalized_suffixes = tuple(suffix.lower() for suffix in suffixes)
    count = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if normalized_suffixes and path.suffix.lower() not in normalized_suffixes:
            continue
        count += 1
        if count >= COUNT_LIMIT:
            return count, True
    return count, False


def _format_path_label(path: Path, *, home: Path, default_path: Path) -> str:
    if path == default_path:
        return "~/" + "/".join(path.relative_to(home).parts)

    return "<custom path redacted>"
