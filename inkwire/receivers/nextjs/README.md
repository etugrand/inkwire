# Inkwire Next.js Reference Receiver

This is the reference implementation of an Inkwire receiver in a Next.js App Router application.

## Overview

The receiver is implemented as a single `POST /api/posts` route handler in `app/api/posts/route.ts`. It uses the shared `@inkwire/receiver-core` module to handle all validation, authorization, and business logic.

## Configuration

### API Keys

Set the `INKWIRE_API_KEYS` environment variable to a comma-separated list of valid API keys:

```bash
INKWIRE_API_KEYS=key1,key2,key3 npm run dev
```

## Customization: Replacing MemoryStore

This reference implementation uses `MemoryStore` from `@inkwire/receiver-core` for simplicity. In a real application, you must provide your own `PostStore` implementation backed by your database.

To adapt this for your app:

1. Create a `PostStore` implementation that interfaces with your database:
   ```typescript
   import { type PostStore } from "@inkwire/receiver-core";

   export class MyPostStore implements PostStore {
     async upsert(post: Post): Promise<Post> {
       // Your database logic here
     }

     async getBySlug(slug: string): Promise<Post | null> {
       // Your database logic here
     }

     async getByExternalId(externalId: string): Promise<Post | null> {
       // Your database logic here
     }
   }
   ```

2. Replace `MemoryStore` in `app/api/posts/route.ts`:
   ```typescript
   const store: PostStore = new MyPostStore();
   ```

This is exactly the pattern used in the DadSEO integration (Task 9).

## Running

```bash
npm install
INKWIRE_API_KEYS=secret-key npm run dev
```

The server runs on port 4001 by default.

## Testing

Run the conformance test suite:

```bash
cd ../../conformance
BASE_URL=http://127.0.0.1:4001 API_KEY=secret-key node runner.mjs
```

All conformance cases must pass.
