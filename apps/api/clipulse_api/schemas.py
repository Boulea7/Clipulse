import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


EventBatchResultStatus = Literal["accepted", "duplicate", "invalid"]
ServiceStatus = Literal["ok"]
HealthStatus = Literal["ok", "degraded"]
DashboardCompatTier = Literal["minimum"]
DashboardCompatSurface = Literal["dashboard-summary", "dashboard-detail"]
DashboardCompatArtifactStatus = Literal["ok", "missing", "malformed"]
CompatArtifactErrorCode = Literal["read_error", "parse_error"]
AuthClientRefSource = Literal["peer", "x_forwarded_for"]
SpoolBacklogMode = Literal[
    "missing_state_dir",
    "empty",
    "pending",
    "processing_only",
    "quarantine_only",
    "mixed",
]
SpoolStateDirKind = Literal["directory", "file", "missing"]
FILE_DELTA_FINGERPRINT_PATTERN = re.compile(
    r"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64}|[0-9a-fA-F]{128})$"
)


class LanguageStatPayload(BaseModel):
    added: int = 0
    removed: int = 0
    changed: int = 0


class FileDeltaPayload(BaseModel):
    fingerprint: str
    language: str
    added: int = 0
    removed: int = 0

    @field_validator("fingerprint")
    @classmethod
    def validate_fingerprint(cls, value: str) -> str:
        stripped_value = value.strip()
        if not FILE_DELTA_FINGERPRINT_PATTERN.fullmatch(stripped_value):
            raise ValueError("fingerprint must be a fixed-length hex hash")
        return stripped_value


class EventPayload(BaseModel):
    event_id: str | None = None
    host: str
    host_version: str
    session_id: str
    project_root: str
    project_name: str
    git_branch: str
    event_name: str
    event_time: str
    model_name: str
    os_name: str
    editor_or_terminal: str
    active_ms: int = 0
    wait_ms: int = 0
    privacy_mode: str
    language_stats: dict[str, LanguageStatPayload] = Field(default_factory=dict)
    file_deltas: list[FileDeltaPayload] = Field(default_factory=list)


class EventBatchPayload(BaseModel):
    events: list[dict[str, Any]]


class EventBatchResultResponse(BaseModel):
    event_id: str
    status: EventBatchResultStatus = Field(
        description="Per-event ingest outcome. Current values are `accepted`, `duplicate`, or `invalid`."
    )
    retryable: bool = Field(
        description="Whether retrying the same event payload as-is may succeed."
    )
    reason_code: str | None = Field(
        default=None,
        description="Optional machine-readable detail that refines `status` for callers that want finer retry or troubleshooting behavior."
    )
    details: dict[str, Any] | None = Field(
        default=None,
        description="Optional structured details associated with `reason_code`."
    )


class EventBatchResponse(BaseModel):
    accepted: int
    duplicates: int
    invalid: int
    results: list[EventBatchResultResponse]


class ApiErrorDetail(BaseModel):
    code: str
    message: str
    hint: str
    details: dict[str, Any] | None = None


class ApiErrorResponse(BaseModel):
    detail: ApiErrorDetail


class TopLanguageResponse(BaseModel):
    name: str
    changed: int


class HostModelMixResponse(BaseModel):
    host: str
    model_name: str
    events: int
    active_ms: int
    wait_ms: int


class LastRuntimeResponse(BaseModel):
    host: str
    host_version: str
    model_name: str
    git_branch: str
    os_name: str
    editor_or_terminal: str
    privacy_mode: str


class FilePreviewResponse(BaseModel):
    fingerprint: str
    language: str
    added: int
    removed: int


class LanguageTotalsResponse(BaseModel):
    name: str
    added: int
    removed: int
    changed: int


