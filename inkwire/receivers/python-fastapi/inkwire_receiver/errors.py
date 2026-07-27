HTTP = {"invalid_payload": 400, "unauthorized": 401, "conflict": 409, "rate_limited": 429, "internal": 500}
class InkwireError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = HTTP[code]
