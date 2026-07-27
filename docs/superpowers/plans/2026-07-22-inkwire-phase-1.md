# Inkwire Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Inkwire v1 foundation — a frozen wire contract, a language-agnostic conformance kit, reference receivers (Next.js, Express, FastAPI), client SDKs (Node, Python) — and prove it end-to-end by wiring DadSEO's blog as the first real Inkwire receiver.

**Architecture:** One JSON Schema is the source of truth. A shared TypeScript core (validate → render markdown → sanitize → map errors) backs both TS receivers so the safety-critical code exists once; a mirror Python core backs the FastAPI receiver. Receivers are thin adapters that plug the core into an app-owned `savePost`/`save_post`. A black-box conformance runner verifies protocol behavior against any receiver URL; sanitization is verified white-box in each core's unit tests. Clients wrap the HTTP call with auth, idempotency, retry, and typed errors.

**Tech Stack:** TypeScript (Node 20+, zod, markdown-it, sanitize-html, vitest); Python 3.11+ (FastAPI, pydantic v2, markdown, nh3, pytest, httpx); JSON Schema draft 2020-12. No monorepo tooling — each package has its own manifest.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- Transport: **REST + JSON over HTTPS**. Endpoint: `POST /api/posts`.
- Content: **markdown is canonical**; the **receiver renders and sanitizes**.
- Sanitization MUST strip `<script>`, event handlers (`on*`), `javascript:` URIs, and any tag outside the allowlist.
- Auth: **per-site bearer API key**; compare in **constant time**.
- **Upsert on `external_id`**, scoped to the site/key. Re-POST same `external_id` → update (never duplicate).
- Required fields: `external_id`, `title`, `markdown`. `status` defaults to `"draft"`. `published_at` defaults to now.
- Slug: if omitted → generate from title + silently de-duplicate (never 409). If explicitly provided and owned by a **different** `external_id` → `409 conflict`.
- Response header: **`Inkwire-Version: 1`** on every response.
- Error body: `{ "error": { "code", "message" } }`. Codes: `invalid_payload` (400), `unauthorized` (401), `conflict` (409), `rate_limited` (429), `internal` (500).
- `cover_image_url` is a **URL only** (no binary upload). No delete in v1.

---

## File Structure

```
inkwire/
  SPEC.md                              # human contract (Task 1)
  schema/inkwire-post.schema.json      # JSON Schema, source of truth (Task 1)
  schema/examples/*.json               # valid/invalid example payloads (Task 1)
  conformance/
    cases.json                         # black-box protocol cases (Task 2)
    runner.mjs                         # POSTs cases to a receiver URL (Task 2)
    package.json
  receivers/
    core-ts/                           # shared TS core: validate/render/sanitize/errors (Task 3)
      src/{schema.ts,render.ts,auth.ts,errors.ts,handle.ts,store.ts}
      src/__tests__/*.test.ts
      package.json  tsconfig.json
    node-express/                      # Express reference receiver (Task 4)
      src/server.ts  src/demoStore.ts
      package.json
    nextjs/                            # Next.js App Router reference receiver (Task 5)
      app/api/posts/route.ts
      package.json
    python-fastapi/                    # FastAPI reference receiver + py core (Task 7)
      inkwire_receiver/{__init__.py,schema.py,render.py,auth.py,errors.py,handle.py,store.py}
      app.py  tests/test_receiver.py
      pyproject.toml
  clients/
    node/                              # @inkwire/client (Task 6)
      src/index.ts  src/__tests__/client.test.ts
      package.json  tsconfig.json
    python/                            # inkwire client (Task 8)
      inkwire_client/__init__.py  tests/test_client.py
      pyproject.toml
  docs/superpowers/{specs,plans}/...
```

DadSEO integration (Task 9) lives in the **dadseo** repo, not here.

---

### Task 1: Frozen contract — SPEC.md + JSON Schema

**Files:**
- Create: `inkwire/SPEC.md`
- Create: `inkwire/schema/inkwire-post.schema.json`
- Create: `inkwire/schema/examples/valid-minimal.json`, `valid-full.json`, `invalid-missing-title.json`
- Create: `inkwire/schema/package.json`, `inkwire/schema/validate.test.mjs`

**Interfaces:**
- Produces: the canonical request schema `inkwire-post.schema.json` (draft 2020-12) that every later task validates against. Required: `external_id`, `title`, `markdown`. Enum `status`: `["draft","published"]`.

- [ ] **Step 1: Write the failing schema test**

`inkwire/schema/validate.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("./inkwire-post.schema.json", import.meta.url)));
const ajv = addFormats(new Ajv({ allErrors: true }));
const validate = ajv.compile(schema);
const load = (f) => JSON.parse(readFileSync(new URL(`./examples/${f}`, import.meta.url)));

test("valid-minimal passes", () => assert.equal(validate(load("valid-minimal.json")), true));
test("valid-full passes", () => assert.equal(validate(load("valid-full.json")), true));
test("missing title fails", () => {
  assert.equal(validate(load("invalid-missing-title.json")), false);
  assert.ok(validate.errors.some((e) => e.params.missingProperty === "title"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd inkwire/schema && npm i -D ajv ajv-formats && node --test`
Expected: FAIL — `inkwire-post.schema.json` does not exist.

- [ ] **Step 3: Write the schema and examples**

