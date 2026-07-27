import { timingSafeEqual } from "node:crypto";
import { InkwireError } from "./errors";
function eq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
export function authorize(authHeader: string | undefined, apiKeys: string[]): string {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const match = apiKeys.find((k) => eq(k, token));
  if (!match) throw new InkwireError("unauthorized", "missing or invalid API key");
  return match;
}
