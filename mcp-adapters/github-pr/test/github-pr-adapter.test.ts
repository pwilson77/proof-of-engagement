import { describe, expect, it } from "vitest";
import { GitHubPrAdapter } from "../src/github-pr-adapter.js";
import type { RawEvidence } from "@poe/validator-adapter";

const adapter = new GitHubPrAdapter();

function makeRaw(overrides: Record<string, unknown> = {}): RawEvidence {
  const defaults = {
    pr: {
      number: 42,
      state: "closed",
      merged: true,
      draft: false,
      changed_files: 3,
      additions: 50,
      deletions: 10,
      requested_reviewers: [],
      created_at: "2025-01-01T00:00:00Z",
      merged_at: "2025-01-02T00:00:00Z",
      head: { sha: "abc123def456" },
    },
    reviews: [{ state: "APPROVED", submitted_at: "2025-01-01T12:00:00Z" }],
    checkRuns: [{ status: "completed", conclusion: "success" }],
    ...overrides,
  };
  return {
    domain: "code",
    schemaVersion: 1,
    source: "github.com",
    payloadDigest: "deadbeef".repeat(8),
    raw: defaults as Record<string, unknown>,
  };
}

describe("GitHubPrAdapter — normalize", () => {
  it("extracts fields correctly for merged PR with approval and passing CI", () => {
    const normalized = adapter.normalize(makeRaw());
    const get = (k: string) =>
      normalized.fields.find(([key]) => key === k)?.[1];

    expect(get("merged")).toBe(true);
    expect(get("draft")).toBe(false);
    expect(get("approvals")).toBe(1);
    expect(get("changes_requested")).toBe(0);
    expect(get("ci_passed")).toBe(true);
    expect(get("ci_failed")).toBe(false);
  });

  it("fields are sorted alphabetically for determinism", () => {
    const normalized = adapter.normalize(makeRaw());
    const keys = normalized.fields.map(([k]) => k);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});

describe("GitHubPrAdapter — score", () => {
  it("scores high for merged PR, approval, passing CI", () => {
    const normalized = adapter.normalize(makeRaw());
    const score = adapter.score(normalized);
    expect(score).toBeGreaterThanOrEqual(8000);
  });

  it("scores low for open draft with CI failure and changes requested", () => {
    const normalized = adapter.normalize(
      makeRaw({
        pr: {
          number: 1,
          state: "open",
          merged: false,
          draft: true,
          changed_files: 1,
          additions: 5,
          deletions: 0,
          requested_reviewers: [],
          created_at: "2025-01-01T00:00:00Z",
          merged_at: null,
          head: { sha: "000000000000" },
        },
        reviews: [
          { state: "CHANGES_REQUESTED", submitted_at: "2025-01-01T12:00:00Z" },
        ],
        checkRuns: [{ status: "completed", conclusion: "failure" }],
      }),
    );
    const score = adapter.score(normalized);
    expect(score).toBeLessThan(2000);
  });

  it("score is clamped to [0, 10000]", () => {
    const normalized = adapter.normalize(makeRaw());
    const score = adapter.score(normalized);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10_000);
  });

  it("same input always yields same score (determinism)", () => {
    const raw = makeRaw();
    const s1 = adapter.score(adapter.normalize(raw));
    const s2 = adapter.score(adapter.normalize(raw));
    expect(s1).toBe(s2);
  });
});

describe("GitHubPrAdapter — classifyFailure", () => {
  it("classifies 401 as auth", () => {
    expect(
      adapter.classifyFailure(new Error("GitHub API 401 Unauthorized: ...")),
    ).toBe("auth");
  });
  it("classifies 404 as not_found", () => {
    expect(
      adapter.classifyFailure(new Error("GitHub API 404 Not Found: ...")),
    ).toBe("not_found");
  });
  it("classifies 429 as rate_limited", () => {
    expect(adapter.classifyFailure(new Error("rate limit exceeded"))).toBe(
      "rate_limited",
    );
  });
  it("classifies 422 as invalid_input", () => {
    expect(
      adapter.classifyFailure(new Error("GitHub API 422 Unprocessable: ...")),
    ).toBe("invalid_input");
  });
  it("classifies ECONNRESET as retryable", () => {
    expect(adapter.classifyFailure(new Error("ECONNRESET"))).toBe("retryable");
  });
});