class ProjectListItemResponse(BaseModel):
    project_name: str
    project_ref: str
    event_count: int = Field(
        description="Canonical total number of ingested events rolled into this project summary. The backward-compatible `events` alias exposes the same value."
    )
    events: int = Field(
        description="Backward-compatible alias of `event_count`; returns the same total number of ingested events for older clients."
    )
    active_ms: int
    wait_ms: int
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix_count: int = Field(
        description="Count of distinct host/model aggregates in the full rollup, even when only the primary aggregate is returned here."
    )
    host_model_primary: HostModelMixResponse | None = Field(
        default=None,
        description="Primary host/model aggregate for this project, selected by rollup activity rather than the latest event.",
    )
    last_event_time: str = Field(
        description="Timestamp from the latest event rolled into this project summary."
    )
    last_event_name: str = Field(
        description="Event name captured from the latest event in this project summary."
    )
    last_host: str = Field(description="Host captured from the latest event in this project summary.")
    last_host_version: str = Field(
        description="Host version captured from the latest event in this project summary."
    )
    last_model_name: str = Field(
        description="Model captured from the latest event in this project summary."
    )
    last_git_branch: str = Field(
        description="Git branch captured from the latest event in this project summary."
    )
    last_os_name: str = Field(
        description="Operating system captured from the latest event in this project summary."
    )
    last_editor_or_terminal: str = Field(
        description="Editor or terminal surface captured from the latest event in this project summary."
    )
    last_privacy_mode: str = Field(
        description="Privacy mode captured from the latest event in this project summary."
    )
    last_runtime: LastRuntimeResponse = Field(
        description="Additive structured view of the latest runtime metadata in this project summary; the flat `last_*` fields remain for compatibility."
    )

    @model_validator(mode="before")
    @classmethod
    def populate_event_count_alias(cls, value: Any) -> Any:
        return populate_event_count_alias(value)


class SessionListItemResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str = Field(
        description="Backward-compatible alias of `last_host`; mirrors the latest event host for this session summary."
    )
    last_host: str = Field(description="Host captured from the latest event in this session.")
    last_host_version: str = Field(
        description="Host version captured from the latest event in this session."
    )
    model_name: str = Field(
        description="Backward-compatible alias of `last_model_name`; mirrors the latest event model for this session summary."
    )
    last_model_name: str = Field(description="Model captured from the latest event in this session.")
    git_branch: str = Field(
        description="Backward-compatible alias of `last_git_branch`; mirrors the latest event branch for this session summary."
    )
    last_git_branch: str = Field(
        description="Git branch captured from the latest event in this session."
    )
    last_os_name: str = Field(
        description="Operating system captured from the latest event in this session."
    )
    last_editor_or_terminal: str = Field(
        description="Editor or terminal surface captured from the latest event in this session."
    )
    last_privacy_mode: str = Field(
        description="Privacy mode captured from the latest event in this session."
    )
    last_runtime: LastRuntimeResponse = Field(
        description="Additive structured view of the latest runtime metadata in this session summary; the flat `last_*` fields remain for compatibility."
    )
    first_event_time: str
    last_event_time: str
    last_event_name: str = Field(description="Event name captured from the latest event in this session summary.")
    event_count: int = Field(
        description="Canonical total number of ingested events rolled into this session summary. The backward-compatible `events` alias exposes the same value."
    )
    events: int = Field(
        description="Backward-compatible alias of `event_count`; returns the same total number of ingested events for older clients."
    )
    active_ms: int
    wait_ms: int
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix: list[HostModelMixResponse] = Field(
        default_factory=list,
        description="Full host/model rollup for this session summary, ordered by rollup activity so the first item matches `host_model_primary` when present.",
    )
    host_model_mix_count: int = Field(
        description="Count of distinct host/model aggregates in the full session rollup. Compact list mode keeps this count even when `host_model_mix` is omitted."
    )
    host_model_primary: HostModelMixResponse | None = Field(
        default=None,
        description="Primary host/model aggregate for this session summary, selected by rollup activity rather than the latest event.",
    )

    @model_validator(mode="before")
    @classmethod
    def populate_event_count_alias(cls, value: Any) -> Any:
        return populate_event_count_alias(value)


class CompactSessionListItemResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str = Field(
        description="Backward-compatible alias of `last_host`; mirrors the latest event host for this session summary."
    )
    last_host: str = Field(description="Host captured from the latest event in this session.")
    last_host_version: str = Field(
        description="Host version captured from the latest event in this session."
    )
    model_name: str = Field(
        description="Backward-compatible alias of `last_model_name`; mirrors the latest event model for this session summary."
    )
    last_model_name: str = Field(description="Model captured from the latest event in this session.")
    git_branch: str = Field(
        description="Backward-compatible alias of `last_git_branch`; mirrors the latest event branch for this session summary."
    )
    last_git_branch: str = Field(
        description="Git branch captured from the latest event in this session."
    )
    last_os_name: str = Field(
        description="Operating system captured from the latest event in this session."
    )
    last_editor_or_terminal: str = Field(
        description="Editor or terminal surface captured from the latest event in this session."
    )
    last_privacy_mode: str = Field(
        description="Privacy mode captured from the latest event in this session."
    )
    last_runtime: LastRuntimeResponse = Field(
        description="Additive structured view of the latest runtime metadata in this compact session summary; the flat `last_*` fields remain for compatibility."
    )
    first_event_time: str
    last_event_time: str
    last_event_name: str = Field(description="Event name captured from the latest event in this session summary.")
    event_count: int = Field(
        description="Canonical total number of ingested events rolled into this session summary. The backward-compatible `events` alias exposes the same value."
    )
    events: int = Field(
        description="Backward-compatible alias of `event_count`; returns the same total number of ingested events for older clients."
    )
    active_ms: int
    wait_ms: int
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix_count: int = Field(
        description="Count of distinct host/model aggregates in the full session rollup, including aggregates omitted from compact list mode."
    )
    host_model_primary: HostModelMixResponse | None = Field(
        default=None,
        description="Primary host/model aggregate for this session summary, selected by rollup activity rather than the latest event.",
    )

    @model_validator(mode="before")
    @classmethod
    def populate_event_count_alias(cls, value: Any) -> Any:
        return populate_event_count_alias(value)


class SessionDetailResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str = Field(
        description="Backward-compatible alias of `last_host`; mirrors the latest event host for this session detail."
    )
    last_host: str = Field(description="Host captured from the latest event in this session.")
    last_host_version: str = Field(
        description="Host version captured from the latest event in this session."
    )
    model_name: str = Field(
        description="Backward-compatible alias of `last_model_name`; mirrors the latest event model for this session detail."
    )
    last_model_name: str = Field(description="Model captured from the latest event in this session.")
    git_branch: str = Field(
        description="Backward-compatible alias of `last_git_branch`; mirrors the latest event branch for this session detail."
    )
    last_git_branch: str = Field(
        description="Git branch captured from the latest event in this session."
    )
    last_os_name: str = Field(
        description="Operating system captured from the latest event in this session."
    )
    last_editor_or_terminal: str = Field(
        description="Editor or terminal surface captured from the latest event in this session."
    )
    last_privacy_mode: str = Field(
        description="Privacy mode captured from the latest event in this session."
    )
    last_runtime: LastRuntimeResponse = Field(
        description="Additive structured view of the latest runtime metadata in this session detail; the flat `last_*` fields remain for compatibility."
    )
    first_event_time: str
    last_event_time: str
    last_event_name: str = Field(description="Event name captured from the latest event in this session.")
    event_count: int = Field(
        description="Canonical total number of ingested events rolled into this session detail. The backward-compatible `events` alias exposes the same value."
    )
    events: int = Field(
        description="Backward-compatible alias of `event_count`; returns the same total number of ingested events for older clients."
    )
    active_ms: int
    wait_ms: int
    languages: list[LanguageTotalsResponse] = Field(default_factory=list)
    file_deltas: list[FilePreviewResponse] = Field(default_factory=list)
    file_preview: list[FilePreviewResponse] = Field(default_factory=list)
    file_preview_truncated_count: int = Field(
        default=0,
        description="Count of additional changed files that are not included in `file_preview` because the preview list is intentionally capped.",
    )
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    host_model_mix: list[HostModelMixResponse] = Field(
        default_factory=list,
        description="Full host/model rollup for this session detail, ordered by rollup activity so the first item matches the primary aggregate exposed as `host_model_primary` when present.",
    )
    host_model_mix_count: int = Field(
        description="Count of distinct host/model aggregates in the full rollup for this session detail, including aggregates beyond the primary one.",
    )
    host_model_primary: HostModelMixResponse | None = Field(
        default=None,
        description="Primary host/model aggregate for this session detail, selected by rollup activity rather than the latest event.",
    )
    top_language: TopLanguageResponse | None = None

    @model_validator(mode="before")
    @classmethod
    def populate_event_count_alias(cls, value: Any) -> Any:
        return populate_event_count_alias(value)


