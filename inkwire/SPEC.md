# Inkwire v1 — Specification

The machine-readable request schema is `schema/inkwire-post.schema.json`; it is authoritative where prose and schema disagree.

## The wire contract

### Endpoint

`POST /api/posts`

### Request

```http
POST /api/posts
Authorization: Bearer <site_api_key>
Content-Type: application/json
Idempotency-Key: gen-2026-07-22-abc        # optional; defaults to external_id
```

```jsonc
{
  "external_id": "gen-2026-07-22-abc",   // REQUIRED. Stable caller id. Upsert key.
  "title": "How we cut audit time 40%",  // REQUIRED.
  "markdown": "# Body...\n\nText.",       // REQUIRED. Canonical content.
  "slug": "cut-audit-time",               // optional. Receiver finalizes/dedupes.
  "excerpt": "Short summary",             // optional.
  "tags": ["seo", "ai"],                  // optional. string[].
  "cover_image_url": "https://.../c.jpg", // optional. URL only in v1.
  "canonical_url": "https://origin/post", // optional. Cross-post SEO.
  "author": { "name": "Isaac", "email": "i@x.com" }, // optional.
  "status": "published",                  // "published" | "draft". Default "draft".
  "published_at": "2026-07-22T04:00:00Z"  // optional ISO-8601. Default now().
}
```

### Response `200`

```json
{
  "id": "142",
  "external_id": "gen-2026-07-22-abc",
  "url": "https://site/blog/cut-audit-time",
  "slug": "cut-audit-time",
  "status": "published",
  "created": true
}
```

`created: false` means an existing post (same `external_id`) was updated.

Response header: `Inkwire-Version: 1`.

### Semantics

- **Upsert on `external_id`, scoped to the site/key.** Re-POST the same
  `external_id` → update in place (never duplicate). This is both idempotency and
  the "update" operation. No separate PUT in v1.
- **Slug:** if `slug` is **omitted**, the receiver generates one (slugify title)
  and silently de-duplicates collisions (e.g. `-2` suffix) — never a 409. If the
  caller **explicitly provides** a `slug` that a *different* `external_id` already
  owns, the receiver returns `409 conflict` rather than silently changing it.
  Final slug is always returned in the response.
- **Status:** `draft` posts are stored but not publicly listed/rendered.

### Errors

```json
{ "error": { "code": "invalid_payload", "message": "title is required" } }
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `invalid_payload` | Missing/invalid required fields. |
| 401 | `unauthorized` | Missing/bad API key. |
| 409 | `conflict` | Requested `slug` already used by a *different* `external_id`. |
| 429 | `rate_limited` | Per-key rate limit exceeded. |
| 500 | `internal` | Receiver/storage failure. |

### Versioning

`Inkwire-Version: 1`. Only additive changes within v1 (new optional
fields). Breaking changes bump to `/api/posts` v2 (path or header negotiated).

---

## Auth

**Per-site bearer API key over HTTPS.** Each site holds one or more revocable
keys. Callers send `Authorization: Bearer <key>`. Proportionate because callers
are Isaac's own apps.

**Optional hardening (documented, not required in v1):** `X-Signature:
sha256=<hmac(raw_body, key)>` for body integrity + replay resistance. Receivers
MAY verify it; the spec reserves the header.

---

## Content safety (required in every receiver)

Markdown is canonical; **the receiver renders and sanitizes**. Rendered HTML MUST
strip `<script>`, event handlers (`on*`), `javascript:` URIs, and disallowed
tags. Callers never ship executable HTML. This is baked into the reference
receivers so every app is safe by default.

---
