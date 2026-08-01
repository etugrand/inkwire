# inkwire-receiver-core

Shared Python core for building an [Inkwire](https://github.com/etugrand/inkwire)
receiver. It validates incoming posts, derives SEO metadata, safely renders
Markdown, resolves slugs, and upserts through a storage interface you provide.

```bash
pip install "inkwire-receiver-core[fastapi]"
```

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from inkwire_receiver import MemoryStore, handle_post

app = FastAPI()
store = MemoryStore()  # Replace with your database-backed store.


@app.post("/api/posts")
async def create_post(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = None

    status, response, headers = await handle_post(
        request.headers.get("authorization"),
        body,
        ["your-api-key"],
        store,
    )
    return JSONResponse(status_code=status, content=response, headers=headers)
```

`MemoryStore` is intended for local development and tests. Production sites
should provide an asynchronous store implementing `find_by_external_id`,
`find_by_slug`, and `upsert`. See the
[protocol specification](https://github.com/etugrand/inkwire/blob/master/inkwire/SPEC.md)
for the complete wire and storage semantics.
