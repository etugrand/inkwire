# Inkwire

[![npm](https://img.shields.io/npm/v/inkwire-client.svg)](https://www.npmjs.com/package/inkwire-client)
[![PyPI](https://img.shields.io/pypi/v/inkwire-client.svg)](https://pypi.org/project/inkwire-client/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A small, open protocol for publishing blog posts from any CMS or tool into any receiving website — REST + JSON, one endpoint, upsert semantics, server-side sanitization.

```
POST /api/posts
Authorization: Bearer <site_api_key>
Content-Type: application/json

{ "external_id": "gen-2026-07-22-abc", "title": "...", "markdown": "..." }
```

The full wire contract is in [`inkwire/SPEC.md`](inkwire/SPEC.md); [`inkwire/schema/inkwire-post.schema.json`](inkwire/schema/inkwire-post.schema.json) is the authoritative machine-readable schema where prose and schema disagree.

## Why

Every CMS speaks a different API. Every site that wants to *receive* posts (a marketing site, a docs site, a landing page) has to write a bespoke integration for each one. Inkwire is the opposite: one small contract a receiver implements once, and any publisher can target.

## Repository layout

```
inkwire/
  SPEC.md                        protocol spec (source of truth alongside the schema)
  schema/                        JSON Schema + validation examples/tests
  conformance/                   black-box test suite (cases.json + runner.mjs) — the gate for any receiver
  receivers/
    core-ts/                     shared TS core (validate → render → sanitize → upsert) — the "real" implementation
    node-express/                thin Express adapter over core-ts
    nextjs/                      thin Next.js App Router adapter over core-ts
    python-fastapi/              independent Python core + FastAPI adapter, mirrors core-ts field-for-field
  clients/
    node/                        Node publish() client — idempotency, retry/backoff, typed errors
    python/                      Python publish() client — same behavior
```

A **receiver** is anything that implements `POST /api/posts` per the spec; `core-ts` and the Python core are reference implementations, not the only way to build one. A **client** is a thin wrapper for calling a receiver from a publisher.

## Protocol semantics, in brief

- **Upsert on `external_id`**, scoped to the site/API key. Re-POST the same `external_id` to update in place — this is also how idempotency works. No separate PUT.
- **Slug**: omit it and the receiver generates + de-dupes one silently (never 409). Provide one that collides with a *different* post's `external_id` and you get `409 conflict`.
- **Markdown is canonical.** Receivers render it to sanitized HTML server-side (`markdown-it`/`sanitize-html` in TS, `markdown`/`nh3` in Python) — `<script>`, event handlers, and non-http(s) URI schemes are stripped/rejected everywhere, including `cover_image_url`/`canonical_url`.
- **Every response** carries `Inkwire-Version: 1`. Errors are typed: `invalid_payload` (400), `unauthorized` (401), `conflict` (409), `rate_limited` (429), `internal` (500).

## Try it

Pick a receiver and run its conformance check — this is the actual gate every receiver must pass, not just a smoke test:

```bash
# 1. Start any receiver, e.g. the Express one:
cd inkwire/receivers/core-ts && npm install && npm run build
cd ../node-express && npm install
INKWIRE_API_KEYS=dev-key npm start &

# 2. Run the conformance suite against it (15 cases: validation, auth, slugs, sanitization, formats):
cd ../../conformance && npm install
BASE_URL=http://localhost:3000 API_KEY=dev-key node runner.mjs
```

Same runner works unmodified against `receivers/nextjs` or `receivers/python-fastapi` — that's the point of a black-box conformance suite.

### Publish from Node

```bash
npm install inkwire-client
```

```js
import { publish } from "inkwire-client";

await publish("http://localhost:3000", "dev-key", {
  external_id: "my-post-1",
  title: "Hello",
  markdown: "# Hello\n\nFirst post via Inkwire.",
  status: "published",
});
```

### Publish from Python

```bash
pip install inkwire-client
```

```python
from inkwire_client import publish

publish("http://localhost:3000", "dev-key", {
    "external_id": "my-post-1",
    "title": "Hello",
    "markdown": "# Hello\n\nFirst post via Inkwire.",
    "status": "published",
})
```

## Status

v1, protocol-complete: frozen schema, conformance suite, three reference receivers (Express, Next.js, FastAPI) sharing one contract, two client SDKs, and a real end-to-end integration proven against a live site. Published: `inkwire-client` on [npm](https://www.npmjs.com/package/inkwire-client) and [PyPI](https://pypi.org/project/inkwire-client/), and `inkwire-receiver-core` on [npm](https://www.npmjs.com/package/inkwire-receiver-core). The Python receiver core is still consumed in-repo only, not yet published.

## License

[MIT](LICENSE)
