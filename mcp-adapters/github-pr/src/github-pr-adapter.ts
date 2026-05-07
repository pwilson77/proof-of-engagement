import { createHash } from "node:crypto";
import type {
  AdapterContext,
  EvidenceDomain,
  FailureClass,
  NormalizedEvidence,
  RawEvidence,
  ScoringPolicy,
  ValidatorAdapter,
} from "@poe/validator-adapter";

// ---------------------------------------------------------------------------
// GitHub API types (minimal — only fields we use)
// ---------------------------------------------------------------------------

interface GitHubPr {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  changed_files: number;
  additions: number;
  deletions: number;
  requested_reviewers: unknown[];
  created_at: string;
  merged_at: string | null;
  head: { sha: string };
}

interface GitHubReview {
  state:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "COMMENTED"
    | "DISMISSED"
    | "PENDING";
  submitted_at: string;
}

interface GitHubCheckRun {
  status: "queued" | "in_progress" | "completed";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
}

export interface GitHubPrEvidence {
  pr: GitHubPr;
  reviews: GitHubReview[];
  checkRuns: GitHubCheckRun[];
}

// ---------------------------------------------------------------------------
// Scoring policy
// ---------------------------------------------------------------------------

export interface GitHubPrScoringPolicy extends ScoringPolicy {
  /** Minimum approved review count for full score. Default: 1 */
  minApprovals?: number;
  /** Whether a passing CI is required for a high score. Default: true */
  requireCiPass?: boolean;
  /** Penalise if PR is still a draft. Default: true */
  penaliseDraft?: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GitHubPrAdapter implements ValidatorAdapter {
  readonly name = "github-pr-review";
  readonly domain: EvidenceDomain = "code";

  constructor(
    /** GitHub personal access token (read-only, public_repo scope). */
    private readonly token?: string,
    /** Optional base URL override for GitHub Enterprise. */
    private readonly apiBase = "https://api.github.com",
  ) {}

  // -------------------------------------------------------------------------
  // fetchEvidence
  // -------------------------------------------------------------------------
  /**
   * Fetches PR metadata, reviews, and CI check runs from GitHub.
   *
   * Context params expected:
   *   owner  — repository owner, e.g. "octocat"
   *   repo   — repository name, e.g. "hello-world"
   *   pr     — pull request number, e.g. "42"
   */
  async fetchEvidence(
    _taskRef: string,
    context: AdapterContext,
  ): Promise<RawEvidence> {
    const { owner, repo, pr: prNum } = context.params;

    if (!owner || !repo || !prNum) {
      throw new Error(
        "GitHubPrAdapter requires context.params: owner, repo, pr",
      );
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const [prData, reviewsData, checksData] = await Promise.all([
      this.fetch<GitHubPr>(
        `${this.apiBase}/repos/${owner}/${repo}/pulls/${prNum}`,
        headers,
      ),
      this.fetch<GitHubReview[]>(
        `${this.apiBase}/repos/${owner}/${repo}/pulls/${prNum}/reviews`,
        headers,
      ),
      this.fetch<{ check_runs: GitHubCheckRun[] }>(
        `${this.apiBase}/repos/${owner}/${repo}/commits/${prNum}/check-runs`,
        headers,
      )
        .then((r) => r.check_runs)
        .catch(() => [] as GitHubCheckRun[]),
    ]);

    const payload: GitHubPrEvidence = {
      pr: prData,
      reviews: reviewsData,
      checkRuns: checksData,
    };

    const payloadDigest = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    return {
      domain: "code",
      schemaVersion: 1,
      source: "github.com",
      payloadDigest,
      raw: payload as unknown as Record<string, unknown>,
    };
  }

  // -------------------------------------------------------------------------
  // normalize
  // -------------------------------------------------------------------------

  normalize(raw: RawEvidence): NormalizedEvidence {
    const { pr, reviews, checkRuns } = raw.raw as unknown as GitHubPrEvidence;

    const approvals = reviews.filter((r) => r.state === "APPROVED").length;
    const changesRequested = reviews.filter(
      (r) => r.state === "CHANGES_REQUESTED",
    ).length;
    const ciPassed =
      checkRuns.length > 0 &&
      checkRuns.every(
        (c) => c.status === "completed" && c.conclusion === "success",
      );
    const ciFailed = checkRuns.some(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
    );

    const fields: Array<[string, string | number | boolean]> = [
      ["state", pr.state],
      ["merged", pr.merged],
      ["draft", pr.draft],
      ["changed_files", pr.changed_files],
      ["additions", pr.additions],
      ["deletions", pr.deletions],
      ["approvals", approvals],
      ["changes_requested", changesRequested],
      ["ci_passed", ciPassed],
      ["ci_failed", ciFailed],
      ["head_sha", pr.head.sha.slice(0, 12)],
    ];

    // Sort for determinism
    fields.sort(([a], [b]) => a.localeCompare(b));

    return {
      domain: raw.domain,
      schemaVersion: raw.schemaVersion,
      source: raw.source,
      payloadDigest: raw.payloadDigest,
      fields,
    };
  }

  // -------------------------------------------------------------------------
  // score
  // -------------------------------------------------------------------------

  score(
    normalized: NormalizedEvidence,
    policy: GitHubPrScoringPolicy = {},
  ): number {
    const {
      minApprovals = 1,
      requireCiPass = true,
      penaliseDraft = true,
    } = policy;

    const get = <T>(key: string): T =>
      normalized.fields.find(([k]) => k === key)?.[1] as T;

    const approvals = get<number>("approvals") ?? 0;
    const changesRequested = get<number>("changes_requested") ?? 0;
    const merged = get<boolean>("merged") ?? false;
    const draft = get<boolean>("draft") ?? false;
    const ciPassed = get<boolean>("ci_passed") ?? false;
    const ciFailed = get<boolean>("ci_failed") ?? false;

    let score = 5000;

    // Merge bonus — work was actually completed
    if (merged) score += 2000;

    // Approval score
    if (approvals >= minApprovals) {
      score += 1500;
    } else {
      score -= 2000;
    }

    // Changes-requested penalty
    score -= changesRequested * 800;

    // CI result
    if (requireCiPass) {
      if (ciPassed) score += 1000;
      if (ciFailed) score -= 2500;
    } else if (ciFailed) {
      score -= 500;
    }

    // Draft penalty
    if (penaliseDraft && draft) score -= 3000;

    return Math.max(0, Math.min(10_000, score));
  }

  // -------------------------------------------------------------------------
  // classifyFailure
  // -------------------------------------------------------------------------

  classifyFailure(error: unknown): FailureClass {
    if (!(error instanceof Error)) return "fatal";
    const msg = error.message;

    if (msg.includes("401") || msg.includes("403")) return "auth";
    if (msg.includes("404")) return "not_found";
    if (msg.includes("429") || msg.includes("rate limit"))
      return "rate_limited";
    if (msg.includes("422")) return "invalid_input";
    if (
      msg.includes("5") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT")
    )
      return "retryable";

    return "fatal";
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetch<T>(
    url: string,
    headers: Record<string, string>,
  ): Promise<T> {
    const resp = await globalThis.fetch(url, { headers });

    if (!resp.ok) {
      throw new Error(`GitHub API ${resp.status} ${resp.statusText}: ${url}`);
    }

    return resp.json() as Promise<T>;
  }
}
