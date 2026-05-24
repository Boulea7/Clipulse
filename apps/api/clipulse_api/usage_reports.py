from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from .database import EventRecord
from .lookups import compute_project_ref, load_reporting_records
from .privacy_labels import normalize_safe_public_label
from .reporting import parse_utc_datetime

ReportKind = Literal["daily", "weekly", "monthly", "session", "blocks"]


@dataclass(frozen=True)
class ReportFilters:
    since: str | None = None
    until: str | None = None
    project: str | None = None
    source: str | None = None
    timezone: str = "UTC"
    breakdown: bool = False


TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_tokens",
    "cache_read_tokens",
    "reasoning_tokens",
    "total_tokens",
)


def build_usage_report(
    session: Session,
    kind: ReportKind,
    filters: ReportFilters | None = None,
) -> dict[str, object]:
    resolved_filters = filters or ReportFilters()
    report_timezone = resolve_report_timezone(resolved_filters.timezone)
    records = filter_records(load_reporting_records(session), resolved_filters, report_timezone)
    rows = build_report_rows(records, kind, report_timezone)

    return {
        "range": {
            "type": kind,
            "since": resolved_filters.since,
            "until": resolved_filters.until,
            "timezone": resolved_filters.timezone,
            "breakdown": resolved_filters.breakdown,
        },
        "totals": build_usage_totals(records),
        "rows": rows,
    }


def filter_records(
    records: list[EventRecord],
    filters: ReportFilters,
    report_timezone: tzinfo | None = None,
) -> list[EventRecord]:
    resolved_timezone = report_timezone or resolve_report_timezone(filters.timezone)
    since_dt = parse_boundary(filters.since, end_of_day=False, report_timezone=resolved_timezone)
    until_dt = parse_boundary(filters.until, end_of_day=True, report_timezone=resolved_timezone)
    project_ref = compute_project_ref(filters.project) if filters.project else None
    source = normalize_safe_public_label(filters.source)
    if source is not None:
        source = source.casefold()

    filtered = []
    for record in records:
        event_dt = parse_utc_datetime(str(record.event_time))
        if since_dt is not None and event_dt < since_dt:
            continue
        if until_dt is not None and event_dt > until_dt:
            continue
        if project_ref is not None and record.project_root != project_ref:
            continue
        record_source = normalize_safe_public_label(record.source) or normalize_safe_public_label(record.host)
        if source is not None and (record_source or "").casefold() != source:
            continue
        filtered.append(record)

    return filtered


def resolve_report_timezone(timezone: str | None) -> tzinfo:
    timezone_name = (timezone or "UTC").strip() or "UTC"
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return UTC


def build_today_filters(timezone: str | None = "UTC") -> ReportFilters:
    report_timezone = resolve_report_timezone(timezone)
    today = datetime.now(UTC).astimezone(report_timezone).date().isoformat()
    return ReportFilters(since=today, until=today, timezone=timezone or "UTC")


def parse_boundary(
    value: str | None,
    *,
    end_of_day: bool,
    report_timezone: tzinfo,
) -> datetime | None:
    if not value:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) == 10:
        parsed = datetime.fromisoformat(normalized).replace(tzinfo=report_timezone)
        if end_of_day:
            parsed = parsed + timedelta(days=1) - timedelta(microseconds=1)
        return parsed.astimezone(UTC)
    parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=report_timezone)
    return parsed.astimezone(UTC)


def build_report_rows(
    records: list[EventRecord],
    kind: ReportKind,
    report_timezone: tzinfo | None = None,
) -> list[dict[str, object]]:
    resolved_timezone = report_timezone or UTC
    grouped: dict[str, list[EventRecord]] = {}
    for record in records:
        key = get_report_key(record, kind, resolved_timezone)
        grouped.setdefault(key, []).append(record)

    return [
        {
            **build_row_identity(key, kind),
            **build_usage_totals(grouped_records),
            "events": len(grouped_records),
            "sessions": len({record.session_id for record in grouped_records}),
            "projects": len({record.project_root for record in grouped_records}),
            "sources": sorted(
                {
                    source
                    for record in grouped_records
                    if (source := normalize_safe_public_label(record.source) or normalize_safe_public_label(record.host))
                }
            ),
            "models": sorted(
                {
                    model
                    for record in grouped_records
                    if (model := normalize_safe_public_label(record.model_name))
                }
            ),
        }
        for key, grouped_records in sorted(grouped.items(), key=lambda item: item[0])
    ]


def get_report_key(record: EventRecord, kind: ReportKind, report_timezone: tzinfo) -> str:
    event_dt = parse_utc_datetime(str(record.event_time)).astimezone(report_timezone)
    if kind == "daily":
        return event_dt.date().isoformat()
    if kind == "weekly":
        week_start = event_dt.date() - timedelta(days=event_dt.weekday())
        return week_start.isoformat()
    if kind == "monthly":
        return event_dt.strftime("%Y-%m")
    if kind == "session":
        return f"{record.project_root}:{record.session_id}"
    if kind == "blocks":
        block_start_hour = (event_dt.hour // 5) * 5
        block_start = event_dt.replace(hour=block_start_hour, minute=0, second=0, microsecond=0)
        return block_start.isoformat().replace("+00:00", "Z")
    raise ValueError(f"unsupported report kind: {kind}")


def build_row_identity(key: str, kind: ReportKind) -> dict[str, object]:
    if kind == "daily":
        return {"date": key}
    if kind == "weekly":
        return {"weekStart": key}
    if kind == "monthly":
        return {"month": key}
    if kind == "session":
        project_ref, session_id = key.split(":", 1)
        return {"projectRef": project_ref, "sessionId": session_id}
    if kind == "blocks":
        reset_at = parse_utc_datetime(key) + timedelta(hours=5)
        return {
            "blockStart": key,
            "resetAt": reset_at.isoformat().replace("+00:00", "Z"),
            "limit": None,
            "usagePercent": None,
        }
    raise ValueError(f"unsupported report kind: {kind}")


def build_usage_totals(records: list[EventRecord]) -> dict[str, int | float]:
    input_tokens = sum_optional_int(records, "input_tokens")
    output_tokens = sum_optional_int(records, "output_tokens")
    cache_creation_tokens = sum_optional_int(records, "cache_creation_tokens")
    cache_read_tokens = sum_optional_int(records, "cache_read_tokens")
    reasoning_tokens = sum_optional_int(records, "reasoning_tokens")
    total_tokens = sum(record_total_tokens(record) for record in records)

    return {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "cacheCreationTokens": cache_creation_tokens,
        "cacheReadTokens": cache_read_tokens,
        "reasoningTokens": reasoning_tokens,
        "totalTokens": total_tokens,
        "costUSD": round(sum(float(record.cost_usd or 0) for record in records), 6),
        "activeSeconds": sum(int(record.active_ms or 0) for record in records) // 1000,
        "waitSeconds": sum(int(record.wait_ms or 0) for record in records) // 1000,
        "sessions": len({record.session_id for record in records}),
    }


def sum_optional_int(records: list[EventRecord], field_name: str) -> int:
    return sum(int(getattr(record, field_name) or 0) for record in records)


def record_total_tokens(record: EventRecord) -> int:
    if record.total_tokens is not None:
        return int(record.total_tokens)
    return (
        int(record.input_tokens or 0)
        + int(record.output_tokens or 0)
        + int(record.cache_creation_tokens or 0)
        + int(record.cache_read_tokens or 0)
        + int(record.reasoning_tokens or 0)
    )
