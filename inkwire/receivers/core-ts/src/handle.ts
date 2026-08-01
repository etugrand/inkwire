import { PostInput } from "./schema.js";
import { authorize } from "./auth.js";
import { renderMarkdown, slugify } from "./render.js";
import { InkwireError } from "./errors.js";
import type { PostStore } from "./store.js";
export type { PostStore } from "./store.js";

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
    const seo = {
      title: p.seo?.title ?? p.title,
      description: p.seo?.description ?? (p.excerpt || p.title),
      image_url: p.seo?.image_url ?? p.cover_image_url,
      noindex: p.seo?.noindex ?? false,
    };
    const result = await input.store.upsert(key, {
      external_id: p.external_id, title: p.title, html, markdown: p.markdown, slug,
      excerpt: p.excerpt, tags: p.tags, cover_image_url: p.cover_image_url,
      canonical_url: p.canonical_url, seo, author: p.author, status: p.status,
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

const MAX_SLUG_LENGTH = 255;

async function dedupeSlug(store: PostStore, key: string, base: string): Promise<string> {
  let slug = base, n = 1;
  while (await store.findBySlug(key, slug)) {
    const suffix = `-${++n}`;
    slug = base.slice(0, MAX_SLUG_LENGTH - suffix.length) + suffix;
  }
  return slug;
}
