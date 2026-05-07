/**
 * @poe/validator-adapter
 *
 * Generic adapter interface for validator evidence ingestion.
 * Any validator domain (social, code review, commerce, etc.) implements
 * ValidatorAdapter and plugs into the consensus flow without on-chain changes.
 */

// ---------------------------------------------------------------------------
// Evidence types
// ---------------------------------------------------------------------------

export type EvidenceDomain = "social" | "code" | "commerce" | "custom";

/** Raw evidence as returned by the external source (not yet normalised). */
export interface RawEvidence {
  domain: EvidenceDomain;
  /** Semver-style schema version, e.g. 1 for initial release. */
  schemaVersion: number;
  /** Identifies the external data source, e.g. "github.com", "x.com". */
  source: string;
  /**
   * SHA-256 hex digest of the raw payload. Stored on-chain as the
   * ValidatorScore proof commitment — the raw payload stays off-chain.
   */
  payloadDigest: string;
  /** Structured raw payload, schema defined per adapter. */
  raw: Record<string, unknown>;
}

/** Normalised evidence ready for deterministic scoring. */
export interface NormalizedEvidence {
  domain: EvidenceDomain;
  schemaVersion: number;
  source: string;
  payloadDigest: string;
  /** Adapter-specific normalized fields (sorted keys for determinism). */
  fields: Array<[string, string | number | boolean]>;
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type FailureClass =
  | "retryable"
  | "rate_limited"
  | "auth"
  | "not_found"
  | "invalid_input"
  | "fatal";

// ---------------------------------------------------------------------------
// Adapter context
// ---------------------------------------------------------------------------

/**
 * Context passed to fetchEvidence. Adapters extract what they need
 * (e.g. a GitHub PR URL, an X post URL, an order ID).
 */
export interface AdapterContext {
  /** 32-byte hex task reference set at campaign creation. */
  taskRefHex: string;
  /** Free-form key/value context from the executor attestation. */
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Domain-specific scoring policy passed to score().
 * Adapters define their own policy shape; callers should cast.
 */
export type ScoringPolicy = Record<string, unknown>;

// ---------------------------------------------------------------------------
// ValidatorAdapter interface
// ---------------------------------------------------------------------------

/**
 * Implement this interface for each evidence domain.
 *
 * Lifecycle:
 *   1. fetchEvidence  → RawEvidence (calls external API, may throw)
 *   2. normalize      → NormalizedEvidence (deterministic, no I/O)
 *   3. score          → number 0–10000 bps (deterministic, no I/O)
 *   4. classifyFailure → FailureClass (called if fetchEvidence throws)
 *
 * All methods are sync except fetchEvidence.
 */
export interface ValidatorAdapter {
  /** Machine-readable name, e.g. "x-social", "github-pr-review". */
  readonly name: string;
  readonly domain: EvidenceDomain;

  fetchEvidence(taskRef: string, context: AdapterContext): Promise<RawEvidence>;

  normalize(raw: RawEvidence): NormalizedEvidence;

  /**
   * Returns a score in basis points (0–10000).
   * Must be deterministic: same input always produces same output.
   */
  score(normalized: NormalizedEvidence, policy?: ScoringPolicy): number;

  classifyFailure(error: unknown): FailureClass;
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

/**
 * Simple runtime registry mapping adapter name → adapter instance.
 * Used by ValidatorAgent to resolve which adapter handles a given task.
 */
export class AdapterRegistry {
  private readonly map = new Map<string, ValidatorAdapter>();

  register(adapter: ValidatorAdapter): this {
    this.map.set(adapter.name, adapter);
    return this;
  }

  get(name: string): ValidatorAdapter | undefined {
    return this.map.get(name);
  }

  list(): ValidatorAdapter[] {
    return Array.from(this.map.values());
  }
}
