import { createHash } from "node:crypto";
import type {
  ValidatorAdapter,
  RawEvidence,
  NormalizedEvidence,
  AdapterContext,
  ScoringPolicy,
} from "@poe/validator-adapter";
import { classifyFailure } from "./errors.js";
import { withRetry } from "./retry.js";
import { AdapterFetchInput, RetryPolicy, SocialProof, XMcpClient } from "./types.js";

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function normalizeAction(action: string): string {
  const lowered = action.trim().toLowerCase();
  if (lowered === "retweet") {
    return "repost";
  }
  return lowered;
}

function normalizeActor(actor: string): string {
  return actor.trim().toLowerCase().replace(/^@/, "");
}

function buildEvidenceDigestHex(input: {
  contentUri: string;
  action: string;
  actor: string;
  engagements: number;
  createdAtUnix: number;
  evidenceId?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        contentUri: input.contentUri,
        action: input.action,
        actor: input.actor,
        engagements: input.engagements,
        createdAtUnix: input.createdAtUnix,
        evidenceId: input.evidenceId ?? "",
      }),
    )
    .digest("hex");
}

export class XMcpAdapter implements ValidatorAdapter {
  readonly name = "x-social";
  readonly domain = "social" as const;

  constructor(
    private readonly client: XMcpClient,
    private readonly retryPolicy?: Partial<RetryPolicy>,
  ) {}

  // ---------------------------------------------------------------------------
  // ValidatorAdapter implementation
  // ---------------------------------------------------------------------------

  async fetchEvidence(taskRef: string, ctx: AdapterContext): Promise<RawEvidence> {
    // taskRef is a 32-byte hex string; derive contentUri from ctx params or taskRef
    const contentUri = ctx.params["contentUri"] ?? Buffer.from(taskRef, "hex").toString("utf8").replace(/\0+$/, "");
    const expectedAction = ctx.params["expectedAction"] ?? "like";
    const raw = await this.fetchProof({ contentUri, expectedAction });
    return {
      domain: this.domain,
      schemaVersion: 1,
      source: "x.com",
      payloadDigest: raw.evidenceDigestHex,
      raw: raw as unknown as Record<string, unknown>,
    };
  }

  normalize(raw: RawEvidence): NormalizedEvidence {
    const proof = raw.raw as unknown as SocialProof;
    const fields: Array<[string, string | number | boolean]> = [
      ["action", proof.action],
      ["actor", proof.actor],
      ["contentUri", proof.contentUri],
      ["createdAtUnix", proof.createdAtUnix],
      ["engagementCount", proof.engagementCount],
      ["platform", proof.platform],
    ];
    // fields are already sorted alphabetically
    return {
      domain: raw.domain,
      schemaVersion: raw.schemaVersion,
      source: raw.source,
      payloadDigest: raw.payloadDigest,
      fields,
    };
  }

  score(normalized: NormalizedEvidence, policy?: ScoringPolicy): number {
    const engagements = Number(normalized.fields.find(([k]) => k === "engagementCount")?.[1] ?? 0);
    const min = typeof policy?.["minEngagements"] === "number" ? policy["minEngagements"] : 1;
    const base = 5000;
    if (engagements <= 0) return 0;
    if (engagements < min) return Math.round((engagements / min) * base * 0.5);
    return Math.min(10000, base + Math.round(Math.log2(engagements / min + 1) * 1000));
  }

  classifyFailure(error: unknown): "retryable" | "rate_limited" | "auth" | "not_found" | "invalid_input" | "fatal" {
    return classifyFailure(error);
  }

  // ---------------------------------------------------------------------------
  // Legacy fetchProof API (kept for backward compatibility)
  // ---------------------------------------------------------------------------

  async fetchProof(input: AdapterFetchInput): Promise<SocialProof> {
    const contentUri = normalizeUrl(input.contentUri);
    const expectedAction = normalizeAction(input.expectedAction);

    const record = await withRetry(
      () => this.client.getPostEngagement(contentUri),
      classifyFailure,
      this.retryPolicy,
    );

    const normalizedAction = normalizeAction(record.action);
    const actor = normalizeActor(record.authorHandle);

    if (normalizeUrl(record.postUrl) !== contentUri) {
      throw new Error("adapter response postUrl does not match requested URI");
    }

    if (normalizedAction !== expectedAction) {
      throw new Error("adapter response action does not match expected action");
    }

    const engagementCount = Math.max(0, Math.floor(record.engagements));
    const createdAtUnix = Math.max(0, Math.floor(record.createdAtUnix));

    return {
      platform: "x",
      contentUri,
      action: normalizedAction,
      actor,
      engagementCount,
      createdAtUnix,
      evidenceDigestHex: buildEvidenceDigestHex({
        contentUri,
        action: normalizedAction,
        actor,
        engagements: engagementCount,
        createdAtUnix,
        evidenceId: record.evidenceId,
      }),
      metadata: {
        source: "x-mcp-adapter",
        ...record.metadata,
      },
    };
  }
}
