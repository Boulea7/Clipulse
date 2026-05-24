import argparse
import json
import os
import sys
from typing import Sequence

from .database import create_session_factory, get_session
from .source_status import build_source_status
from .usage_reports import ReportFilters, build_today_filters, build_usage_report


REPORT_KINDS = {"daily", "weekly", "monthly", "session", "blocks"}


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.command in {"source", "sources"}:
        payload = build_source_status()
        if args.json:
            print(json.dumps(payload, sort_keys=True))
        else:
            print(render_source_status_table(payload, compact=args.compact))
        return 0

    if args.command != "usage":
        parser.error("only the usage and sources command groups are available in this build")

    database_url = args.database_url or os.environ.get(
        "CLIPULSE_DATABASE_URL",
        "sqlite+pysqlite:///clipulse.sqlite3",
    )
    session_factory = create_session_factory(database_url)
    session = next(get_session(session_factory))
    try:
        if args.report == "statusline":
            report = build_usage_report(session, "daily", build_today_filters(args.timezone))
            print(render_statusline(report))
            return 0

        report = build_usage_report(
            session,
            args.report,
            ReportFilters(
                since=args.since,
                until=args.until,
                project=args.project,
                source=args.source,
                timezone=args.timezone,
                breakdown=args.breakdown,
            ),
        )
        if args.json:
            print(json.dumps(report, sort_keys=True))
        else:
            print(render_report_table(report, compact=args.compact))
        return 0
    finally:
        session.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="clipulse")
    parser.add_argument("--database-url", default=None)
    subparsers = parser.add_subparsers(dest="command", required=True)
    usage = subparsers.add_parser("usage")
    usage_subparsers = usage.add_subparsers(dest="report", required=True)

    for command_name in ("source", "sources"):
        sources = subparsers.add_parser(command_name)
        sources_subparsers = sources.add_subparsers(dest="sources_command", required=True)
        status = sources_subparsers.add_parser("status")
        status.add_argument("--json", action="store_true")
        status.add_argument("--compact", action="store_true")

    for report in sorted(REPORT_KINDS | {"statusline"}):
        report_parser = usage_subparsers.add_parser(report)
        report_parser.add_argument("--json", action="store_true")
        report_parser.add_argument("--compact", action="store_true")
        report_parser.add_argument("--since", default=None)
        report_parser.add_argument("--until", default=None)
        report_parser.add_argument("--project", default=None)
        report_parser.add_argument("--source", default=None)
        report_parser.add_argument("--timezone", default="UTC")
        report_parser.add_argument("--breakdown", action="store_true")

    return parser


def render_report_table(report: dict[str, object], *, compact: bool) -> str:
    rows = report.get("rows") if isinstance(report.get("rows"), list) else []
    totals = report["totals"] if isinstance(report.get("totals"), dict) else {}
    title = f"Clipulse usage {report.get('range', {}).get('type', 'report')}"
    lines = [
        title,
        (
            f"total: {format_tokens(int(totals.get('totalTokens', 0)))} tok | "
            f"${float(totals.get('costUSD', 0)):.2f} | "
            f"{format_minutes(int(totals.get('activeSeconds', 0)))} active"
        ),
    ]
    if compact:
        return "\n".join(lines) + "\n"

    lines.append("period | tokens | cost | active | sessions")
    for row in rows:
        if not isinstance(row, dict):
            continue
        label = (
            row.get("date")
            or row.get("weekStart")
            or row.get("month")
            or row.get("sessionId")
            or row.get("blockStart")
            or "unknown"
        )
        lines.append(
            f"{label} | {format_tokens(int(row.get('totalTokens', 0)))} | "
            f"${float(row.get('costUSD', 0)):.2f} | "
            f"{format_minutes(int(row.get('activeSeconds', 0)))} | "
            f"{int(row.get('sessions', 0))}"
        )
    return "\n".join(lines) + "\n"


def render_source_status_table(payload: dict[str, object], *, compact: bool) -> str:
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    lines = [
        "Clipulse sources status",
        (
            f"detected: {int(summary.get('detected', 0))}/"
            f"{int(summary.get('sources', 0))} | "
            f"readable: {int(summary.get('readable', 0))} | "
            f"records: {int(summary.get('recordCount', 0))}"
        ),
    ]
    if compact:
        return "\n".join(lines) + "\n"

    lines.append("source | state | records | path")
    for source in sources:
        if not isinstance(source, dict):
            continue
        state = "missing"
        if source.get("exists") and source.get("readable"):
            state = "ready"
        elif source.get("exists"):
            state = str(source.get("error") or "unreadable")
        suffix = "+" if source.get("capped") else ""
        lines.append(
            f"{source.get('label', source.get('id', 'unknown'))} | "
            f"{state} | {int(source.get('recordCount', 0))}{suffix} | "
            f"{source.get('pathLabel', '<redacted>')}"
        )
    return "\n".join(lines) + "\n"


def render_statusline(report: dict[str, object]) -> str:
    totals = report["totals"] if isinstance(report.get("totals"), dict) else {}
    return (
        "Clipulse · "
        f"{format_tokens(int(totals.get('totalTokens', 0)))} tok · "
        f"${float(totals.get('costUSD', 0)):.2f} · "
        f"{format_minutes(int(totals.get('activeSeconds', 0)))} today"
    )


def format_tokens(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}m"
    if value >= 1_000:
        return f"{value / 1_000:.1f}k"
    return str(value)


def format_minutes(active_seconds: int) -> str:
    minutes = max(active_seconds // 60, 0)
    if minutes >= 60:
        hours, remaining_minutes = divmod(minutes, 60)
        return f"{hours}h {remaining_minutes}m"
    return f"{minutes}m"


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
