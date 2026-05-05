import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ScoreSubmissionClient,
  ScoreSubmissionReceipt,
  SubmitScoreRequest,
} from "./types.js";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export class LocalValidatorScoreClient implements ScoreSubmissionClient {
  constructor(
    private readonly connection: Connection,
    private readonly payer: Keypair,
  ) {}

  async submitValidatorScore(
    request: SubmitScoreRequest,
  ): Promise<ScoreSubmissionReceipt> {
    const memoPayload = JSON.stringify({
      campaignId: request.campaignId.toString(),
      scoreBps: request.scoreBps,
      payloadDigestHex: request.signedScore.payloadDigestHex,
      signer: request.signedScore.signer,
    });

    const memoIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoPayload, "utf8"),
    });

    const tx = new Transaction().add(memoIx);
    const txSignature = await sendAndConfirmTransaction(this.connection, tx, [this.payer], {
      commitment: "confirmed",
    });

    return {
      txSignature,
      submittedAtUnix: Math.floor(Date.now() / 1000),
    };
  }
}
