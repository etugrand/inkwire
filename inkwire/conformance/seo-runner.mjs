const BASE = process.env.BASE_URL;
const KEY = process.env.API_KEY;

if (!BASE || !KEY) {
  console.error("Set BASE_URL and API_KEY");
  process.exit(2);
}

const id = `seo-profile-${Date.now()}`;
const title = 'SEO </title><script>globalThis.__INKWIRE_XSS__=1</script> & "Safety" literal &quot; entity';
const description = 'Portable " onmouseover="globalThis.__INKWIRE_XSS__=2 & metadata';
const image = `https://images.example.test/${id}.jpg`;
const canonical = `https://canonical.example.test/${id}`;
const publishedAt = "2026-08-01T12:00:00Z";

async function publish(body) {
  const response = await fetch(`${BASE.replace(/\/$/, "")}/api/posts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      "idempotency-key": body.external_id,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`publish returned ${response.status}: ${JSON.stringify(json)}`);
  if (!json.url) throw new Error("publish response has no url");
  return json;
}

function decode(value) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => attributes(match[0]));
}

function meta(html, key, value) {
  return tags(html, "meta").find((item) => item[key] === value)?.content;
}

function findBlogPosting(value, inheritedContext) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBlogPosting(item, inheritedContext);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    const context = value["@context"] ?? inheritedContext;
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.includes("BlogPosting")) return { node: value, context };
    for (const child of Object.values(value)) {
      const found = findBlogPosting(child, context);
      if (found) return found;
    }
  }
  return undefined;
}

function jsonLd(html) {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(`<script ${match[1]}>`).type?.toLowerCase() !== "application/ld+json") continue;
    try {
      const found = findBlogPosting(JSON.parse(match[2]));
      if (found) return found;
    } catch {}
  }
  return undefined;
}

function checkEqual(problems, label, actual, expected) {
  if (actual !== expected) problems.push(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

async function fetchPage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`public page returned ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    throw new Error("public page is not text/html");
  }
  return response.text();
}

function inspect(html, expected) {
  const problems = [];
  const titleMatches = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
  if (titleMatches.length !== 1) problems.push(`expected one title, found ${titleMatches.length}`);
  const titleMatch = titleMatches[0];
  checkEqual(problems, "title", titleMatch ? decode(titleMatch[1].replace(/<[^>]*>/g, "")) : undefined, expected.title);
  checkEqual(problems, "description", meta(html, "name", "description"), expected.description);
  checkEqual(problems, "canonical", tags(html, "link").find((item) => item.rel?.toLowerCase() === "canonical")?.href, expected.canonical);
  checkEqual(problems, "og:type", meta(html, "property", "og:type"), "article");
  checkEqual(problems, "og:title", meta(html, "property", "og:title"), expected.title);
  checkEqual(problems, "og:description", meta(html, "property", "og:description"), expected.description);
  checkEqual(problems, "og:url", meta(html, "property", "og:url"), expected.canonical);
  checkEqual(problems, "twitter:title", meta(html, "name", "twitter:title"), expected.title);
  checkEqual(problems, "twitter:description", meta(html, "name", "twitter:description"), expected.description);
  if (!meta(html, "name", "twitter:card")) problems.push("twitter:card is missing");
  if (expected.image) {
    checkEqual(problems, "og:image", meta(html, "property", "og:image"), expected.image);
    checkEqual(problems, "twitter:image", meta(html, "name", "twitter:image"), expected.image);
  }
  if (expected.noindex && meta(html, "name", "robots")?.toLowerCase() !== "noindex,follow") {
    problems.push("robots must be noindex,follow");
  }
  if (!expected.noindex && meta(html, "name", "robots")?.toLowerCase().split(",").includes("noindex")) {
    problems.push("robots must not contain noindex");
  }
  if (html.includes("<script>globalThis.__INKWIRE_XSS__")) problems.push("SEO text was injected as executable markup");

  const result = jsonLd(html);
  if (!result) {
    problems.push("BlogPosting JSON-LD is missing or invalid");
  } else {
    const structured = result.node;
    checkEqual(problems, "JSON-LD @context", result.context, "https://schema.org");
    checkEqual(problems, "JSON-LD headline", structured.headline, expected.title);
    checkEqual(problems, "JSON-LD description", structured.description, expected.description);
    checkEqual(problems, "JSON-LD url", structured.url, expected.canonical);
    checkEqual(problems, "JSON-LD datePublished", structured.datePublished, expected.publishedAt);
    const mainEntity = typeof structured.mainEntityOfPage === "string"
      ? structured.mainEntityOfPage
      : structured.mainEntityOfPage?.["@id"];
    checkEqual(problems, "JSON-LD mainEntityOfPage", mainEntity, expected.canonical);
    if (typeof structured.mainEntityOfPage === "object") {
      checkEqual(problems, "JSON-LD mainEntityOfPage @type", structured.mainEntityOfPage?.["@type"], "WebPage");
    }
    if (expected.image) checkEqual(problems, "JSON-LD image", structured.image, expected.image);
    if (expected.author) {
      checkEqual(problems, "JSON-LD author @type", structured.author?.["@type"], "Person");
      checkEqual(problems, "JSON-LD author", structured.author?.name, expected.author);
    }
    if (expected.keywords) {
      const keywords = Array.isArray(structured.keywords) ? structured.keywords : [];
      if (!Array.isArray(structured.keywords)) problems.push("JSON-LD keywords must be an array");
      for (const keyword of expected.keywords) if (!keywords.includes(keyword)) problems.push(`JSON-LD keyword is missing: ${keyword}`);
    }
  }
  return problems;
}

try {
  const explicit = await publish({
    external_id: id,
    title: "Original title",
    markdown: "# Body",
    excerpt: "Original excerpt",
    tags: ["seo", "protocol"],
    canonical_url: canonical,
    author: { name: "Inkwire Conformance" },
    status: "published",
    published_at: publishedAt,
    seo: { title, description, image_url: image, noindex: true },
  });
  const explicitProblems = inspect(await fetchPage(explicit.url), {
    title, description, image, canonical, noindex: true, publishedAt,
    author: "Inkwire Conformance", keywords: ["seo", "protocol"],
  });

  const fallbackTitle = "SEO fallback title";
  const fallbackPublishedAt = "2026-08-01T13:00:00Z";
  const fallback = await publish({
    external_id: `${id}-fallback`,
    title: fallbackTitle,
    markdown: "# Body",
    status: "published",
    published_at: fallbackPublishedAt,
  });
  const fallbackProblems = inspect(await fetchPage(fallback.url), {
    title: fallbackTitle,
    description: fallbackTitle,
    canonical: fallback.url,
    noindex: false,
    publishedAt: fallbackPublishedAt,
  });

  const problems = [...explicitProblems.map((p) => `overrides: ${p}`), ...fallbackProblems.map((p) => `defaults: ${p}`)];
  if (problems.length) {
    for (const problem of problems) console.log(`FAIL ${problem}`);
    console.log(`\n${problems.length} SEO rendering check(s) failed`);
    process.exit(1);
  }
  console.log("PASS SEO Profile 1 overrides");
  console.log("PASS SEO Profile 1 defaults");
  console.log("\nSEO Profile 1 rendering conformance passed");
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
