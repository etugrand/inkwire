import time
import httpx

_transport = None  # tests may inject an httpx.MockTransport


class InkwireClientError(Exception):
    def __init__(self, code: str, message: str, http_status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


def publish(base_url: str, api_key: str, payload: dict, retries: int = 3) -> dict:
    # ponytail: clamp retries to ensure loop executes at least once
    retries = max(1, retries)

    url = base_url.rstrip("/") + "/api/posts"
    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {api_key}",
        "idempotency-key": payload["external_id"],
    }
    client = httpx.Client(transport=_transport) if _transport else httpx.Client()
    try:
        last = None
        for attempt in range(1, retries + 1):
            res = client.post(url, json=payload, headers=headers)
            if res.status_code == 200:
                return res.json()
            retriable = res.status_code == 429 or res.status_code >= 500
            code, message = "internal", f"HTTP {res.status_code}"
            try:
                err = res.json().get("error")
                if err:
                    code, message = err["code"], err["message"]
            except Exception:
                pass
            if not retriable or attempt == retries:
                raise InkwireClientError(code, message, res.status_code)
            last = InkwireClientError(code, message, res.status_code)
            time.sleep(2 ** (attempt - 1) * 0.2)
        raise last
    finally:
        client.close()
