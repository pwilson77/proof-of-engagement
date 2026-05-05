import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { PoeClient, findConfigPda, PROGRAM_ID } from "@poe/sdk";

function loadDefaultKeypair(): Keypair {
  const raw = JSON.parse(
    readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"),
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function initializeConfig(
  connection: Connection,
  authority: Keypair,
  usdcMint: PublicKey,
): Promise<string> {
  const [configPda] = await findConfigPda();
  const existing = await connection.getAccountInfo(configPda);
  if (existing) {
    return "already_initialized";
  }
  const discriminator = Buffer.from([208, 127, 21, 1, 194, 190, 196, 70]);
  const data = Buffer.concat([discriminator, usdcMint.toBuffer()]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [authority]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const mintArg = process.argv[2];
  if (!mintArg) {
    throw new Error("Usage: npm run manual:live -- <MINT_ADDRESS>");
  }

  const connection = new Connection("http://localhost:8899", "confirmed");
  const payer = loadDefaultKeypair();
  const sdk = new PoeClient({ connection, payer });

  const usdcMint = new PublicKey(mintArg);
  const campaignId = BigInt(Math.floor(Date.now() / 1000));
  const taskRef = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
  const deadlineUnix = BigInt(Math.floor(Date.now() / 1000) + 8);

  const creatorAta = new PublicKey(process.env.CREATOR_ATA as string);
  const creatorBalanceBefore =
    await connection.getTokenAccountBalance(creatorAta);

  const initSig = await initializeConfig(connection, payer, usdcMint);
  console.log(`initialize_config sig: ${initSig}`);

  const executor = Keypair.generate().publicKey;
  const validators = [
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
  ];

  const createReceipt = await sdk.createCampaign({
    campaignId,
    executor,
    amount: 1_000_000n,
    taskRef,
    validators,
    thresholdBps: 5000,
    deadlineUnix,
  });
  console.log(`createCampaign sig: ${createReceipt.txSignature}`);

  const statusOpen = await sdk.queryCampaignStatus(payer.publicKey, campaignId);
  console.log(`status after create: ${statusOpen.statusLabel}`);

  let timeoutSig = "";
  for (let i = 0; i < 30; i++) {
    try {
      const receipt = await sdk.triggerTimeoutRefund(
        payer.publicKey,
        campaignId,
        creatorAta,
      );
      timeoutSig = receipt.txSignature;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`timeout attempt ${i + 1}: ${msg}`);
      if (!msg.toLowerCase().includes("custom program error")) {
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!timeoutSig) {
    throw new Error(
      "Failed to trigger timeout refund before retries exhausted",
    );
  }
  console.log(`triggerTimeoutRefund sig: ${timeoutSig}`);

  const statusFinal = await sdk.queryCampaignStatus(
    payer.publicKey,
    campaignId,
  );
  console.log(`final status: ${statusFinal.statusLabel}`);

  const creatorBalanceAfter =
    await connection.getTokenAccountBalance(creatorAta);
  console.log(
    `creator ATA before: ${creatorBalanceBefore.value.uiAmountString}`,
  );
  console.log(
    `creator ATA after : ${creatorBalanceAfter.value.uiAmountString}`,
  );
  console.log(`campaignId       : ${campaignId.toString()}`);
  const deepLink = `http://localhost:5174/dashboard.html?rpc=${encodeURIComponent("http://localhost:8899")}&creator=${payer.publicKey.toBase58()}&campaignId=${campaignId.toString()}`;
  console.log(`dashboard link   : ${deepLink}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