`inkwire/schema/inkwire-post.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://inkwire.dev/schema/inkwire-post.schema.json",
  "title": "Inkwire Post v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["external_id", "title", "markdown"],
  "properties": {
    "external_id": { "type": "string", "minLength": 1, "maxLength": 255 },
    "title": { "type": "string", "minLength": 1, "maxLength": 512 },
    "markdown": { "type": "string", "minLength": 1 },
    "slug": { "type": "string", "maxLength": 255, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    "excerpt": { "type": "string", "maxLength": 1024 },
    "tags": { "type": "array", "items": { "type": "string", "maxLength": 64 }, "maxItems": 50 },
    "cover_image_url": { "type": "string", "format": "uri" },
    "canonical_url": { "type": "string", "format": "uri" },
    "author": {
      "type": "object", "additionalProperties": false,
      "properties": { "name": { "type": "string" }, "email": { "type": "string", "format": "email" } }
    },
    "status": { "type": "string", "enum": ["draft", "published"], "default": "draft" },
    "published_at": { "type": "string", "format": "date-time" }
  }
}
```
`examples/valid-minimal.json`:
```json
{ "external_id": "gen-1", "title": "Hello", "markdown": "# Hi\n\nBody." }
```
`examples/valid-full.json`:
```json
{ "external_id": "gen-2", "title": "Full", "markdown": "Body",
  "slug": "full-post", "excerpt": "e", "tags": ["seo","ai"],
  "cover_image_url": "https://x.test/c.jpg", "canonical_url": "https://x.test/p",
  "author": { "name": "Isaac", "email": "i@x.test" },
  "status": "published", "published_at": "2026-07-22T04:00:00Z" }
```
`examples/invalid-missing-title.json`:
```json
{ "external_id": "gen-3", "markdown": "Body" }
```
`inkwire/schema/package.json`:
```json
{ "name": "@inkwire/schema", "private": true, "type": "module", "scripts": { "test": "node --test" } }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd inkwire/schema && node --test`
Expected: PASS (3 tests).

- [ ] **Step 5: Write SPEC.md**

Create `inkwire/SPEC.md` as the human contract: copy the "wire contract", "auth", "content safety", "errors", and "versioning" sections from `docs/superpowers/specs/2026-07-22-inkwire-design.md` verbatim, and add at the top: `The machine-readable request schema is schema/inkwire-post.schema.json; it is authoritative where prose and schema disagree.`

- [ ] **Step 6: Commit**

```bash
cd inkwire && git add SPEC.md schema && git commit -m "feat(contract): Inkwire v1 SPEC + JSON Schema + examples"
```

---

### Task 2: Conformance kit — cases + runner

**Files:**
- Create: `inkwire/conformance/cases.json`, `inkwire/conformance/runner.mjs`, `inkwire/conformance/package.json`

**Interfaces:**
- Consumes: nothing (black box).
- Produces: `node runner.mjs` reads `BASE_URL` + `API_KEY` env, POSTs each case to `${BASE_URL}/api/posts`, asserts status/body/headers, prints a pass/fail line per case, exits non-zero on any failure. Every receiver task runs this to prove conformance.

- [ ] **Step 1: Write the conformance cases**

`inkwire/conformance/cases.json`:
```json
[
  { "name": "create published", "auth": true,
    "body": { "external_id": "c-1", "title": "First", "markdown": "# Hi", "status": "published" },
    "expect": { "status": 200, "json": { "created": true, "status": "published" }, "hasUrl": true, "hasSlug": true } },
  { "name": "upsert same external_id", "auth": true,
    "body": { "external_id": "c-1", "title": "First edited", "markdown": "# Hi again", "status": "published" },
    "expect": { "status": 200, "json": { "created": false } } },
  { "name": "default status is draft", "auth": true,
    "body": { "external_id": "c-2", "title": "Draft", "markdown": "x" },
    "expect": { "status": 200, "json": { "status": "draft" } } },
  { "name": "missing title -> 400", "auth": true,
    "body": { "external_id": "c-3", "markdown": "x" },
    "expect": { "status": 400, "errorCode": "invalid_payload" } },
  { "name": "missing external_id -> 400", "auth": true,
    "body": { "title": "x", "markdown": "x" },
    "expect": { "status": 400, "errorCode": "invalid_payload" } },
  { "name": "no auth -> 401", "auth": false,
    "body": { "external_id": "c-4", "title": "x", "markdown": "x" },
    "expect": { "status": 401, "errorCode": "unauthorized" } },
  { "name": "explicit slug conflict -> 409", "auth": true,
    "setup": { "external_id": "c-owner", "title": "Owner", "markdown": "x", "slug": "taken-slug" },
    "body": { "external_id": "c-other", "title": "Other", "markdown": "x", "slug": "taken-slug" },
    "expect": { "status": 409, "errorCode": "conflict" } }
]
```

- [ ] **Step 2: Write the runner**

`inkwire/conformance/runner.mjs`:
```js
import { readFileSync } from "node:fs";
const BASE = process.env.BASE_URL, KEY = process.env.API_KEY;
if (!BASE || !KEY) { console.error("Set BASE_URL and API_KEY"); process.exit(2); }
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));

async function post(body, auth) {
  const res = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { res, json };
}

let failed = 0;
for (const c of cases) {
  try {
    if (c.setup) await post(c.setup, true);
    const { res, json } = await post(c.body, c.auth);
    const e = c.expect;
    const problems = [];
    if (res.status !== e.status) problems.push(`status ${res.status}!=${e.status}`);
    if (res.headers.get("inkwire-version") !== "1") problems.push("missing Inkwire-Version:1");
    if (e.errorCode && json?.error?.code !== e.errorCode) problems.push(`code ${json?.error?.code}!=${e.errorCode}`);
    for (const [k, v] of Object.entries(e.json ?? {})) if (json?.[k] !== v) problems.push(`${k} ${json?.[k]}!=${v}`);
    if (e.hasUrl && !json?.url) problems.push("no url");
    if (e.hasSlug && !json?.slug) problems.push("no slug");
    if (problems.length) { failed++; console.log(`FAIL ${c.name}: ${problems.join(", ")}`); }
    else console.log(`PASS ${c.name}`);
  } catch (err) { failed++; console.log(`FAIL ${c.name}: ${err.message}`); }
}
console.log(failed ? `\n${failed} case(s) failed` : "\nAll conformance cases passed");
process.exit(failed ? 1 : 0);
```
`inkwire/conformance/package.json`:
```json
{ "name": "@inkwire/conformance", "private": true, "type": "module" }
```

