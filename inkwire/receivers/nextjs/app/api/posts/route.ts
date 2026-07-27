import { handlePost, MemoryStore, type PostStore } from "inkwire-receiver-core";

// Reference uses MemoryStore; a real app supplies its own PostStore (see README).
const store: PostStore = new MemoryStore();
const apiKeys = (process.env.INKWIRE_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function POST(req: Request) {
  let rawBody: unknown = null;
  try { rawBody = await req.json(); } catch { /* handled as invalid_payload */ }
  const r = await handlePost({ authHeader: req.headers.get("authorization") ?? undefined, rawBody, apiKeys, store });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
}
