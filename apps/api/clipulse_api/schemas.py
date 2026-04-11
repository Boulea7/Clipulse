from pydantic import BaseModel, ConfigDict, Field


class LanguageStatPayload(BaseModel):
    added: int = 0
    removed: int = 0
    changed: int = 0


class FileDeltaPayload(BaseModel):
    fingerprint: str
    language: str
    added: int = 0
    removed: int = 0


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
    events: list[EventPayload]


class ApiErrorDetail(BaseModel):
    code: str
    message: str
    hint: str


class TopLanguageResponse(BaseModel):
    name: str
    changed: int


class HostModelMixResponse(BaseModel):
    host: str
    model_name: str
    events: int
    active_ms: int
    wait_ms: int


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
    events: int
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


class SessionListItemResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str = Field(
        description="Backward-compatible alias of `last_host`; mirrors the latest event host for this session summary."
    )
    last_host: str = Field(description="Host captured from the latest event in this session.")
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
    first_event_time: str
    last_event_time: str
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


class CompactSessionListItemResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str = Field(
        description="Backward-compatible alias of `last_host`; mirrors the latest event host for this session summary."
    )
    last_host: str = Field(description="Host captured from the latest event in this session.")
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
    first_event_time: str
    last_event_time: str
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


class SessionDetailResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str = Field(
        description="Backward-compatible alias of `last_host`; mirrors the latest event host for this session detail."
    )
    last_host: str = Field(description="Host captured from the latest event in this session.")
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
    first_event_time: str
    last_event_time: str
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
    host_model_mix: list[HostModelMixResponse] = Field(default_factory=list)
    host_model_mix_count: int
    host_model_primary: HostModelMixResponse | None = Field(
        default=None,
        description="Primary host/model aggregate for this session detail, selected by rollup activity rather than the latest event.",
    )
    top_language: TopLanguageResponse | None = None


class ProjectDetailResponse(BaseModel):
    project_name: str
    project_ref: str
    active_ms: int
    wait_ms: int
    event_count: int
    session_count: int
    last_event_time: str | None = None
    last_host: str | None = Field(
        default=None,
        description="Host captured from the latest event in this project.",
    )
    last_model_name: str | None = Field(
        default=None,
        description="Model captured from the latest event in this project.",
    )
    last_git_branch: str | None = Field(
        default=None,
        description="Git branch captured from the latest event in this project.",
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
    host_model_mix: list[HostModelMixResponse] = Field(default_factory=list)
    host_model_mix_count: int
    host_model_primary: HostModelMixResponse | None = Field(
        default=None,
        description="Primary host/model aggregate for this project detail, selected by rollup activity rather than the latest event.",
    )


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
    status: str = Field(
        description="Always `ok` when the API process is reachable and can return this status document."
    )
    version: str = Field(description="Clipulse API version reported by the running service.")


class DatabaseStatusResponse(BaseModel):
    status: str = Field(
        description="Always `ok` when the API can query the configured database for summary counts."
    )
    events: int = Field(description="Total ingested events currently stored in the database.")
    projects: int = Field(
        description="Count of distinct projects represented by the ingested events in the database."
    )
    sessions: int = Field(
        description="Count of distinct project-scoped sessions represented by the ingested events in the database."
    )


class SpoolStatusResponse(BaseModel):
    state_dir: str = Field(
        description="Resolved Clipulse state directory whose `spool/*` subdirectories are inspected for payload backlog. Resolution order is `CLIPULSE_STATE_DIR`, then `XDG_STATE_HOME/clipulse`, then `HOME/.local/state/clipulse`, and finally `Path.home()/.local/state/clipulse` if `HOME` is unavailable."
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
    oldest_backlog_age_seconds: int = Field(
        description="Age in whole seconds of the oldest counted .json payload file across `spool/ready` and `spool/processing`. Returns 0 when the state directory is missing or the backlog is empty."
    )
    oldest_quarantine_age_seconds: int = Field(
        description="Age in whole seconds of the oldest counted .json payload file in `spool/quarantine`. Returns 0 when the state directory is missing or quarantine is empty."
    )


class DashboardStatusResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "api": {"status": "ok", "version": "0.1.0"},
                "db": {"status": "ok", "events": 12, "projects": 3, "sessions": 4},
                "spool": {
                    "state_dir": "/home/demo/.local/state/clipulse",
                    "ready": 1,
                    "processing": 0,
                    "quarantine": 0,
                    "ready_bytes": 256,
                    "processing_bytes": 0,
                    "quarantine_bytes": 0,
                    "oldest_backlog_age_seconds": 42,
                    "oldest_quarantine_age_seconds": 0,
                },
            }
        }
    )

    api: ApiStatusResponse
    db: DatabaseStatusResponse
    spool: SpoolStatusResponse
