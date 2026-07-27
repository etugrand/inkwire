import express from "express";
import { handlePost, MemoryStore } from "@inkwire/receiver-core";

const store = new MemoryStore();
const apiKeys = (process.env.INKWIRE_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/posts", async (req, res) => {
  const r = await handlePost({ authHeader: req.header("authorization"), rawBody: req.body, apiKeys, store });
  res.status(r.status).set(r.headers).json(r.body);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`inkwire express receiver on :${port}`));
