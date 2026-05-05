export interface XMcpEngagementRecord {
  postUrl: string;
  authorHandle: string;
  action: string;
  engagements: number;
  createdAtUnix: number;
  evidenceId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AdapterFetchInput {
  contentUri: string;
  expectedAction: string;
}

export interface SocialProof {
  platform: "x";
  contentUri: string;
  action: string;
  actor: string;
  evidenceDigestHex: string;
  engagementCount: number;
  createdAtUnix: number;
  metadata: Record<string, string | number | boolean>;
}

export interface XMcpClient {
  getPostEngagement(postUrl: string): Promise<XMcpEngagementRecord>;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export type FailureClass =
  | "retryable"
  | "rate_limited"
  | "auth"
  | "not_found"
  | "invalid_input"
  | "fatal";
