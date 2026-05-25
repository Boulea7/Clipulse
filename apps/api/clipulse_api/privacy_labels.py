import re


SAFE_PUBLIC_LABEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$")
HEX_TOKEN_PATTERN = re.compile(r"^[a-f0-9]{16,}$", re.IGNORECASE)
UUID_PATTERN = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
    re.IGNORECASE,
)
REQUEST_ID_PATTERN = re.compile(r"^(?:req|request|run|trace|span|session)[_-][A-Za-z0-9._-]{8,}$")
BASE64ISH_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9._-]{24,}={0,2}$")
SENSITIVE_LABEL_MARKERS = (
    "api_key",
    "apikey",
    "bearer",
    "credential",
    "password",
    "secret",
    "sk-",
    "token",
)


def normalize_safe_public_label(value: str | None, *, max_length: int = 128) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if not is_safe_public_label(stripped, max_length=max_length):
        return None
    return stripped


def is_safe_public_label(value: str, *, max_length: int = 128) -> bool:
    stripped = value.strip()
    if not stripped or len(stripped) > max_length:
        return False
    if "/" in stripped or "\\" in stripped or ":" in stripped:
        return False
    if stripped.startswith(("~", ".")):
        return False
    lowered = stripped.casefold()
    if "://" in lowered or "=" in lowered:
        return False
    if any(marker in lowered for marker in SENSITIVE_LABEL_MARKERS):
        return False
    if HEX_TOKEN_PATTERN.fullmatch(stripped):
        return False
    if UUID_PATTERN.fullmatch(stripped):
        return False
    if REQUEST_ID_PATTERN.fullmatch(stripped):
        return False
    if looks_like_random_identifier(stripped):
        return False
    return SAFE_PUBLIC_LABEL_PATTERN.fullmatch(stripped) is not None


def looks_like_random_identifier(value: str) -> bool:
    compact = value.replace("-", "").replace("_", "").replace(".", "")
    if len(compact) < 24:
        return False
    if not BASE64ISH_TOKEN_PATTERN.fullmatch(value):
        return False

    character_classes = sum(
        bool(pattern.search(compact))
        for pattern in (
            re.compile(r"[a-z]"),
            re.compile(r"[A-Z]"),
            re.compile(r"[0-9]"),
        )
    )
    unique_ratio = len(set(compact)) / len(compact)
    return character_classes >= 2 and unique_ratio >= 0.45
