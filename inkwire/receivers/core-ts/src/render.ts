import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
const md = new MarkdownIt({ html: true, linkify: true });
export function renderMarkdown(markdown: string): string {
  const raw = md.render(markdown);
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: { a: ["href", "name", "rel"], img: ["src", "alt", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });
}
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 255) || "post";
}
