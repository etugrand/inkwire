# inkwire-client

Node client for publishing posts to an [Inkwire](https://github.com/etugrand/inkwire) receiver.

```js
import { publish } from "inkwire-client";

const result = await publish("https://blog.example.com", "your-api-key", {
  external_id: "my-post-1",
  title: "Hello",
  markdown: "# Hello\n\nFirst post via Inkwire.",
  status: "published",
});
```

`publish(baseUrl, apiKey, payload, opts?)` upserts by `external_id`, retries on `429`/5xx with backoff, and throws `InkwireClientError` (`code`, `message`, `httpStatus`) on failure.

See the [protocol spec](https://github.com/etugrand/inkwire/blob/master/inkwire/SPEC.md) for the full payload shape.
