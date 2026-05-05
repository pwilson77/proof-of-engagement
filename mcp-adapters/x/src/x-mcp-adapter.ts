import { createHash } from "node:crypto";
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

export class XMcpAdapter {
  constructor(
    private readonly client: XMcpClient,
    private readonly retryPolicy?: Partial<RetryPolicy>,
  ) {}

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
