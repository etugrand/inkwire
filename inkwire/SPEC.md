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
  "seo": {                                // optional SEO Profile 1 overrides.
    "title": "Search result title",
    "description": "Search result description",
    "image_url": "https://.../og.jpg",
    "noindex": false
  },
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

### SEO Profile 1

SEO Profile 1 is part of the post contract, not a separate endpoint. The
optional `seo` object contains overrides only; receivers derive effective SEO
metadata for every post and pass it to their storage/rendering integration:

```text
title       = seo.title       ?? title
description = seo.description ?? first non-empty value of (excerpt, title)
image_url   = seo.image_url   ?? cover_image_url (may be absent)
noindex     = seo.noindex     ?? false
canonical   = canonical_url   ?? the post's absolute public URL
```

`seo.title` and `seo.description` must be non-empty when provided. SEO URLs
must use `http://` or `https://`. Unknown properties are invalid. Existing
top-level fields remain authoritative for canonical URL, author, publication
date, and tags; the profile does not duplicate them inside `seo`.

A receiver core conforms to the **SEO input profile** when it validates these
overrides and supplies the effective `title`, `description`, `image_url`, and
`noindex` values to the application-owned store. The public URL is only known
after the store finalizes the post, so the page renderer applies the canonical
fallback.

A site may additionally claim **SEO rendering conformance** for publicly
accessible `published` posts. Its returned HTML page must safely render:

- one document `<title>` using the effective title;
- `description`, canonical, `og:type=article`, `og:title`, `og:description`, and
  `og:url` tags using the effective values;
- `twitter:card`, `twitter:title`, and `twitter:description` tags;
- `og:image` and `twitter:image` when an effective image exists;
- `<meta name="robots" content="noindex,follow">` when `noindex` is true; and
- JSON-LD with `@context: https://schema.org`, `@type: BlogPosting`, `headline`,
  `description`, `url`, `mainEntityOfPage`, and `datePublished`, plus `image`,
  `author`, and `keywords` when their source fields exist.

When present, JSON-LD `author` is a `Person` object with `name`, and `keywords`
is an array containing the post tags. `mainEntityOfPage` may be the canonical URL
string or a `WebPage` object whose `@id` is that URL.

Metadata values must be HTML-escaped. JSON-LD must be serialized so
caller-controlled text cannot terminate its `<script>` element. Additional
site-wide metadata is allowed. Draft posts remain non-public under the base
protocol and cannot claim rendering conformance.

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

**Canonical allowlist (normative).** Every receiver's sanitizer MUST allow
exactly this set — no more, no less. It is `sanitize-html`'s default
`allowedTags` unioned with `img` (`h1`/`h2` are already in that default set):

```
a, abbr, address, article, aside, b, bdi, bdo, blockquote, br, caption, cite,
code, col, colgroup, data, dd, dfn, div, dl, dt, em, figcaption, figure,
footer, h1, h2, h3, h4, h5, h6, header, hgroup, hr, i, img, kbd, li, main,
mark, menu, nav, ol, p, pre, q, rb, rp, rt, rtc, ruby, s, samp, section,
small, span, strong, sub, sup, table, tbody, td, tfoot, th, thead, time, tr,
u, ul, var, wbr
```

Only two tags keep any attributes; every other tag is stripped of all
attributes:

| Tag | Allowed attributes |
| --- | --- |
| `a` | `href`, `name`, `rel` |
| `img` | `src`, `alt`, `title` |

Allowed URL schemes (for `href`/`src`, and enforced separately on
`cover_image_url`/`canonical_url`, which are never rendered as markdown):
`http`, `https`, `mailto`.

`cover_image_url`, `canonical_url`, and `seo.image_url` are plain URL fields, not markdown —
they bypass the HTML sanitizer entirely and go straight to storage, so they
are independently restricted to `http://`/`https://` at the schema level.

---
