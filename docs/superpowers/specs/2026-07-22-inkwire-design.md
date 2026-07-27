# Inkwire v1 — Design

**Status:** Approved (design). **Date:** 2026-07-22.

*Inkwire — the standard for wiring a blog post into any of your sites.*

## Problem

Isaac runs many custom apps (Python, Node, Next.js). External apps (content
generators, agents, other sites) need to **publish a blog post directly into any
of these sites**. Today there is no standard: DadSEO's `POST /api/blog` writes a
markdown file to the Next.js filesystem with a single shared `CRON_SECRET` — not
portable to DB-backed apps, no per-site auth, no idempotency.

## Goal

One **standard** every site implements so any authorized caller can create/update
a blog post with a single HTTP request. Reusable across heterogeneous stacks.

## Prior art (why REST/JSON, not the alternatives)

Inkwire is a REST + JSON over HTTPS protocol — the modern standard for this job.
Deliberately chosen over the alternatives:

- **XML-RPC** — what WordPress historically used for remote publishing. Heavier
  (XML), and a well-known security footgun (commonly disabled). Inkwire is its
  REST successor.
- **AtomPub (Atom Publishing Protocol)** — HTTP-based create/update over the Atom
  format. Same idea, legacy/enterprise-syndication encoding. Superseded by plain
  JSON REST for our use.
- **Git / webhook** (static-site generators) — still genuinely useful for static
  targets. Inkwire keeps the *same wire contract* but allows a **git/webhook
  receiver flavor** (see Receivers) instead of a DB insert.

## Non-goals (v1)

Binary media upload (URL-only), delete, comments, taxonomy beyond tags, a central
dashboard. All deferrable to v2.

---

## Architecture

The feature has two halves that live in different places:

| Half | Responsibility | Where it lives |
| --- | --- | --- |
| **Receiver** | `POST /api/posts` that lands a post in *that site's own* store | On each target site (Python/Node/Next). Always required. |
| **Caller / hub** | Compose, schedule, bulk-publish to many sites | **Anaella** (existing social-scheduling hub) + a direct-publish client SDK for machine callers. |

```
content-gen app ──client SDK──▶ site-A  POST /api/posts ──▶ site-A DB
                 ──client SDK──▶ site-B  POST /api/posts ──▶ site-B DB
Anaella (hub) ──Website/Blog provider──▶ site-A/B  POST /api/posts   (schedule, bulk, analytics)
Anaella MCP (create_post) ── agents publish through the hub
```

Inkwire defines the wire contract. Receivers implement it against local storage.
Callers (SDK, Anaella) speak it. **No standalone MCP** — Anaella's MCP covers
agent publishing once Blog channels exist.

---

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

## Deliverables

### 1. Spec (this document → formal `SPEC.md` + JSON Schema)
Machine-readable JSON Schema for the request/response so every language validates
identically.

### 2. Reference receivers (`receivers/`)
Drop-in `POST /api/posts` handlers, each doing auth → validate → render markdown →
sanitize → upsert, calling one storage function the app wires up:

```
savePost(post: NormalizedPost) -> { id, url, slug, created }
```

- `receivers/python-fastapi/` — FastAPI + pydantic validation.
- `receivers/node-express/` — Express + zod.
- `receivers/nextjs/` — App Router route handler + zod.

Storage stays the app's own (Postgres, SQLite, files — whatever). The protocol,
validation, rendering, and sanitization are uniform; only `savePost` is per-app.

**Receiver flavors** — same wire contract, different back end behind `savePost`:

- **DB / API flavor** (default) — insert/upsert into the app's database. Instant
  publish. Used by DB-backed custom apps.
- **Git / webhook flavor** (static sites — GitHub Pages, Netlify) — `savePost`
  commits a markdown file to the content repo and lets the build pipeline
  publish. `created`/`url` are derived from the committed path. Lets Inkwire cover
  static targets without changing the caller side at all. Deferred past Phase 1 —
  documented now so the contract stays flavor-agnostic.

### 3. Client SDK (`clients/`)
Tiny publish helper for callers:

```
publish(baseUrl, apiKey, payload) -> PublishResult
```

Sets headers + idempotency, retries `5xx`/`429` with exponential backoff, raises
typed errors (`Unauthorized`, `InvalidPayload`, `Conflict`, `RateLimited`).

- `clients/python/` (requests).
- `clients/node/` (fetch).

### 4. Anaella "Website / Blog" channel provider (in the anaella repo)
Makes Anaella a first-class Inkwire caller — scheduling, bulk, calendar, analytics,
and its **existing MCP `create_post`** all work for blogs.

- **`article` post type** added to Anaella's `Post` model (title + long markdown +
  slug + tags + canonical). Anaella's current model is caption-shaped
  (post/reel/story/thread); the article type is the one real model change.
- **Provider triad** under `apps/api/src/modules/channels/providers/website/`:
  - `website-channel.authenticator.ts` — "connect a site": store `base_url` +
    `api_key` as the channel integration credentials.
  - `website-channel.publisher.ts` — `postArticle()` → Inkwire `POST /api/posts`
    via the Node client SDK.
  - `website-channel.manager.ts` — wiring/registration.

---

## Implementation phases

- **Phase 1 — Foundation (first plan):** `SPEC.md` + JSON Schema, the three
  reference receivers, the two client SDKs, in the `inkwire/` repo. Prove it by
  wiring the Next.js receiver into one real site (DadSEO's blog can become an
  Inkwire consumer) and publishing via the SDK end to end.
- **Phase 2 — Anaella hub (second plan, anaella repo):** `article` post type +
  Website/Blog provider. Depends only on the frozen Phase-1 contract.

Each phase is a separate spec→plan→implementation cycle against the shared
contract.

---

## Testing

- **Contract conformance suite:** a language-agnostic set of request/response
  cases (valid create, valid update/upsert, missing title, bad auth, slug
  conflict, script-injection sanitization) that every receiver must pass. Runs
  against a receiver's URL.
- **Receiver unit tests:** validation + sanitization per language.
- **Client SDK tests:** retry/backoff on 429/5xx, typed-error mapping, idempotency
  header.
- **Anaella:** provider publish path against a mock Inkwire receiver; `article`
  type model tests.
