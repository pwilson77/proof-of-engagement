import { FailureClass } from "./types.js";

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly failureClass: FailureClass,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function classifyFailure(error: unknown): FailureClass {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code).toLowerCase()
      : "";

  if (
    code.includes("timeout") ||
    code.includes("timedout") ||
    code.includes("etimedout") ||
    code.includes("econnreset") ||
    code.includes("503")
  ) {
    return "retryable";
  }

  if (code.includes("rate") || code.includes("429")) {
    return "rate_limited";
  }

  if (code.includes("401") || code.includes("403") || code.includes("auth")) {
    return "auth";
  }

  if (code.includes("404") || code.includes("not_found")) {
    return "not_found";
  }

  if (code.includes("bad_request") || code.includes("400") || code.includes("invalid")) {
    return "invalid_input";
  }

  return "fatal";
}
