import { z } from "zod";
const httpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), { message: "must be an http(s) URL" });
export const PostInput = z.object({
  external_id: z.string().min(1).max(255),
  title: z.string().min(1).max(512),
  markdown: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(255).optional(),
  excerpt: z.string().max(1024).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  cover_image_url: httpUrl.optional(),
  canonical_url: httpUrl.optional(),
  author: z.object({ name: z.string().optional(), email: z.string().email().optional() }).strict().optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  published_at: z.string().datetime({ offset: true }).optional(),
}).strict();
export type PostInput = z.infer<typeof PostInput>;
