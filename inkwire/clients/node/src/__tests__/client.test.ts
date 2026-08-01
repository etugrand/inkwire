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

it("sends SEO overrides unchanged", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ok({ id: "1", external_id: "e", url: "u", slug: "s", status: "draft", created: true })));
  const seo = { title: "Search title", description: "Search description", image_url: "https://images.test/og.jpg", noindex: true };
  await publish("https://site.test", "k", { external_id: "e", title: "T", markdown: "x", seo });
  const call = (fetch as any).mock.calls[0];
  expect(JSON.parse(call[1].body).seo).toEqual(seo);
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

it("retries: 0 still makes one attempt and throws typed error", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "server_error", message: "oops" } }), { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(publish("https://site.test", "k", { external_id: "e", title: "T", markdown: "x" }, { retries: 0 }))
    .rejects.toMatchObject({ code: "server_error", httpStatus: 500 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
