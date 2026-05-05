import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  SettlementClient,
  SubmitAttestationRequest,
  SubmissionReceipt,
} from "./types.js";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export class LocalValidatorSettlementClient implements SettlementClient {
  constructor(
    private readonly connection: Connection,
    private readonly payer: Keypair,
  ) {}

  async submitExecutorAttestation(
    request: SubmitAttestationRequest,
  ): Promise<SubmissionReceipt> {
    // Attach the attestation digest to chain as a memo. This gives us a real
    // local-validator submission handshake without changing program state.
    const memoPayload = JSON.stringify({
      campaignId: request.campaignId.toString(),
      payloadDigestHex: request.signedAttestation.payloadDigestHex,
      signer: request.signedAttestation.signer,
    });

    const memoIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoPayload, "utf8"),
    });

    const tx = new Transaction().add(memoIx);
    const txSignature = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.payer],
      {
        commitment: "confirmed",
      },
    );

    return {
      txSignature,
      submittedAtUnix: Math.floor(Date.now() / 1000),
    };
  }
}
