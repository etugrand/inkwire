import { describe, it, expect, beforeEach } from "vitest";
import { handlePost, type PostStore } from "../handle.js";
import { MemoryStore, type UpsertInput } from "../store.js";

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

it("dedupes a 255-char slug without exceeding the length cap", async () => {
  const longTitle = "a".repeat(300);
  const first = await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "long-1", title: longTitle, markdown: "x" } });
  const second = await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "long-2", title: longTitle, markdown: "x" } });
  const firstSlug = (first.body as any).slug as string;
  const secondSlug = (second.body as any).slug as string;
  expect(firstSlug.length).toBe(255);
  expect(secondSlug.length).toBeLessThanOrEqual(255);
  expect(secondSlug).not.toBe(firstSlug);
});

it("409 on explicit slug owned by a different external_id", async () => {
  await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "owner", title: "O", markdown: "x", slug: "taken" } });
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store,
    rawBody: { external_id: "other", title: "X", markdown: "x", slug: "taken" } });
  expect(r.status).toBe(409);
  expect((r.body as any).error.code).toBe("conflict");
});

function capturingStore() {
  const memory = new MemoryStore();
  let captured: UpsertInput | undefined;
  const capture: PostStore = {
    findByExternalId: (key, externalId) => memory.findByExternalId(key, externalId),
    findBySlug: (key, slug) => memory.findBySlug(key, slug),
    upsert: (key, post) => { captured = post; return memory.upsert(key, post); },
  };
  return { capture, get captured() { return captured; } };
}

it("derives effective SEO metadata from post fields", async () => {
  const target = capturingStore();
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store: target.capture, rawBody: {
    external_id: "seo-derived", title: "Post title", markdown: "x", excerpt: "Post excerpt",
    cover_image_url: "https://images.test/cover.jpg",
  } });
  expect(r.status).toBe(200);
  expect(target.captured?.seo).toEqual({
    title: "Post title", description: "Post excerpt",
    image_url: "https://images.test/cover.jpg", noindex: false,
  });
});

it("applies SEO overrides independently", async () => {
  const target = capturingStore();
  const r = await handlePost({ authHeader: auth, apiKeys: keys, store: target.capture, rawBody: {
    external_id: "seo-overrides", title: "Post title", markdown: "x", excerpt: "Post excerpt",
    cover_image_url: "https://images.test/cover.jpg",
    seo: { title: "Search title", image_url: "https://images.test/social.jpg", noindex: true },
  } });
  expect(r.status).toBe(200);
  expect(target.captured?.seo).toEqual({
    title: "Search title", description: "Post excerpt",
    image_url: "https://images.test/social.jpg", noindex: true,
  });
});

it("rejects invalid nested SEO fields", async () => {
  const unknown = await handlePost({ authHeader: auth, apiKeys: keys, store, rawBody: {
    external_id: "seo-invalid-1", title: "T", markdown: "x", seo: { keywords: ["x"] },
  } });
  const unsafe = await handlePost({ authHeader: auth, apiKeys: keys, store, rawBody: {
    external_id: "seo-invalid-2", title: "T", markdown: "x", seo: { image_url: "javascript:alert(1)" },
  } });
  expect(unknown.status).toBe(400);
  expect(unsafe.status).toBe(400);
});
