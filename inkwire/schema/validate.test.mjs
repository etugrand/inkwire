import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("./inkwire-post.schema.json", import.meta.url)));
const ajv = addFormats(new Ajv({ allErrors: true }));
const validate = ajv.compile(schema);
const load = (f) => JSON.parse(readFileSync(new URL(`./examples/${f}`, import.meta.url)));

test("valid-minimal passes", () => assert.equal(validate(load("valid-minimal.json")), true));
test("valid-full passes", () => assert.equal(validate(load("valid-full.json")), true));
test("missing title fails", () => {
  assert.equal(validate(load("invalid-missing-title.json")), false);
  assert.ok(validate.errors.some((e) => e.params.missingProperty === "title"));
});
test("partial seo overrides pass", () => {
  assert.equal(validate({ external_id: "seo-1", title: "T", markdown: "x", seo: { noindex: true } }), true);
});
test("unknown seo properties fail", () => {
  assert.equal(validate({ external_id: "seo-2", title: "T", markdown: "x", seo: { keywords: ["x"] } }), false);
});
test("empty seo title and description fail", () => {
  assert.equal(validate({ external_id: "seo-3", title: "T", markdown: "x", seo: { title: "" } }), false);
  assert.equal(validate({ external_id: "seo-4", title: "T", markdown: "x", seo: { description: "" } }), false);
});
test("non-http seo image and null seo fail", () => {
  assert.equal(validate({ external_id: "seo-5", title: "T", markdown: "x", seo: { image_url: "javascript:alert(1)" } }), false);
  assert.equal(validate({ external_id: "seo-6", title: "T", markdown: "x", seo: null }), false);
  assert.equal(validate({ external_id: "seo-7", title: "T", markdown: "x", seo: { title: null } }), false);
  assert.equal(validate({ external_id: "seo-8", title: "T", markdown: "x", seo: { noindex: "false" } }), false);
});
