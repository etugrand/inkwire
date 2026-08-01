from fastapi.testclient import TestClient
import os
os.environ["INKWIRE_API_KEYS"] = "secret-key"
from app import app
from inkwire_receiver.render import render_markdown
from inkwire_receiver.handle import handle_post
from inkwire_receiver.store import MemoryStore
import asyncio

client = TestClient(app)
AUTH = {"Authorization": "Bearer secret-key"}

def test_render_strips_script():
    html = render_markdown("Hi\n\n<script>alert(1)</script>")
    assert "<script>" not in html

def test_create_published():
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "a", "title": "T", "markdown": "# H", "status": "published"})
    assert r.status_code == 200
    assert r.headers["inkwire-version"] == "1"
    assert r.json()["created"] is True and r.json()["status"] == "published"

def test_upsert():
    client.post("/api/posts", headers=AUTH, json={"external_id": "b", "title": "One", "markdown": "x"})
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "b", "title": "Two", "markdown": "x"})
    assert r.json()["created"] is False

def test_default_draft():
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "c", "title": "T", "markdown": "x"})
    assert r.json()["status"] == "draft"

def test_missing_title_400():
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "d", "markdown": "x"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_payload"

def test_bad_auth_401():
    r = client.post("/api/posts", headers={"Authorization": "Bearer nope"}, json={"external_id": "e", "title": "T", "markdown": "x"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"

def test_slug_conflict_409():
    client.post("/api/posts", headers=AUTH, json={"external_id": "owner", "title": "O", "markdown": "x", "slug": "taken"})
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "other", "title": "X", "markdown": "x", "slug": "taken"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"

def test_non_object_body_400():
    r = client.post("/api/posts", headers=AUTH, json=[1, 2, 3])
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_payload"

def test_too_many_tags_400():
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "f", "title": "T", "markdown": "x", "tags": [f"t{i}" for i in range(51)]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_payload"

def test_tag_too_long_400():
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "g", "title": "T", "markdown": "x", "tags": ["x" * 65]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_payload"

def test_bad_published_at_400():
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "h", "title": "T", "markdown": "x", "published_at": "not-a-date-at-all"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_payload"

def test_author_extra_field_400():
    r = client.post("/api/posts", headers=AUTH, json={"external_id": "i", "title": "T", "markdown": "x", "author": {"name": "A", "unexpected": "nope"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_payload"

def test_dedupe_slug_stays_within_length_cap():
    long_title = "a" * 300
    first = client.post("/api/posts", headers=AUTH, json={"external_id": "long-1", "title": long_title, "markdown": "x"})
    second = client.post("/api/posts", headers=AUTH, json={"external_id": "long-2", "title": long_title, "markdown": "x"})
    first_slug, second_slug = first.json()["slug"], second.json()["slug"]
    assert len(first_slug) == 255
    assert len(second_slug) <= 255
    assert second_slug != first_slug

class CapturingStore(MemoryStore):
    captured = None

    async def upsert(self, key, post):
        self.captured = post
        return await super().upsert(key, post)

def test_derives_effective_seo_metadata():
    store = CapturingStore()
    status, _, _ = asyncio.run(handle_post("Bearer secret-key", {
        "external_id": "seo-derived", "title": "Post title", "markdown": "x",
        "excerpt": "Post excerpt", "cover_image_url": "https://images.test/cover.jpg",
    }, ["secret-key"], store))
    assert status == 200
    assert store.captured["seo"] == {
        "title": "Post title", "description": "Post excerpt",
        "image_url": "https://images.test/cover.jpg", "noindex": False,
    }

def test_applies_seo_overrides_independently():
    store = CapturingStore()
    status, _, _ = asyncio.run(handle_post("Bearer secret-key", {
        "external_id": "seo-overrides", "title": "Post title", "markdown": "x",
        "excerpt": "Post excerpt", "cover_image_url": "https://images.test/cover.jpg",
        "seo": {"title": "Search title", "image_url": "https://images.test/social.jpg", "noindex": True},
    }, ["secret-key"], store))
    assert status == 200
    assert store.captured["seo"] == {
        "title": "Search title", "description": "Post excerpt",
        "image_url": "https://images.test/social.jpg", "noindex": True,
    }

def test_invalid_nested_seo_400():
    unknown = client.post("/api/posts", headers=AUTH, json={
        "external_id": "seo-invalid-1", "title": "T", "markdown": "x", "seo": {"keywords": ["x"]},
    })
    unsafe = client.post("/api/posts", headers=AUTH, json={
        "external_id": "seo-invalid-2", "title": "T", "markdown": "x", "seo": {"image_url": "javascript:alert(1)"},
    })
    null = client.post("/api/posts", headers=AUTH, json={
        "external_id": "seo-invalid-3", "title": "T", "markdown": "x", "seo": None,
    })
    nested_null = client.post("/api/posts", headers=AUTH, json={
        "external_id": "seo-invalid-4", "title": "T", "markdown": "x", "seo": {"title": None},
    })
    coerced_bool = client.post("/api/posts", headers=AUTH, json={
        "external_id": "seo-invalid-5", "title": "T", "markdown": "x", "seo": {"noindex": "false"},
    })
    assert unknown.status_code == 400
    assert unsafe.status_code == 400
    assert null.status_code == 400
    assert nested_null.status_code == 400
    assert coerced_bool.status_code == 400