- [ ] **Step 3: Smoke-test the runner against a throwaway stub**

Run: `cd inkwire/conformance && BASE_URL=http://127.0.0.1:1 API_KEY=x node runner.mjs; echo "exit=$?"`
Expected: cases FAIL (connection refused), `exit=1`. Confirms the runner reports failures and exits non-zero. (Real pass happens in Tasks 4/5/7.)

- [ ] **Step 4: Commit**

```bash
cd inkwire && git add conformance && git commit -m "feat(conformance): protocol case set + receiver runner"
```

---

### Task 3: Shared TS receiver core

**Files:**
- Create: `inkwire/receivers/core-ts/src/{errors.ts,schema.ts,auth.ts,render.ts,store.ts,handle.ts,index.ts}`
- Create: `inkwire/receivers/core-ts/src/__tests__/{render.test.ts,handle.test.ts}`
- Create: `inkwire/receivers/core-ts/{package.json,tsconfig.json}`

**Interfaces:**
- Produces:
  - `type PostStore` with `findByExternalId(key, externalId): Promise<StoredPost|null>`, `findBySlug(key, slug): Promise<StoredPost|null>`, `upsert(key, post): Promise<{ id, url, slug, created }>`.
  - `type NormalizedPost` = validated payload + `html: string`, `status`, `published_at: string`.
  - `handlePost(input: { authHeader?: string; rawBody: unknown; apiKeys: string[]; store: PostStore }): Promise<{ status: number; body: object; headers: Record<string,string> }>` — the whole protocol, transport-agnostic. Adapters (Task 4/5) just translate their framework's req/res to/from this.
  - `class InkwireError extends Error { code; httpStatus }`.

- [ ] **Step 1: Write failing sanitization + handler tests**

`inkwire/receivers/core-ts/src/__tests__/render.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../render";

describe("renderMarkdown", () => {
  it("renders markdown to html", () => {
    expect(renderMarkdown("# Hi")).toContain("<h1>Hi</h1>");
  });
  it("strips script tags and their contents", () => {
    const html = renderMarkdown("Hi\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });
  it("strips event handlers and javascript: urls", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)" onclick="x()">z</a>');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });
});
```
`inkwire/receivers/core-ts/src/__tests__/handle.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { handlePost, type PostStore } from "../handle";
import { MemoryStore } from "../store";

let store: PostStore;
const keys = ["secret-key"];
const auth = "Bearer secret-key";
beforeEach(() => { store = new MemoryStore(); });

it("creates a published post", async () => {
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "a", title: "T", markdown: "# H", status: "published" } });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ created: true, status: "published" });
  expect(r.headers["Inkwire-Version"]).toBe("1");
});

it("upserts on external_id", async () => {
  const base = { external_id: "a", markdown: "x" };
  await handlePost({ authHeader: auth, apiKeys: keys, store, rawBody: { ...base, title: "One" } });
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store, rawBody: { ...base, title: "Two" } });
  expect(r.body).toMatchObject({ created: false });
});

it("defaults status to draft", async () => {
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "b", title: "T", markdown: "x" } });
  expect(r.body).toMatchObject({ status: "draft" });
});

it("rejects missing title with 400 invalid_payload", async () => {
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store, rawBody: { external_id: "c", markdown: "x" } });
  expect(r.status).toBe(400);
  expect((r.body as any).error.code).toBe("invalid_payload");
});

it("rejects bad auth with 401", async () => {
  const r = await handlePost({ authHeader: "Bearer nope", apiKeys: keys, store,
    rawBody: { external_id: "d", title: "T", markdown: "x" } });
  expect(r.status).toBe(401);
  expect((r.body as any).error.code).toBe("unauthorized");
});

it("409 on explicit slug owned by a different external_id", async () => {
  await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "owner", title: "O", markdown: "x", slug: "taken" } });
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "other", title: "X", markdown: "x", slug: "taken" } });
  expect(r.status).toBe(409);
  expect((r.body as any).error.code).toBe("conflict");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd inkwire/receivers/core-ts && npm i && npm test`
Expected: FAIL — modules not implemented.

- [ ] **Step 3: Implement the core**

`inkwire/receivers/core-ts/package.json`:
```json
{
  "name": "@inkwire/receiver-core", "version": "0.1.0", "type": "module",
  "main": "dist/index.js", "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "zod": "^3.23.8", "markdown-it": "^14.1.0", "sanitize-html": "^2.13.1" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.5.0",
    "@types/markdown-it": "^14.1.2", "@types/sanitize-html": "^2.13.0" }
}
```
`tsconfig.json`:
```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
  "declaration": true, "outDir": "dist", "strict": true, "esModuleInterop": true, "skipLibCheck": true },
  "include": ["src"] }
```
`src/errors.ts`:
```ts
export type InkwireCode = "invalid_payload" | "unauthorized" | "conflict" | "rate_limited" | "internal";
const HTTP: Record<InkwireCode, number> = {
  invalid_payload: 400, unauthorized: 401, conflict: 409, rate_limited: 429, internal: 500,
};
export class InkwireError extends Error {
  constructor(public code: InkwireCode, message: string) { super(message); }
  get httpStatus() { return HTTP[this.code]; }
}
```
`src/schema.ts`:
```ts
import { z } from "zod";
export const PostInput = z.object({
  external_id: z.string().min(1).max(255),
  title: z.string().min(1).max(512),
  markdown: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(255).optional(),
  excerpt: z.string().max(1024).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  cover_image_url: z.string().url().optional(),
  canonical_url: z.string().url().optional(),
  author: z.object({ name: z.string().optional(), email: z.string().email().optional() }).optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  published_at: z.string().datetime().optional(),
});
export type PostInput = z.infer<typeof PostInput>;
```
`src/auth.ts`:
```ts
import { timingSafeEqual } from "node:crypto";
import { InkwireError } from "./errors";
function eq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
export function authorize(authHeader: string | undefined, apiKeys: string[]): string {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const match = apiKeys.find((k) => eq(k, token));
  if (!match) throw new InkwireError("unauthorized", "missing or invalid API key");
  return match;
}
```

