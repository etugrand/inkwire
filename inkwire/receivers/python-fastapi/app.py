import os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from inkwire_receiver import handle_post, MemoryStore

app = FastAPI()
store = MemoryStore()
api_keys = [k.strip() for k in os.environ.get("INKWIRE_API_KEYS", "").split(",") if k.strip()]

@app.post("/api/posts")
async def create_post(request: Request):
    try: raw = await request.json()
    except Exception: raw = None
    status, body, headers = await handle_post(request.headers.get("authorization"), raw, api_keys, store)
    return JSONResponse(status_code=status, content=body, headers=headers)
