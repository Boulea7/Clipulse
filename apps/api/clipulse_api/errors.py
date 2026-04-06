from fastapi import HTTPException

from .schemas import ApiErrorDetail


def api_error(status_code: int, code: str, message: str, hint: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=ApiErrorDetail(code=code, message=message, hint=hint).model_dump(),
    )


def project_not_found_error() -> HTTPException:
    return api_error(
        status_code=404,
        code="project_not_found",
        message="project was not found",
        hint="Fetch a valid project_ref from /api/v1/projects/top or /api/v1/sessions/recent.",
    )


def session_not_found_error() -> HTTPException:
    return api_error(
        status_code=404,
        code="session_not_found",
        message="session was not found",
        hint="Retry with a valid session_id, and include project_ref when the session spans multiple projects.",
    )


def ambiguous_session_error() -> HTTPException:
    return api_error(
        status_code=409,
        code="ambiguous_session",
        message="session_id matched multiple projects",
        hint="Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent.",
    )