`src/render.ts`:
```ts
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
const md = new MarkdownIt({ html: true, linkify: true });
export function renderMarkdown(markdown: string): string {
  const raw = md.render(markdown);
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: { a: ["href", "name", "target", "rel"], img: ["src", "alt", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });
}
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 255) || "post";
}
```
`src/store.ts` (interface + in-memory demo used by tests and the Express demo):
```ts
export interface StoredPost { id: string; slug: string; url: string; external_id: string; }
export interface UpsertInput {
  external_id: string; title: string; html: string; markdown: string; slug: string;
  excerpt?: string; tags?: string[]; cover_image_url?: string; canonical_url?: string;
  author?: { name?: string; email?: string }; status: "draft" | "published"; published_at: string;
}
export interface PostStore {
  findByExternalId(key: string, externalId: string): Promise<StoredPost | null>;
  findBySlug(key: string, slug: string): Promise<StoredPost | null>;
  upsert(key: string, post: UpsertInput): Promise<{ id: string; url: string; slug: string; created: boolean }>;
}
export class MemoryStore implements PostStore {
  private byExt = new Map<string, StoredPost>();
  private bySlug = new Map<string, StoredPost>();
  private seq = 0;
  private k(key: string, id: string) { return `${key}::${id}`; }
  async findByExternalId(key: string, externalId: string) { return this.byExt.get(this.k(key, externalId)) ?? null; }
  async findBySlug(key: string, slug: string) { return this.bySlug.get(this.k(key, slug)) ?? null; }
  async upsert(key: string, post: UpsertInput) {
    const existing = this.byExt.get(this.k(key, post.external_id));
    const id = existing?.id ?? String(++this.seq);
    const slug = post.slug;
    const url = `https://demo.local/blog/${slug}`;
    const rec: StoredPost = { id, slug, url, external_id: post.external_id };
    this.byExt.set(this.k(key, post.external_id), rec);
    this.bySlug.set(this.k(key, slug), rec);
    return { id, url, slug, created: !existing };
  }
}
```
`src/handle.ts` (the whole protocol):
```ts
import { PostInput } from "./schema";
import { authorize } from "./auth";
import { renderMarkdown, slugify } from "./render";
import { InkwireError } from "./errors";
import type { PostStore } from "./store";
export type { PostStore } from "./store";

const HEADERS = { "Inkwire-Version": "1", "content-type": "application/json" };

export async function handlePost(input: {
  authHeader?: string; rawBody: unknown; apiKeys: string[]; store: PostStore;
}): Promise<{ status: number; body: object; headers: Record<string, string> }> {
  try {
    const key = authorize(input.authHeader, input.apiKeys);
    const parsed = PostInput.safeParse(input.rawBody);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new InkwireError("invalid_payload", `${first.path.join(".") || "body"}: ${first.message}`);
    }
    const p = parsed.data;

    // Slug resolution + explicit-collision guard.
    let slug: string;
    if (p.slug) {
      const owner = await input.store.findBySlug(key, p.slug);
      if (owner && owner.external_id !== p.external_id) throw new InkwireError("conflict", `slug '${p.slug}' is taken`);
      slug = p.slug;
    } else {
      const existing = await input.store.findByExternalId(key, p.external_id);
      slug = existing?.slug ?? await dedupeSlug(input.store, key, slugify(p.title));
    }

    const html = renderMarkdown(p.markdown);
    const result = await input.store.upsert(key, {
      external_id: p.external_id, title: p.title, html, markdown: p.markdown, slug,
      excerpt: p.excerpt, tags: p.tags, cover_image_url: p.cover_image_url,
      canonical_url: p.canonical_url, author: p.author, status: p.status,
      published_at: p.published_at ?? new Date().toISOString(),
    });
    return { status: 200, headers: HEADERS, body: {
      id: result.id, external_id: p.external_id, url: result.url,
      slug: result.slug, status: p.status, created: result.created,
    } };
  } catch (err) {
    const e = err instanceof InkwireError ? err : new InkwireError("internal", "unexpected error");
    return { status: e.httpStatus, headers: HEADERS, body: { error: { code: e.code, message: e.message } } };
  }
}

async function dedupeSlug(store: PostStore, key: string, base: string): Promise<string> {
  let slug = base, n = 1;
  while (await store.findBySlug(key, slug)) slug = `${base}-${++n}`;
  return slug;
}
```
`src/index.ts`:
```ts
export { handlePost, type PostStore } from "./handle";
export { MemoryStore } from "./store";
export type { StoredPost, UpsertInput } from "./store";
export { InkwireError } from "./errors";
export { renderMarkdown, slugify } from "./render";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd inkwire/receivers/core-ts && npm test`
Expected: PASS (all render + handle tests).

- [ ] **Step 5: Commit**

```bash
cd inkwire && git add receivers/core-ts && git commit -m "feat(core-ts): transport-agnostic Inkwire receiver core + sanitization"
```

---

### Task 4: Express reference receiver

**Files:**
- Create: `inkwire/receivers/node-express/src/server.ts`, `inkwire/receivers/node-express/package.json`

**Interfaces:**
- Consumes: `handlePost`, `MemoryStore` from `@inkwire/receiver-core`.
- Produces: an Express app exposing `POST /api/posts` that passes the Task 2 conformance runner. Reads `INKWIRE_API_KEYS` (comma-separated) and `PORT`.

- [ ] **Step 1: Write the server**

`inkwire/receivers/node-express/package.json`:
```json
{
  "name": "@inkwire/receiver-express", "private": true, "type": "module",
  "scripts": { "start": "tsx src/server.ts" },
  "dependencies": { "@inkwire/receiver-core": "file:../core-ts", "express": "^5.0.0" },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.5.0" }
}
```
`src/server.ts`:
```ts
import express from "express";
import { handlePost, MemoryStore } from "@inkwire/receiver-core";

