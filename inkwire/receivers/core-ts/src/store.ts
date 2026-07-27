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
