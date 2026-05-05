import { describe, expect, it } from "vitest";
import { normalizeProofInput } from "../../../agents/validator/src/scoring.js";
import { AdapterError, XMcpAdapter, XMcpClient } from "../src/index.js";

describe("XMcpAdapter", () => {
  it("normalizes MCP output into validator-compatible social proof", async () => {
    const client: XMcpClient = {
      async getPostEngagement() {
        return {
          postUrl: "https://x.com/foo/status/123/",
          authorHandle: "@Alice",
          action: "retweet",
          engagements: 144,
          createdAtUnix: 1700001000,
          evidenceId: "evt_1",
          metadata: {
            lang: "en",
          },
        };
      },
    };

    const adapter = new XMcpAdapter(client);
    const proof = await adapter.fetchProof({
      contentUri: "https://x.com/foo/status/123",
      expectedAction: "repost",
    });

    expect(proof.platform).toBe("x");
    expect(proof.action).toBe("repost");
    expect(proof.actor).toBe("alice");
    expect(proof.contentUri).toBe("https://x.com/foo/status/123");
    expect(proof.evidenceDigestHex).toMatch(/^[0-9a-f]{64}$/);

    // Gate condition for Step 6: validator consumes adapter output as-is.
    const normalized = normalizeProofInput(proof);
    expect(normalized.platform).toBe("x");
    expect(normalized.action).toBe("repost");
    expect(normalized.engagementCount).toBe(144);
  });

  it("retries on transient failures and eventually succeeds", async () => {
    let attempts = 0;

    const client: XMcpClient = {
      async getPostEngagement() {
        attempts += 1;

        if (attempts < 3) {
          const error = new Error("transient");
          (error as Error & { code: string }).code = "ETIMEDOUT";
          throw error;
        }

        return {
          postUrl: "https://x.com/bar/status/1",
          authorHandle: "validator",
          action: "reply",
          engagements: 9,
          createdAtUnix: 1700002000,
        };
      },
    };

    const adapter = new XMcpAdapter(client, {
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    const proof = await adapter.fetchProof({
      contentUri: "https://x.com/bar/status/1",
      expectedAction: "reply",
    });

    expect(attempts).toBe(3);
    expect(proof.action).toBe("reply");
  });

  it("classifies permanent failures and does not retry", async () => {
    let attempts = 0;

    const client: XMcpClient = {
      async getPostEngagement() {
        attempts += 1;
        const error = new Error("forbidden");
        (error as Error & { code: string }).code = "403";
        throw error;
      },
    };

    const adapter = new XMcpAdapter(client, {
      maxAttempts: 5,
      baseDelayMs: 1,
    });

    await expect(
      adapter.fetchProof({
        contentUri: "https://x.com/nope/status/404",
        expectedAction: "reply",
      }),
    ).rejects.toBeInstanceOf(AdapterError);

    expect(attempts).toBe(1);
  });
});