const store = new MemoryStore();
const apiKeys = (process.env.INKWIRE_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/posts", async (req, res) => {
  const r = await handlePost({ authHeader: req.header("authorization"), rawBody: req.body, apiKeys, store });
  res.status(r.status).set(r.headers).json(r.body);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`inkwire express receiver on :${port}`));
```

- [ ] **Step 2: Build core, start server, run conformance**

Run:
```bash
cd inkwire/receivers/core-ts && npm run build
cd ../node-express && npm i
INKWIRE_API_KEYS=secret-key PORT=4000 npm start &   # background
sleep 1
cd ../../conformance && BASE_URL=http://127.0.0.1:4000 API_KEY=secret-key node runner.mjs
```
Expected: `All conformance cases passed`, exit 0. Then `kill %1` to stop the server.

- [ ] **Step 3: Commit**

```bash
cd inkwire && git add receivers/node-express && git commit -m "feat(receiver): Express reference receiver (passes conformance)"
```

---

### Task 5: Next.js reference receiver

**Files:**
- Create: `inkwire/receivers/nextjs/app/api/posts/route.ts`, `inkwire/receivers/nextjs/package.json`, `inkwire/receivers/nextjs/README.md`

**Interfaces:**
- Consumes: `handlePost`, `MemoryStore` from `@inkwire/receiver-core`.
- Produces: an App Router `route.ts` snippet that is drop-in for any Next.js app and passes the conformance runner. This is the file DadSEO adapts in Task 9.

- [ ] **Step 1: Write the route handler**

`inkwire/receivers/nextjs/app/api/posts/route.ts`:
```ts
import { handlePost, MemoryStore, type PostStore } from "@inkwire/receiver-core";

// Reference uses MemoryStore; a real app supplies its own PostStore (see README).
const store: PostStore = new MemoryStore();
const apiKeys = (process.env.INKWIRE_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function POST(req: Request) {
  let rawBody: unknown = null;
  try { rawBody = await req.json(); } catch { /* handled as invalid_payload */ }
  const r = await handlePost({ authHeader: req.headers.get("authorization") ?? undefined, rawBody, apiKeys, store });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
}
```
`inkwire/receivers/nextjs/package.json`:
```json
{
  "name": "@inkwire/receiver-nextjs", "private": true,
  "dependencies": { "@inkwire/receiver-core": "file:../core-ts", "next": "^15.0.0", "react": "^19.0.0", "react-dom": "^19.0.0" },
  "scripts": { "dev": "next dev -p 4001", "build": "next build", "start": "next start -p 4001" }
}
```
`README.md`: document that a real app replaces `MemoryStore` with a `PostStore` backed by its DB, and that this is exactly what DadSEO does in the integration task.

- [ ] **Step 2: Run conformance against the Next.js dev server**

Run:
```bash
cd inkwire/receivers/nextjs && npm i
INKWIRE_API_KEYS=secret-key npm run dev &   # background
sleep 4
cd ../../conformance && BASE_URL=http://127.0.0.1:4001 API_KEY=secret-key node runner.mjs
```
Expected: `All conformance cases passed`, exit 0. Then `kill %1`.

- [ ] **Step 3: Commit**

```bash
cd inkwire && git add receivers/nextjs && git commit -m "feat(receiver): Next.js reference route handler (passes conformance)"
```

---

### Task 6: Node client SDK

**Files:**
- Create: `inkwire/clients/node/src/index.ts`, `inkwire/clients/node/src/__tests__/client.test.ts`, `inkwire/clients/node/{package.json,tsconfig.json}`

**Interfaces:**
- Produces: `publish(baseUrl: string, apiKey: string, payload: PostPayload, opts?: { retries?: number }): Promise<PublishResult>` and typed errors `InkwireClientError` with `.code`. `PublishResult = { id; external_id; url; slug; status; created }`. Retries `429`/`5xx` with exponential backoff (default 3 tries). Sends `Authorization: Bearer` + `Idempotency-Key: payload.external_id`.

- [ ] **Step 1: Write failing client tests**

`inkwire/clients/node/src/__tests__/client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { publish, InkwireClientError } from "../index";

const ok = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { "inkwire-version": "1" } });
afterEach(() => vi.restoreAllMocks());

it("publishes and returns the result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ok({ id: "1", external_id: "e", url: "u", slug: "s", status: "published", created: true })));
  const r = await publish("https://site.test", "k", { external_id: "e", title: "T", markdown: "x", status: "published" });
  expect(r).toMatchObject({ id: "1", created: true });
  const call = (fetch as any).mock.calls[0];
  expect(call[1].headers.authorization).toBe("Bearer k");
  expect(call[1].headers["idempotency-key"]).toBe("e");
});

