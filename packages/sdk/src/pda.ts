import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants.js";

/** Derive Campaign PDA. Seeds: ["campaign", creator, campaign_id_le] */
export async function findCampaignPda(
  creator: PublicKey,
  campaignId: bigint,
): Promise<[PublicKey, number]> {
  const idBuf = campaignIdBuffer(campaignId);
  return PublicKey.findProgramAddress(
    [Buffer.from("campaign"), creator.toBuffer(), idBuf],
    PROGRAM_ID,
  );
}

/** Derive ValidatorSet PDA. Seeds: ["validator_set", creator, campaign_id_le] */
export async function findValidatorSetPda(
  creator: PublicKey,
  campaignId: bigint,
): Promise<[PublicKey, number]> {
  const idBuf = campaignIdBuffer(campaignId);
  return PublicKey.findProgramAddress(
    [Buffer.from("validator_set"), creator.toBuffer(), idBuf],
    PROGRAM_ID,
  );
}

/** Derive ValidatorScore PDA. Seeds: ["score", campaign_pubkey, validator_pubkey] */
export async function findValidatorScorePda(
  campaignPubkey: PublicKey,
  validatorPubkey: PublicKey,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [
      Buffer.from("score"),
      campaignPubkey.toBuffer(),
      validatorPubkey.toBuffer(),
    ],
    PROGRAM_ID,
  );
}

/** Derive Config PDA. Seeds: ["config"] */
export async function findConfigPda(): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress([Buffer.from("config")], PROGRAM_ID);
}

function campaignIdBuffer(campaignId: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(campaignId);
  return buf;
}