class ProjectDetailResponse(BaseModel):
    project_name: str
    project_ref: str
    active_ms: int
    wait_ms: int
    event_count: int = Field(
        description="Canonical total number of ingested events rolled into this project detail. The backward-compatible `events` alias exposes the same value."
    )
    events: int = Field(
        description="Backward-compatible alias of `event_count`; returns the same total number of ingested events for older clients."
    )
    session_count: int
    last_event_time: str | None = None
    last_event_name: str | None = Field(
        default=None,
        description="Event name captured from the latest event in this project.",
    )
    last_host: str | None = Field(
        default=None,
        description="Host captured from the latest event in this project.",
    )
    last_host_version: str | None = Field(
        default=None,
        description="Host version captured from the latest event in this project.",
    )
    last_model_name: str | None = Field(
        default=None,
        description="Model captured from the latest event in this project.",
    )
    last_git_branch: str | None = Field(
        default=None,
        description="Git branch captured from the latest event in this project.",
    )
    last_os_name: str | None = Field(
        default=None,
        description="Operating system captured from the latest event in this project.",
    )
    last_editor_or_terminal: str | None = Field(
        default=None,
        description="Editor or terminal surface captured from the latest event in this project.",
    )
    last_privacy_mode: str | None = Field(
        default=None,
        description="Privacy mode captured from the latest event in this project.",
    )
    last_runtime: LastRuntimeResponse | None = Field(
        default=None,
        description="Additive structured view of the latest runtime metadata in this project detail; the flat `last_*` fields remain for compatibility.",
    )
    languages: list[LanguageTotalsResponse] = Field(default_factory=list)
    file_preview: list[FilePreviewResponse] = Field(default_factory=list)
    file_preview_truncated_count: int = Field(
        default=0,
        description="Count of additional changed files that are not included in `file_preview` because the preview list is intentionally capped.",
    )
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix: list[HostModelMixResponse] = Field(
        default_factory=list,
        description="Full host/model rollup for this project detail, ordered by rollup activity so the first item matches the primary aggregate exposed as `host_model_primary` when present.",
    )
    host_model_mix_count: int = Field(
        description="Count of distinct host/model aggregates in the full rollup for this project detail, including aggregates beyond the primary one.",
    )
    host_model_primary: HostModelMixResponse | None = Field(
        default=None,
        description="Primary host/model aggregate for this project detail, selected by rollup activity rather than the latest event.",
    )

    @model_validator(mode="before")
    @classmethod
    def populate_events_alias(cls, value: Any) -> Any:
        return populate_event_count_alias(value)


class ProjectListResponse(BaseModel):
    items: list[ProjectListItemResponse]


class SessionListResponse(BaseModel):
    items: list[SessionListItemResponse]


class CompactSessionListResponse(BaseModel):
    items: list[CompactSessionListItemResponse]


class ProjectSessionsResponse(BaseModel):
    project_name: str
    project_ref: str
    items: list[SessionListItemResponse]


class CompactProjectSessionsResponse(BaseModel):
    project_name: str
    project_ref: str
    items: list[CompactSessionListItemResponse]


class ReadmeSnippetResponse(BaseModel):
    markdown: str = Field(
        description="Markdown snippet for embedding the live Clipulse badge in a README."
    )


class ApiStatusResponse(BaseModel):
    status: ServiceStatus = Field(
        description="Always `ok` when the API process is reachable and can return this status document."
    )
    version: str = Field(description="Clipulse API version reported by the running service.")


class DashboardAuthStatusResponse(BaseModel):
    auth_mode: str = Field(
        description="Resolved dashboard auth mode for this deployment. `split` means dedicated dashboard, API bearer, and session secrets; `legacy_single_token` means all three roles still share one fallback secret; `insecure_no_auth` means auth is explicitly disabled."
    )
    dashboard_auth_required: bool = Field(
        description="Whether the current deployment requires a dashboard/browser login before private dashboard data can be read."
    )
    browser_session_enabled: bool = Field(
        description="Whether the deployment currently issues browser session cookies for dashboard reads."
    )
    browser_session_scope: str = Field(
        description="Current browser session scope. `read_only` means browser sessions can read protected dashboard/API views but cannot call write routes."
    )
    legacy_single_token: bool = Field(
        description="Whether the deployment still resolves dashboard login, API bearer auth, and session signing from the legacy single-token fallback."
    )
    trusted_proxy_configured: bool = Field(
        description="Whether auth rate limiting is configured to trust specific direct proxy peers before consulting `X-Forwarded-For`."
    )
    client_ref_source: AuthClientRefSource = Field(
        description="Source used to resolve the current auth rate-limit client reference: direct `peer` info or a trusted-proxy `x_forwarded_for` hop."
    )
    public_reads_enabled: bool = Field(
        description="Whether public badge and README routes are currently enabled for anonymous access."
    )
    public_base_url_configured: bool = Field(
        description="Whether a public base URL is configured for public badge and README route generation."
    )


