import httpx
import pytest
import json
from inkwire_client import publish, InkwireClientError


def make_transport(responses):
    calls = {"n": 0, "requests": []}
    def handler(request):
        i = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        calls["requests"].append(request)
        status, body = responses[i]
        return httpx.Response(status, json=body, headers={"inkwire-version": "1"})
    return httpx.MockTransport(handler), calls


def test_publish_ok(monkeypatch):
    transport, calls = make_transport([(200, {"id": "1", "external_id": "e", "url": "u", "slug": "s", "status": "published", "created": True})])
    monkeypatch.setattr("inkwire_client._transport", transport, raising=False)
    r = publish("https://site.test", "k", {"external_id": "e", "title": "T", "markdown": "x"}, retries=1)
    assert r["created"] is True


def test_publish_sends_seo_unchanged(monkeypatch):
    transport, calls = make_transport([(200, {"id": "1", "external_id": "e", "url": "u", "slug": "s", "status": "draft", "created": True})])
    monkeypatch.setattr("inkwire_client._transport", transport, raising=False)
    seo = {"title": "Search title", "description": "Search description", "image_url": "https://images.test/og.jpg", "noindex": True}
    publish("https://site.test", "k", {"external_id": "e", "title": "T", "markdown": "x", "seo": seo}, retries=1)
    assert json.loads(calls["requests"][0].content)["seo"] == seo


def test_retry_then_success(monkeypatch):
    transport, calls = make_transport([(500, {}), (200, {"id": "1", "external_id": "e", "url": "u", "slug": "s", "status": "draft", "created": True})])
    monkeypatch.setattr("inkwire_client._transport", transport, raising=False)
    r = publish("https://site.test", "k", {"external_id": "e", "title": "T", "markdown": "x"}, retries=3)
    assert r["id"] == "1" and calls["n"] == 2


def test_401_raises(monkeypatch):
    transport, calls = make_transport([(401, {"error": {"code": "unauthorized", "message": "no"}})])
    monkeypatch.setattr("inkwire_client._transport", transport, raising=False)
    with pytest.raises(InkwireClientError) as ei:
        publish("https://site.test", "bad", {"external_id": "e", "title": "T", "markdown": "x"})
    assert ei.value.code == "unauthorized" and calls["n"] == 1


def test_retries_zero_makes_one_request(monkeypatch):
    """Verify retries=0 makes exactly one request and raises proper InkwireClientError, not TypeError."""
    transport, calls = make_transport([(500, {"error": {"code": "server_error", "message": "Internal Server Error"}})])
    monkeypatch.setattr("inkwire_client._transport", transport, raising=False)
    with pytest.raises(InkwireClientError) as ei:
        publish("https://site.test", "k", {"external_id": "e", "title": "T", "markdown": "x"}, retries=0)
    assert ei.value.code == "server_error"
    assert ei.value.http_status == 500
    assert calls["n"] == 1  # exactly one request made
