import hmac
from .errors import InkwireError
def authorize(auth_header: str | None, api_keys: list[str]) -> str:
    token = auth_header[7:] if auth_header and auth_header.startswith("Bearer ") else ""
    for k in api_keys:
        if hmac.compare_digest(k, token):
            return k
    raise InkwireError("unauthorized", "missing or invalid API key")
