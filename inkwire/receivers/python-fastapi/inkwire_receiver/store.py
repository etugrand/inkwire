from typing import Protocol, Optional, TypedDict
class StoredPost(TypedDict):
    id: str; slug: str; url: str; external_id: str
class UpsertResult(TypedDict):
    id: str; url: str; slug: str; created: bool
class PostStore(Protocol):
    async def find_by_external_id(self, key: str, external_id: str) -> Optional[StoredPost]: ...
    async def find_by_slug(self, key: str, slug: str) -> Optional[StoredPost]: ...
    async def upsert(self, key: str, post: dict) -> UpsertResult: ...
class MemoryStore:
    def __init__(self): self._by_ext = {}; self._by_slug = {}; self._seq = 0
    def _k(self, key, i): return f"{key}::{i}"
    async def find_by_external_id(self, key, external_id):
        return self._by_ext.get(self._k(key, external_id))
    async def find_by_slug(self, key, slug):
        return self._by_slug.get(self._k(key, slug))
    async def upsert(self, key, post):
        existing = self._by_ext.get(self._k(key, post["external_id"]))
        if existing: pid = existing["id"]
        else: self._seq += 1; pid = str(self._seq)
        slug = post["slug"]; url = f"https://demo.local/blog/{slug}"
        rec = {"id": pid, "slug": slug, "url": url, "external_id": post["external_id"]}
        self._by_ext[self._k(key, post["external_id"])] = rec
        self._by_slug[self._k(key, slug)] = rec
        return {"id": pid, "url": url, "slug": slug, "created": existing is None}
