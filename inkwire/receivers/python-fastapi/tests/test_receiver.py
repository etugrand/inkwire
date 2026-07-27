from fastapi.testclient import TestClient
import os
os.environ["INKWIRE_API_KEYS"] = "secret-key"
from app import app
from inkwire_receiver.render import render_markdown

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
