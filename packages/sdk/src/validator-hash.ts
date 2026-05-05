import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";

/**
 * Compute the canonical validator set hash used on-chain.
 *
 * Mirrors Rust:
 *   let mut validator_bytes: Vec<[u8; 32]> = validators.iter().map(|v| v.to_bytes()).collect();
 *   validator_bytes.sort_unstable();
 *   hashv(&chunks).to_bytes()
 *
 * `hashv` is Solana's SHA-256 over the concatenation of all slices.
 */
export function canonicalValidatorHash(validators: PublicKey[]): Uint8Array {
  const sorted = validators
    .map((v) => v.toBytes())
    .sort((a, b) => {
      for (let i = 0; i < 32; i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

  const hash = sha256(concatBytes(...sorted));
  return hash;
}
