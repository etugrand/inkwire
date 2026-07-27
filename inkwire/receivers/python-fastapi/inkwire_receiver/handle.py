from datetime import datetime, timezone
from pydantic import ValidationError
from .schema import PostInput
from .auth import authorize
from .render import render_markdown, slugify
from .errors import InkwireError
HEADERS = {"Inkwire-Version": "1"}

async def _dedupe_slug(store, key, base):
    slug, n = base, 1
    while await store.find_by_slug(key, slug):
        n += 1; slug = f"{base}-{n}"
    return slug

async def handle_post(auth_header, raw_body, api_keys, store):
    try:
        key = authorize(auth_header, api_keys)
        try:
            p = PostInput(**(raw_body or {}))
            p.validate_slug()
        except (ValidationError, ValueError) as e:
            raise InkwireError("invalid_payload", str(e).splitlines()[0])
        if p.slug:
            owner = await store.find_by_slug(key, p.slug)
            if owner and owner["external_id"] != p.external_id:
                raise InkwireError("conflict", f"slug '{p.slug}' is taken")
            slug = p.slug
        else:
            existing = await store.find_by_external_id(key, p.external_id)
            slug = existing["slug"] if existing else await _dedupe_slug(store, key, slugify(p.title))
        html = render_markdown(p.markdown)
        result = await store.upsert(key, {
            "external_id": p.external_id, "title": p.title, "html": html, "markdown": p.markdown,
            "slug": slug, "status": p.status,
            "published_at": p.published_at or datetime.now(timezone.utc).isoformat(),
        })
        return 200, {"id": result["id"], "external_id": p.external_id, "url": result["url"],
                     "slug": result["slug"], "status": p.status, "created": result["created"]}, HEADERS
    except InkwireError as e:
        return e.http_status, {"error": {"code": e.code, "message": e.message}}, HEADERS
    except Exception:
        return 500, {"error": {"code": "internal", "message": "unexpected error"}}, HEADERS
