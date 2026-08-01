# inkwire-receiver-core

Shared TypeScript core for building an [Inkwire](https://github.com/etugrand/inkwire) receiver: validate the incoming payload, derive SEO metadata, render+sanitize markdown to HTML, and upsert by `external_id` against a `PostStore` you provide.

```ts
import { handlePost, MemoryStore } from "inkwire-receiver-core";

const store = new MemoryStore(); // or your own PostStore-backed implementation
const { status, body, headers } = await handlePost({
  authHeader: req.headers.get("authorization"),
  rawBody: await req.json(),
  apiKeys: ["your-api-key"],
  store,
});
```

This package is the shared logic behind the [Express](https://github.com/etugrand/inkwire/tree/master/inkwire/receivers/node-express) and [Next.js](https://github.com/etugrand/inkwire/tree/master/inkwire/receivers/nextjs) reference receivers — see either for a full adapter example, and the [protocol spec](https://github.com/etugrand/inkwire/blob/master/inkwire/SPEC.md) for the wire contract `handlePost` implements.

## Exports

- `handlePost(input)` — the whole request lifecycle: auth, validation, slugging, sanitization, store upsert.
- `type PostStore` — the interface your storage backend must implement (`findByExternalId`, `findBySlug`, `upsert`).
- `type SeoMetadata` — effective title, description, image, and indexing values passed to `PostStore.upsert`.
- `MemoryStore` — an in-memory `PostStore` for local dev/testing.
- `renderMarkdown`, `slugify` — the sanitization and slug-generation helpers `handlePost` uses internally.
- `InkwireError` — typed error class mapping to the protocol's error codes.
