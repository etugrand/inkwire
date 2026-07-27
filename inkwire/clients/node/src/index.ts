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
  const retries = Math.max(1, opts.retries ?? 3);
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
