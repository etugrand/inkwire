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
