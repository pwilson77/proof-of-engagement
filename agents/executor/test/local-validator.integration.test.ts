import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn, ChildProcess } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  ExecutorAgent,
  LocalValidatorSettlementClient,
  verifyAttestation,
} from "../src/index.js";

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to get free port")));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForRpc(connection: Connection, retries = 60): Promise<void> {
  for (let i = 0; i < retries; i += 1) {
    try {
      await connection.getLatestBlockhash("confirmed");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("local validator RPC did not become ready in time");
}

interface LocalValidatorHandle {
  process: ChildProcess;
  ledgerDir: string;
  rpcUrl: string;
}

async function startLocalValidator(): Promise<LocalValidatorHandle> {
  const ledgerDir = await mkdtemp(join(tmpdir(), "poe-executor-ledger-"));
  const rpcPort = await findFreePort();
  const faucetPort = await findFreePort();

  const process = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger",
      ledgerDir,
      "--rpc-port",
      String(rpcPort),
      "--faucet-port",
      String(faucetPort),
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );

  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  const connection = new Connection(rpcUrl, "confirmed");
  await waitForRpc(connection);

  return { process, ledgerDir, rpcUrl };
}

async function stopLocalValidator(handle: LocalValidatorHandle): Promise<void> {
  if (!handle.process.killed) {
    handle.process.kill("SIGTERM");
  }

  await new Promise<void>((resolve) => {
    handle.process.once("exit", () => resolve());
    setTimeout(() => resolve(), 3000);
  });

  await rm(handle.ledgerDir, { recursive: true, force: true });
}

describe("ExecutorAgent local-validator integration", () => {
  let handle: LocalValidatorHandle | undefined;

  afterAll(async () => {
    if (handle) {
      await stopLocalValidator(handle);
    }
  });

  it("submits executor attestation over RPC and returns a confirmed tx signature", async () => {
    handle = await startLocalValidator();

    const connection = new Connection(handle.rpcUrl, "confirmed");
    const signer = Keypair.generate();

    const airdropSig = await connection.requestAirdrop(
      signer.publicKey,
      2 * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    const settlementClient = new LocalValidatorSettlementClient(
      connection,
      signer,
    );
    const agent = new ExecutorAgent({ signer, settlementClient });

    const result = await agent.executeCampaign(
      {
        campaignId: 123n,
        executor: signer.publicKey.toBase58(),
        taskRefHex: "34".repeat(32),
      },
      {
        platform: "x",
        contentUri: "https://x.com/example/status/1",
        action: "retweet",
        evidenceDigestHex: "56".repeat(32),
      },
    );

    expect(result.receipt.txSignature.length).toBeGreaterThan(20);
    expect(verifyAttestation(result.attestation)).toBe(true);

    const status = await connection.getSignatureStatus(
      result.receipt.txSignature,
    );
    expect(status.value?.confirmationStatus).toMatch(/confirmed|finalized/);
    expect(status.value?.err).toBeNull();
  }, 120_000);
});