it("retries on 500 then succeeds", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 500 }))
    .mockResolvedValueOnce(ok({ id: "1", external_id: "e", url: "u", slug: "s", status: "draft", created: true }));
  vi.stubGlobal("fetch", fetchMock);
  const r = await publish("https://site.test", "k", { external_id: "e", title: "T", markdown: "x" }, { retries: 2 });
  expect(r.id).toBe("1");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("throws typed error on 401 without retrying", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "no" } }), { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(publish("https://site.test", "bad", { external_id: "e", title: "T", markdown: "x" }))
    .rejects.toMatchObject({ code: "unauthorized" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd inkwire/clients/node && npm i && npm test`
Expected: FAIL — `../index` not implemented.

- [ ] **Step 3: Implement the client**

`inkwire/clients/node/package.json`:
```json
{
  "name": "@inkwire/client", "version": "0.1.0", "type": "module",
  "main": "dist/index.js", "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.5.0" }
}
```
`tsconfig.json`: same as core-ts's tsconfig.
`src/index.ts`:
```ts
export interface PostPayload {
  external_id: string; title: string; markdown: string;
  slug?: string; excerpt?: string; tags?: string[]; cover_image_url?: string;
  canonical_url?: string; author?: { name?: string; email?: string };
  status?: "draft" | "published"; published_at?: string;
}
export interface PublishResult {
  id: string; external_id: string; url: string; slug: string;
  status: "draft" | "published"; created: boolean;
}
export class InkwireClientError extends Error {
  constructor(public code: string, message: string, public httpStatus: number) { super(message); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function publish(
  baseUrl: string, apiKey: string, payload: PostPayload, opts: { retries?: number } = {},
): Promise<PublishResult> {
  const retries = opts.retries ?? 3;
  const url = `${baseUrl.replace(/\/$/, "")}/api/posts`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "idempotency-key": payload.external_id,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return (await res.json()) as PublishResult;
    const retriable = res.status === 429 || res.status >= 500;
    let code = "internal", message = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.error) { code = j.error.code; message = j.error.message; } } catch {}
    if (!retriable || attempt === retries) throw new InkwireClientError(code, message, res.status);
    lastErr = new InkwireClientError(code, message, res.status);
    await sleep(2 ** (attempt - 1) * 200);
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd inkwire/clients/node && npm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd inkwire && git add clients/node && git commit -m "feat(client): Node SDK with idempotency + retry + typed errors"
```

---

### Task 7: FastAPI reference receiver (+ Python core)

**Files:**
- Create: `inkwire/receivers/python-fastapi/inkwire_receiver/{__init__.py,schema.py,render.py,auth.py,errors.py,store.py,handle.py}`
- Create: `inkwire/receivers/python-fastapi/app.py`, `inkwire/receivers/python-fastapi/tests/test_receiver.py`, `inkwire/receivers/python-fastapi/pyproject.toml`

**Interfaces:**
- Produces: `handle_post(auth_header, raw_body, api_keys, store) -> tuple[int, dict, dict]` mirroring the TS core; a FastAPI `app` exposing `POST /api/posts` that passes the same conformance runner; `MemoryStore`.

- [ ] **Step 1: Write failing tests (sanitization + protocol via FastAPI TestClient)**

`inkwire/receivers/python-fastapi/tests/test_receiver.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd inkwire/receivers/python-fastapi && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && pytest -q`
Expected: FAIL — package modules not implemented.

- [ ] **Step 3: Implement the Python core + app**

`pyproject.toml`:
```toml
[project]
name = "inkwire-receiver"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["fastapi>=0.115", "markdown>=3.7", "nh3>=0.2.18"]
[project.optional-dependencies]
dev = ["pytest>=8.3", "httpx>=0.27", "uvicorn>=0.30"]
[tool.setuptools.packages.find]
include = ["inkwire_receiver*"]
```
`inkwire_receiver/errors.py`:
```python
HTTP = {"invalid_payload": 400, "unauthorized": 401, "conflict": 409, "rate_limited": 429, "internal": 500}
class InkwireError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = HTTP[code]
```
`inkwire_receiver/schema.py`:
```python
import re
from typing import Literal, Optional
from pydantic import BaseModel, Field, EmailStr, AnyUrl, ValidationError
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
class Author(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
class PostInput(BaseModel):
    model_config = {"extra": "forbid"}
    external_id: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=512)
    markdown: str = Field(min_length=1)
    slug: Optional[str] = Field(default=None, max_length=255)
    excerpt: Optional[str] = Field(default=None, max_length=1024)
    tags: Optional[list[str]] = None
    cover_image_url: Optional[AnyUrl] = None
    canonical_url: Optional[AnyUrl] = None
    author: Optional[Author] = None
    status: Literal["draft", "published"] = "draft"
    published_at: Optional[str] = None
    def validate_slug(self):
        if self.slug is not None and not SLUG.match(self.slug):
            raise ValueError("slug must be kebab-case")
```
`inkwire_receiver/render.py`:
```python
import re
import markdown as md
import nh3
ALLOWED_TAGS = {"p","br","strong","em","a","ul","ol","li","code","pre","blockquote","h1","h2","h3","h4","img","hr","table","thead","tbody","tr","th","td"}
ALLOWED_ATTRS = {"a": {"href","title","rel"}, "img": {"src","alt","title"}}
def render_markdown(text: str) -> str:
    raw = md.markdown(text, extensions=["extra"])
    return nh3.clean(raw, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, url_schemes={"http","https","mailto"})
def slugify(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:255]
    return out or "post"
```
`inkwire_receiver/auth.py`:
```python
import hmac
from .errors import InkwireError
def authorize(auth_header: str | None, api_keys: list[str]) -> str:
    token = auth_header[7:] if auth_header and auth_header.startswith("Bearer ") else ""
    for k in api_keys:
        if hmac.compare_digest(k, token):
            return k
    raise InkwireError("unauthorized", "missing or invalid API key")
```
`inkwire_receiver/store.py`:
```python
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
```
`inkwire_receiver/handle.py`:
```python
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
```
`inkwire_receiver/__init__.py`:
```python
from .handle import handle_post
from .store import MemoryStore
```
`app.py`:
```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd inkwire/receivers/python-fastapi && . .venv/bin/activate && pytest -q`
Expected: PASS (all tests).

- [ ] **Step 5: Run the black-box conformance suite against the live FastAPI app**

Run:
```bash
cd inkwire/receivers/python-fastapi && . .venv/bin/activate
INKWIRE_API_KEYS=secret-key uvicorn app:app --port 4002 &   # background
sleep 2
cd ../../conformance && BASE_URL=http://127.0.0.1:4002 API_KEY=secret-key node runner.mjs
```
Expected: `All conformance cases passed`, exit 0. Then `kill %1`.

- [ ] **Step 6: Commit**

```bash
cd inkwire && git add receivers/python-fastapi && git commit -m "feat(receiver): FastAPI reference receiver + Python core (passes conformance)"
```

---

### Task 8: Python client SDK

**Files:**
- Create: `inkwire/clients/python/inkwire_client/__init__.py`, `inkwire/clients/python/tests/test_client.py`, `inkwire/clients/python/pyproject.toml`

**Interfaces:**
- Produces: `publish(base_url, api_key, payload: dict, retries: int = 3) -> dict` and `InkwireClientError(code, message, http_status)`. Sends bearer auth + `Idempotency-Key`, retries `429`/`5xx` with exponential backoff.

- [ ] **Step 1: Write failing client tests**

`inkwire/clients/python/tests/test_client.py`:
```python
import httpx, pytest
from inkwire_client import publish, InkwireClientError

def make_transport(responses):
    calls = {"n": 0}
    def handler(request):
        i = min(calls["n"], len(responses) - 1); calls["n"] += 1
        status, body = responses[i]
        return httpx.Response(status, json=body, headers={"inkwire-version": "1"})
    return httpx.MockTransport(handler), calls

def test_publish_ok(monkeypatch):
    transport, calls = make_transport([(200, {"id": "1", "external_id": "e", "url": "u", "slug": "s", "status": "published", "created": True})])
    monkeypatch.setattr("inkwire_client._transport", transport, raising=False)
    r = publish("https://site.test", "k", {"external_id": "e", "title": "T", "markdown": "x"}, retries=1)
    assert r["created"] is True

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd inkwire/clients/python && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && pytest -q`
Expected: FAIL — module not implemented.

- [ ] **Step 3: Implement the client**

`pyproject.toml`:
```toml
[project]
name = "inkwire-client"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["httpx>=0.27"]
[project.optional-dependencies]
dev = ["pytest>=8.3"]
[tool.setuptools.packages.find]
include = ["inkwire_client*"]
```
`inkwire_client/__init__.py`:
```python
import time
import httpx

_transport = None  # tests may inject an httpx.MockTransport

class InkwireClientError(Exception):
    def __init__(self, code: str, message: str, http_status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status

def publish(base_url: str, api_key: str, payload: dict, retries: int = 3) -> dict:
    url = base_url.rstrip("/") + "/api/posts"
    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {api_key}",
        "idempotency-key": payload["external_id"],
    }
    client = httpx.Client(transport=_transport) if _transport else httpx.Client()
    try:
        last = None
        for attempt in range(1, retries + 1):
            res = client.post(url, json=payload, headers=headers)
            if res.status_code == 200:
                return res.json()
            retriable = res.status_code == 429 or res.status_code >= 500
            code, message = "internal", f"HTTP {res.status_code}"
            try:
                err = res.json().get("error")
                if err: code, message = err["code"], err["message"]
            except Exception:
                pass
            if not retriable or attempt == retries:
                raise InkwireClientError(code, message, res.status_code)
            last = InkwireClientError(code, message, res.status_code)
            time.sleep(2 ** (attempt - 1) * 0.2)
        raise last
    finally:
        client.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd inkwire/clients/python && . .venv/bin/activate && pytest -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd inkwire && git add clients/python && git commit -m "feat(client): Python SDK with idempotency + retry + typed errors"
```

---

### Task 9: Prove end-to-end — DadSEO becomes a real Inkwire receiver

**Repo:** `dadseo` (not `inkwire`). Branch off `main` first.

**Files:**
- Create: `dadseo/web/src/lib/inkwire/` — vendored copy of `inkwire/receivers/core-ts/src` (until published to npm). Add a header comment: `// Vendored from inkwire/receivers/core-ts @ <commit>. Do not edit here.`
- Create: `dadseo/web/src/lib/inkwire/fileStore.ts` — a `PostStore` that writes DadSEO's file-based blog.
- Modify: `dadseo/web/src/app/api/blog/route.ts` (or add `dadseo/web/src/app/api/posts/route.ts`) to use `handlePost` with the file store.
- Test: `dadseo/web/src/lib/inkwire/__tests__/fileStore.test.ts`

**Interfaces:**
- Consumes: `handlePost`, `PostStore`, `UpsertInput` from the vendored core.
- Produces: `FileStore` implementing `PostStore` — `upsert` writes `src/content/blog/<slug>.md` with gray-matter frontmatter that includes `inkwire_external_id`; `findByExternalId` scans frontmatter for a matching id; `findBySlug` checks file existence.

- [ ] **Step 1: Branch + vendor the core**

```bash
cd dadseo && git checkout -b feat/inkwire-receiver
mkdir -p web/src/lib/inkwire
cp ../inkwire/receivers/core-ts/src/{errors,schema,auth,render,store,handle,index}.ts web/src/lib/inkwire/
```
Ensure deps exist in `web/package.json`: `zod` (already present), add `markdown-it`, `sanitize-html`, and dev `@types/markdown-it`, `@types/sanitize-html`. Run `cd web && npm i markdown-it sanitize-html && npm i -D @types/markdown-it @types/sanitize-html`.

- [ ] **Step 2: Write the failing FileStore test**

`dadseo/web/src/lib/inkwire/__tests__/fileStore.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileStore } from "../fileStore";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string; let store: FileStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-")); store = new FileStore(dir, "https://site.test"); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const base = { external_id: "x1", title: "T", html: "<p>h</p>", markdown: "h",
  slug: "t", status: "published" as const, published_at: "2026-07-22T00:00:00Z" };

it("creates a file and reports created:true", async () => {
  const r = await store.upsert("site", base);
  expect(r.created).toBe(true);
  expect(fs.existsSync(path.join(dir, "t.md"))).toBe(true);
});

it("upserts by external_id (same file, created:false)", async () => {
  await store.upsert("site", base);
  const r = await store.upsert("site", { ...base, title: "T2" });
  expect(r.created).toBe(false);
  expect(await store.findByExternalId("site", "x1")).not.toBeNull();
});

it("finds by slug", async () => {
  await store.upsert("site", base);
  expect(await store.findBySlug("site", "t")).not.toBeNull();
  expect(await store.findBySlug("site", "nope")).toBeNull();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd dadseo/web && npx vitest run src/lib/inkwire/__tests__/fileStore.test.ts`
Expected: FAIL — `FileStore` not implemented.

- [ ] **Step 4: Implement FileStore**

`dadseo/web/src/lib/inkwire/fileStore.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { PostStore, StoredPost, UpsertInput } from "./store";

export class FileStore implements PostStore {
  constructor(private dir: string, private siteUrl: string) {
    fs.mkdirSync(this.dir, { recursive: true });
  }
  private files() { return fs.readdirSync(this.dir).filter((f) => f.endsWith(".md")); }
  private read(file: string) {
    const fm = matter(fs.readFileSync(path.join(this.dir, file), "utf8"));
    return fm.data as Record<string, unknown>;
  }
  private toStored(file: string): StoredPost {
    const slug = file.replace(/\.md$/, "");
    return { id: slug, slug, url: `${this.siteUrl}/blog/${slug}`, external_id: String(this.read(file).inkwire_external_id ?? "") };
  }
  async findByExternalId(_key: string, externalId: string) {
    const f = this.files().find((file) => String(this.read(file).inkwire_external_id) === externalId);
    return f ? this.toStored(f) : null;
  }
  async findBySlug(_key: string, slug: string) {
    const f = `${slug}.md`;
    return fs.existsSync(path.join(this.dir, f)) ? this.toStored(f) : null;
  }
  async upsert(key: string, post: UpsertInput) {
    const existing = await this.findByExternalId(key, post.external_id);
    // If the external_id already lives under a different slug, keep the original file name.
    const slug = existing?.slug ?? post.slug;
    const file = path.join(this.dir, `${slug}.md`);
    const body = matter.stringify(post.markdown, {
      title: post.title, date: post.published_at, status: post.status,
      excerpt: post.excerpt, tags: post.tags, cover: post.cover_image_url,
      canonical: post.canonical_url, inkwire_external_id: post.external_id,
    });
    fs.writeFileSync(file, body);
    return { id: slug, url: `${this.siteUrl}/blog/${slug}`, slug, created: !existing };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd dadseo/web && npx vitest run src/lib/inkwire/__tests__/fileStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Wire the route**

Create `dadseo/web/src/app/api/posts/route.ts`:
```ts
import path from "node:path";
import { handlePost } from "@/lib/inkwire/handle";
import { FileStore } from "@/lib/inkwire/fileStore";

const store = new FileStore(
  path.join(process.cwd(), "src/content/blog"),
  process.env.SITE_URL ?? "https://getdadseo.com",
);
const apiKeys = (process.env.INKWIRE_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function POST(req: Request) {
  let rawBody: unknown = null;
  try { rawBody = await req.json(); } catch {}
  const r = await handlePost({ authHeader: req.headers.get("authorization") ?? undefined, rawBody, apiKeys, store });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
}
```

- [ ] **Step 7: Prove the loop against the running dev server with the real Node SDK**

Run:
```bash
cd dadseo/web && INKWIRE_API_KEYS=proof-key npm run dev &   # background
sleep 5
node -e '
import("../../inkwire/clients/node/dist/index.js").then(async ({ publish }) => {
  const r = await publish("http://127.0.0.1:3000", "proof-key",
    { external_id: "proof-1", title: "Inkwire works", markdown: "# It works\n\nEnd to end.", status: "published" });
  console.log(r);
  if (!r.created || !r.url) process.exit(1);
});'
```
(Build the Node SDK first: `cd inkwire/clients/node && npm run build`.)
Expected: prints `{ id, url, slug, status: "published", created: true }`, and `dadseo/web/src/content/blog/inkwire-works.md` now exists with `inkwire_external_id: proof-1` in its frontmatter. Re-running prints `created: false` and does not create a second file. Then `kill %1`.

- [ ] **Step 8: Commit**

```bash
cd dadseo && git add web/src/lib/inkwire web/src/app/api/posts web/package.json web/package-lock.json && \
git commit -m "feat(blog): accept Inkwire posts via /api/posts (first real receiver)"
```

---

## Notes for the implementer

- **Do not edit** the vendored core in `dadseo/web/src/lib/inkwire/` — fixes go upstream in `inkwire/receivers/core-ts` and are re-copied. (Publishing `@inkwire/receiver-core` to npm and depending on it is a Phase 1.1 follow-up.)
- The **conformance runner is the gate** for every receiver (Tasks 4, 5, 7). A receiver isn't done until it prints `All conformance cases passed`.
- Sanitization is verified white-box in Task 3 (TS) and Task 7 (Python) — never weaken those allowlists to make a test pass.
- Ports mirror the TS core exactly; if you change protocol behavior, change it in the SPEC + schema (Task 1) first, then every receiver and the conformance cases.
