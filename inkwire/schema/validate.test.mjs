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
