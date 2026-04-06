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
    host_model_primary: HostModelMixResponse | None = None


class SessionListItemResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str
    model_name: str
    git_branch: str
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
    host_model_primary: HostModelMixResponse | None = None


class SessionDetailResponse(BaseModel):
    session_id: str
    project_name: str
    project_ref: str
    host: str
    model_name: str
    git_branch: str
    first_event_time: str
    last_event_time: str
    event_count: int
    events: int
    active_ms: int
    wait_ms: int
    languages: list[LanguageTotalsResponse] = Field(default_factory=list)
    file_deltas: list[FilePreviewResponse] = Field(default_factory=list)
    file_preview: list[FilePreviewResponse] = Field(default_factory=list)
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    host_model_mix: list[HostModelMixResponse] = Field(default_factory=list)
    top_language: TopLanguageResponse | None = None


class ProjectDetailResponse(BaseModel):
    project_name: str
    project_ref: str
    active_ms: int
    wait_ms: int
    event_count: int
    session_count: int
    languages: list[LanguageTotalsResponse] = Field(default_factory=list)
    file_preview: list[FilePreviewResponse] = Field(default_factory=list)
    changed_files_count: int
    changed_languages_count: int
    lines_added: int
    lines_removed: int
    lines_changed: int
    top_language: TopLanguageResponse | None = None
    host_model_mix: list[HostModelMixResponse] = Field(default_factory=list)


class ProjectListResponse(BaseModel):
    items: list[ProjectListItemResponse]


class SessionListResponse(BaseModel):
    items: list[SessionListItemResponse]


class ProjectSessionsResponse(BaseModel):
    project_name: str
    project_ref: str
    items: list[SessionListItemResponse]


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
    ready_bytes: int
    processing_bytes: int
    quarantine_bytes: int
    oldest_backlog_age_seconds: int
    oldest_quarantine_age_seconds: int


class DashboardStatusResponse(BaseModel):
    api: ApiStatusResponse
    db: DatabaseStatusResponse
    spool: SpoolStatusResponse
