export type InkwireCode = "invalid_payload" | "unauthorized" | "conflict" | "rate_limited" | "internal";
const HTTP: Record<InkwireCode, number> = {
  invalid_payload: 400, unauthorized: 401, conflict: 409, rate_limited: 429, internal: 500,
};
export class InkwireError extends Error {
  constructor(public code: InkwireCode, message: string) { super(message); }
  get httpStatus() { return HTTP[this.code]; }
}