class DatabaseStatusResponse(BaseModel):
    status: HealthStatus = Field(
        description="`ok` when the API can query the configured database for summary counts, or `degraded` when the status route had to fall back to additive error details."
    )
    events: int = Field(description="Total ingested events currently stored in the database.")
    projects: int = Field(
        description="Count of distinct projects represented by the ingested events in the database."
    )
    sessions: int = Field(
        description="Count of distinct project-scoped sessions represented by the ingested events in the database."
    )
    error_code: str | None = Field(
        default=None,
        description="Optional machine-readable error when the database status block is degraded."
    )
    error_message: str | None = Field(
        default=None,
        description="Optional operator-safe human-readable detail associated with `error_code` for degraded database status."
    )
    latest_event_time: str | None = Field(
        default=None,
        description="UTC timestamp of the latest ingested event currently visible to the status query, or `null` when unavailable."
    )
    latest_event_age_seconds: int | None = Field(
        default=None,
        description="Whole-second age of `latest_event_time` relative to `generated_at`, or `null` when the latest event could not be resolved."
    )
    query_duration_ms: int = Field(
        description="Wall-clock duration in milliseconds spent building the database status block."
    )


class SpoolStatusResponse(BaseModel):
    status: HealthStatus = Field(
        description="`ok` when the spool status block was collected successfully, or `degraded` when unreadable local state forced a fallback payload."
    )
    error_code: str | None = Field(
        default=None,
        description="Optional machine-readable error when the spool status block is degraded."
    )
    error_message: str | None = Field(
        default=None,
        description="Optional operator-safe human-readable detail associated with `error_code` for degraded spool status."
    )
    state_dir: str = Field(
        description="Redacted marker for the resolved Clipulse state directory. The HTTP status surface never exposes the absolute path; inspect server logs or local operator commands when you need the real location."
    )
    backlog_mode: SpoolBacklogMode = Field(
        description="Derived lightweight queue mode for the current payload backlog: `missing_state_dir`, `empty`, `pending`, `processing_only`, `quarantine_only`, or `mixed`."
    )
    state_dir_kind: SpoolStateDirKind = Field(
        description="Whether the resolved state-dir path is currently a directory, regular file, or missing path before inspecting `spool/*`."
    )
    state_dir_exists: bool = Field(
        description="Whether the resolved Clipulse state directory path exists on disk before inspecting `spool/*` subdirectories."
    )
    ready: int = Field(
        description="Count of .json payload files currently queued in `spool/ready`. Returns 0 when the state directory is missing."
    )
    processing: int = Field(
        description="Count of .json payload files currently present in `spool/processing`. Returns 0 when the state directory is missing."
    )
    quarantine: int = Field(
        description="Count of .json payload files currently present in `spool/quarantine`. Returns 0 when the state directory is missing."
    )
    ready_bytes: int = Field(
        description="Total bytes across counted `spool/ready` `.json` payload files. Returns 0 when the state directory is missing."
    )
    processing_bytes: int = Field(
        description="Total bytes across counted `spool/processing` `.json` payload files. Returns 0 when the state directory is missing."
    )
    quarantine_bytes: int = Field(
        description="Total bytes across counted `spool/quarantine` `.json` payload files. Returns 0 when the state directory is missing."
    )
    orphan_sidecars: dict[str, int] = Field(
        default_factory=dict,
        description="Counts of `.meta.json` sidecars that do not currently have a matching payload file in each spool state, plus a `total` count."
    )
    quarantine_reason_counts: dict[str, int] = Field(
        default_factory=dict,
        description="Machine-readable counts of quarantine `reason` values derived from readable `.meta.json` sidecars."
    )
    quarantine_meta_error_counts: dict[str, int] = Field(
        default_factory=dict,
        description="Machine-readable counts of quarantine `.meta.json` sidecars that could not be read or parsed while collecting `quarantine_reason_counts`."
    )
    oldest_backlog_age_seconds: int = Field(
        description="Age in whole seconds of the oldest counted .json payload file across `spool/ready` and `spool/processing`. Returns 0 when the state directory is missing or the backlog is empty."
    )
    oldest_quarantine_age_seconds: int = Field(
        description="Age in whole seconds of the oldest counted .json payload file in `spool/quarantine`. Returns 0 when the state directory is missing or quarantine is empty."
    )
    query_duration_ms: int = Field(
        description="Wall-clock duration in milliseconds spent building the spool status block."
    )


