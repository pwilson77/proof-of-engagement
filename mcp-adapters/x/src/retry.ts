import { AdapterError } from "./errors.js";
import { FailureClass, RetryPolicy } from "./types.js";

const DEFAULT_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 150,
};

function shouldRetry(failureClass: FailureClass): boolean {
  return failureClass === "retryable" || failureClass === "rate_limited";
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  classify: (error: unknown) => FailureClass,
  policy: Partial<RetryPolicy> = {},
): Promise<T> {
  const merged = { ...DEFAULT_POLICY, ...policy };
  let attempt = 0;

  while (attempt < merged.maxAttempts) {
    attempt += 1;

    try {
      return await operation();
    } catch (error) {
      const failureClass = classify(error);
      const retryable = shouldRetry(failureClass);
      const exhausted = attempt >= merged.maxAttempts;

      if (!retryable || exhausted) {
        throw new AdapterError(
          `adapter request failed after ${attempt} attempt(s): ${failureClass}`,
          failureClass,
          error,
        );
      }

      const waitMs = merged.baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw new AdapterError("adapter request failed unexpectedly", "fatal");
}
