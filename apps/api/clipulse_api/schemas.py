from pydantic import BaseModel, Field


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
    host_model_mix_count: int
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
    event_count: int
    events: int
    active_ms: int
    wait_ms: int
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
    event_count: int
    events: int
    active_ms: int
    wait_ms: int
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix_count: int
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
    event_count: int
    events: int
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


class ApiStatusResponse(BaseModel):
    status: str
    version: str


class DatabaseStatusResponse(BaseModel):
    status: str
    events: int
    projects: int
    sessions: int


class SpoolStatusResponse(BaseModel):
    state_dir: str
    ready: int
    processing: int
    quarantine: int
    ready_bytes: int
    processing_bytes: int
    quarantine_bytes: int
    oldest_backlog_age_seconds: int
    oldest_quarantine_age_seconds: int


class DashboardStatusResponse(BaseModel):
    api: ApiStatusResponse
    db: DatabaseStatusResponse
    spool: SpoolStatusResponse