class DashboardStatusCompatResponse(BaseModel):
    pointer: str = Field(
        description="Pointer to the checked-in dashboard compatibility artifact for mixed-version troubleshooting."
    )
    hash: str = Field(
        description="Stable sha256 fingerprint for the pointed compatibility artifact, exposed as lightweight metadata instead of the full contract body."
    )
    tier: DashboardCompatTier = Field(
        description="Coverage tier exposed by this lightweight compatibility metadata block."
    )
    artifact_status: DashboardCompatArtifactStatus = Field(
        description="Whether the checked-in compatibility artifact was loaded successfully, missing, or malformed when this metadata block was built."
    )
    artifact_error_code: CompatArtifactErrorCode | None = Field(
        default=None,
        description="Optional machine-readable reason when the checked-in compatibility artifact could not be read or parsed."
    )
    artifact_error_message: str | None = Field(
        default=None,
        description="Optional operator-focused human-readable detail associated with `artifact_error_code`."
    )
    surfaces: list[DashboardCompatSurface] = Field(
        default_factory=list,
        description="High-level payload families covered by the pointed artifact, not the full contract body.",
    )
    artifact_version: str | None = Field(
        default=None,
        description="Version copied from the compat artifact `_meta.version`. Returns `null` when the contract file is missing or malformed.",
    )
    artifact_sections: list[str] = Field(
        default_factory=list,
        description="Section names copied from the compat artifact `_meta.sections`; falls back to `[]` when the contract file is missing or malformed.",
    )
    artifact_section_count: int = Field(
        description="Section count copied from the compat artifact `_meta.section_count`, or derived from `_meta.sections` when available. Returns `0` when the contract file is missing or malformed."
    )


class DashboardStatusResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "api": {"status": "ok", "version": "0.1.0"},
                "auth": {
                    "auth_mode": "split",
                    "dashboard_auth_required": True,
                    "browser_session_enabled": True,
                    "browser_session_scope": "read_only",
                    "legacy_single_token": False,
                    "trusted_proxy_configured": False,
                    "client_ref_source": "peer",
                    "public_reads_enabled": False,
                    "public_base_url_configured": False,
                },
                "generated_at": "2026-04-05T13:05:30Z",
                "db": {
                    "status": "ok",
                    "events": 12,
                    "projects": 3,
                    "sessions": 4,
                    "error_code": None,
                    "error_message": None,
                    "latest_event_time": "2026-04-05T13:05:00Z",
                    "latest_event_age_seconds": 30,
                    "query_duration_ms": 2,
                },
                "compat": {
                    "pointer": "/contracts/dashboard-compat.v1.json",
                    "hash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                    "tier": "minimum",
                    "artifact_status": "ok",
                    "artifact_error_code": None,
                    "artifact_error_message": None,
                    "surfaces": ["dashboard-summary", "dashboard-detail"],
                    "artifact_version": "v1",
                    "artifact_sections": [
                        "languageBreakdownItem",
                        "modelBreakdownItem",
                        "hostBreakdownItem",
                        "projectTopItem",
                        "sessionListItem",
                        "projectDetail",
                        "sessionDetail",
                        "timeseriesItem",
                    ],
                    "artifact_section_count": 8,
                },
                "spool": {
                    "status": "ok",
                    "error_code": None,
                    "error_message": None,
                    "state_dir": "/home/demo/.local/state/clipulse",
                    "backlog_mode": "pending",
                    "state_dir_kind": "directory",
                    "state_dir_exists": True,
                    "ready": 1,
                    "processing": 0,
                    "quarantine": 0,
                    "ready_bytes": 256,
                    "processing_bytes": 0,
                    "quarantine_bytes": 0,
                    "orphan_sidecars": {"ready": 0, "processing": 0, "quarantine": 0, "total": 0},
                    "quarantine_reason_counts": {},
                    "quarantine_meta_error_counts": {"read_error": 0, "parse_error": 0},
                    "oldest_backlog_age_seconds": 42,
                    "oldest_quarantine_age_seconds": 0,
                    "query_duration_ms": 1,
                },
            }
        }
    )

    api: ApiStatusResponse
    auth: DashboardAuthStatusResponse = Field(
        description="Dashboard/browser authentication configuration visible to the frontend so it can render protected-session UI correctly."
    )
    generated_at: str = Field(
        description="UTC timestamp indicating when this status document was generated."
    )
    db: DatabaseStatusResponse
    compat: DashboardStatusCompatResponse
    spool: SpoolStatusResponse


def populate_event_count_alias(value: Any) -> Any:
    if not isinstance(value, dict):
        return value

    data = dict(value)
    event_count = data.get("event_count")
    events = data.get("events")

    if event_count is None and events is not None:
        data["event_count"] = events
    if events is None and event_count is not None:
        data["events"] = event_count

    return data
