# inkwire-client

Python client for publishing posts to an [Inkwire](https://github.com/etugrand/inkwire) receiver.

```python
from inkwire_client import publish

result = publish("https://blog.example.com", "your-api-key", {
    "external_id": "my-post-1",
    "title": "Hello",
    "markdown": "# Hello\n\nFirst post via Inkwire.",
    "status": "published",
})
```

`publish(base_url, api_key, payload, retries=3)` upserts by `external_id`, retries on `429`/5xx with backoff, and raises `InkwireClientError(code, message, http_status)` on failure.

See the [protocol spec](https://github.com/etugrand/inkwire/blob/master/inkwire/SPEC.md) for the full payload shape.
