import express from "express";
import { handlePost, MemoryStore } from "inkwire-receiver-core";

const store = new MemoryStore();
const apiKeys = (process.env.INKWIRE_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/posts", async (req, res) => {
  const r = await handlePost({ authHeader: req.header("authorization"), rawBody: req.body, apiKeys, store });
  res.status(r.status).set(r.headers).json(r.body);
});

// Malformed JSON bodies never reach the route handler above — express.json()
// throws before it, and its default error page is HTML, not the Inkwire
// error contract. Catch that here so every failure mode returns the same shape.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).set({ "Inkwire-Version": "1" }).json({ error: { code: "invalid_payload", message: "malformed JSON body" } });
    return;
  }
  next(err);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`inkwire express receiver on :${port}`));
