import { readFileSync } from "node:fs";
const BASE = process.env.BASE_URL, KEY = process.env.API_KEY;
if (!BASE || !KEY) { console.error("Set BASE_URL and API_KEY"); process.exit(2); }
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));

async function post(body, auth, rawBody) {
  // auth: true -> the real API key, a string -> sent verbatim as the bearer
  // token (e.g. to test a wrong-but-well-formed key), falsy -> no header.
  const authHeader = auth === true ? `Bearer ${KEY}` : typeof auth === "string" ? `Bearer ${auth}` : undefined;
  const res = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authHeader ? { authorization: authHeader } : {}) },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { res, json };
}

let failed = 0;
for (const c of cases) {
  try {
    if (c.setup) await post(c.setup, true);
    const { res, json } = await post(c.body, c.auth, c.rawBody);
    const e = c.expect;
    const problems = [];
    if (res.status !== e.status) problems.push(`status ${res.status}!=${e.status}`);
    if (res.headers.get("inkwire-version") !== "1") problems.push("missing Inkwire-Version:1");
    if (e.errorCode && json?.error?.code !== e.errorCode) problems.push(`code ${json?.error?.code}!=${e.errorCode}`);
    if (e.errorCode && !(typeof json?.error?.message === "string" && json.error.message.length > 0)) {
      problems.push("error.message missing or empty");
    }
    for (const [k, v] of Object.entries(e.json ?? {})) if (json?.[k] !== v) problems.push(`${k} ${json?.[k]}!=${v}`);
    if (e.hasUrl && !json?.url) problems.push("no url");
    if (e.hasSlug && !json?.slug) problems.push("no slug");
    if (problems.length) { failed++; console.log(`FAIL ${c.name}: ${problems.join(", ")}`); }
    else console.log(`PASS ${c.name}`);
  } catch (err) { failed++; console.log(`FAIL ${c.name}: ${err.message}`); }
}
console.log(failed ? `\n${failed} case(s) failed` : "\nAll conformance cases passed");
process.exit(failed ? 1 : 0);
