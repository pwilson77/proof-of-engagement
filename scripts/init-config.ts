/**
 * init-config.ts — Initialise the PoE Config PDA on any cluster.
 *
 * Usage:
 *   MINT=<token-mint-address> npx tsx init-config.ts
 *
 * Reads the cluster from the active `solana config`.
 * No-ops if Config is already initialised.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { sha256 } from "@noble/hashes/sha2.js";
import { findConfigPda, PROGRAM_ID } from "@poe/sdk";

function disc(name: string): Buffer {
  return Buffer.from(
    sha256(new TextEncoder().encode(`global:${name}`)),
  ).subarray(0, 8);
}

const DISC_INIT_CONFIG = disc("initialize_config");

function loadDefaultKeypair(): Keypair {
  const raw = JSON.parse(
    readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"),
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function getRpcUrl(): string {
  try {
    const out = execSync("solana config get", { encoding: "utf8" });
    const match = out.match(/RPC URL:\s+(\S+)/);
    if (match) return match[1];
  } catch {
    // fall through
  }
  return "https://api.devnet.solana.com";
}

async function main() {
  const mintArg = process.env.MINT;
  if (!mintArg) throw new Error("Set MINT=<token-mint-pubkey> env variable.");

  const rpc = getRpcUrl();
  const connection = new Connection(rpc, "confirmed");
  const payer = loadDefaultKeypair();
  const usdcMint = new PublicKey(mintArg);

  console.log("  RPC:      ", rpc);
  console.log("  authority:", payer.publicKey.toBase58());
  console.log("  mint:     ", usdcMint.toBase58());

  const [configPda] = await findConfigPda();
  console.log("  configPda:", configPda.toBase58());

  const existing = await connection.getAccountInfo(configPda);
  if (existing) {
    console.log("  ✓ Config already initialised — skipping.");
    return;
  }

  const data = Buffer.concat([DISC_INIT_CONFIG, usdcMint.toBuffer()]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("  ✓ Config initialised — tx:", sig);
}

main().catch((e) => {
  console.error("init-config failed:", e);
  process.exit(1);
});
