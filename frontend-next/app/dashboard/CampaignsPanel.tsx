"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  PoeClient,
  CAMPAIGN_MODE,
  type CampaignAccount,
  type CampaignStatusLabel,
} from "@poe/sdk";
import { AddrLink, type Cluster, fmtBps, fmtUnix } from "@/lib/solana-utils";

// ---------------------------------------------------------------------------
// Types (exported so other panels can reuse)
// ---------------------------------------------------------------------------
export interface ParsedCampaign {
  pda: PublicKey;
  acct: CampaignAccount;
  status: CampaignStatusLabel;
  mockScores?: ScoreEntry[];
}

export interface ScoreEntry {
  validator: string;
  scoreBps: number;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
export const BADGE: Record<CampaignStatusLabel, string> = {
  open: "bg-[#0a2330] text-[#67d4ff] border border-[#1d4b5e]",
  settled_success: "bg-[#0d251d] text-[#42efbf] border border-[#1c5948]",
  settled_refund: "bg-[#311516] text-[#ff8f93] border border-[#663035]",
  rfq_expired: "bg-[#271a03] text-[#f5b942] border border-[#5a3e0a]",
};

export function StatusBadge({ label }: { label: CampaignStatusLabel }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${BADGE[label]}`}
    >
      {label.replace(/_/g, " ")}
    </span>
  );
}

function RfqModeBadge() {
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide bg-[#1a1430] text-[#b89cff] border border-[#3d2a7a]">
      RFQ
    </span>
  );
}

// ---------------------------------------------------------------------------
// Campaign row
// ---------------------------------------------------------------------------
function CampaignRow({
  item,
  poeClient,
  cluster,
}: {
  item: ParsedCampaign;
  poeClient: PoeClient | null;
  cluster: Cluster;
}) {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<ScoreEntry[] | null>(
    item.mockScores ?? null,
  );

  const creatorStr = item.acct.creator.toBase58();
  const campaignId = item.acct.campaignId;
  const threshold = item.acct.thresholdBps;
  const reviewerCount = item.acct.validatorCount;
  const isRfq = item.acct.mode === CAMPAIGN_MODE.RFQ;
  const executorSet =
    item.acct.executor.toBase58() !== "11111111111111111111111111111111";

  useEffect(() => {
    if (!open || scores !== null) return;
    if (!poeClient) {
      setScores([]);
      return;
    }
    poeClient
      .queryCampaignStatus(item.acct.creator, campaignId)
      .then((r) =>
        setScores(
          r.scores.map((s) => ({
            validator: s.validator.toBase58(),
            scoreBps: s.scoreBps,
          })),
        ),
      )
      .catch(() => setScores([]));
  }, [open, scores, poeClient, item.acct.creator, campaignId]);

  const avgBps =
    scores && scores.length > 0
      ? Math.round(
          scores.reduce((sum, s) => sum + s.scoreBps, 0) / scores.length,
        )
      : null;
  const willSettle = avgBps !== null && avgBps >= threshold;

  return (
    <div
      className={`poe-panel rounded-xl overflow-hidden transition-colors ${open ? "border-[#25ebbe]" : "border-[#18413a] hover:border-[#2cf0c3]"}`}
    >
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer flex-wrap"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-mono text-sm font-bold text-[#23f0c2] min-w-[5rem]">
          #{String(campaignId)}
        </span>
        <span className="flex-1 truncate">
          <AddrLink address={creatorStr} cluster={cluster} />
        </span>
        <span className="text-xs text-[#85a89f] whitespace-nowrap">
          ⏱ {fmtUnix(item.acct.deadlineUnix)}
        </span>
        {isRfq && <RfqModeBadge />}
        <StatusBadge label={item.status} />
        <span
          className={`text-xs text-[#85a89f] ml-auto transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
      </button>

      {open && (
        <div className="border-t border-[#143833] px-4 py-4 bg-[#070d0c] text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0 mb-4">
            {[
              ["Campaign ID", String(campaignId)],
              ["Mode", isRfq ? "RFQ" : "Direct"],
              ["Status", null],
              ["Creator", creatorStr],
              [
                "Executor",
                executorSet
                  ? item.acct.executor.toBase58()
                  : "(awaiting bid acceptance)",
              ],
              ...(isRfq
                ? [
                    ["RFQ Deadline", fmtUnix(item.acct.rfqDeadlineUnix)] as [
                      string,
                      string,
                    ],
                  ]
                : []),
              ["Amount (raw)", String(item.acct.amount)],
              ["Payout threshold", fmtBps(threshold)],
              ["Deadline", fmtUnix(item.acct.deadlineUnix)],
              ["Reviewers", String(reviewerCount)],
              ["Escrow ATA", item.acct.escrowTokenAccount.toBase58()],
              ["Campaign PDA", item.pda.toBase58()],
            ].map(([label, val]) => {
              const isAddr = [
                "Creator",
                "Executor",
                "Escrow ATA",
                "Campaign PDA",
              ].includes(label as string);
              return (
                <div
                  key={label}
                  className="flex justify-between py-1.5 border-b border-[#122f2b] last:border-none gap-2"
                >
                  <span className="text-[#8caea5] shrink-0">{label}</span>
                  {val === null ? (
                    <StatusBadge label={item.status} />
                  ) : isAddr ? (
                    <AddrLink address={val as string} cluster={cluster} />
                  ) : (
                    <span className="font-mono text-xs break-all text-right text-[#d6f2ea]">
                      {val}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mb-2">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-bold text-[#9bb6af] uppercase tracking-widest">
                Independent Reviewers
              </p>
              <span className="text-xs text-[#7a9c94]">
                🔒 sealed at creation
              </span>
            </div>
            <p className="text-xs text-[#8aaea5] mb-3">
              Needs average reviewer score ≥ {fmtBps(threshold)} across all{" "}
              {reviewerCount} reviewer{reviewerCount !== 1 ? "s" : ""} to pay
              out to the executor.
            </p>

            {scores !== null && scores.length > 0 && avgBps !== null && (
              <div
                className={`flex items-center gap-3 rounded-lg px-3 py-2 mb-3 text-xs font-semibold border ${
                  willSettle
                    ? "bg-[#0d251d] border-[#1c5948] text-[#42efbf]"
                    : "bg-[#1e0e0f] border-[#4a1f22] text-[#ff8f93]"
                }`}
              >
                <span>{willSettle ? "✓" : "✗"}</span>
                <span>
                  {scores.length}/{reviewerCount} reviewed · avg{" "}
                  {fmtBps(avgBps)} · threshold {fmtBps(threshold)}
                  {" · "}
                  {willSettle
                    ? "meets payout threshold"
                    : "below payout threshold"}
                </span>
              </div>
            )}

            {scores === null && (
              <p className="text-xs text-[#8aaea5]">Loading…</p>
            )}
            {scores !== null && scores.length === 0 && (
              <p className="text-xs text-[#8aaea5]">
                No reviews submitted yet.
              </p>
            )}

            {scores !== null &&
              scores.length > 0 &&
              scores.map((s, i) => {
                const approved = s.scoreBps >= threshold;
                return (
                  <div
                    key={s.validator}
                    className="flex items-center gap-3 bg-[#091210] border border-[#163c35] rounded-lg px-3 py-2 mb-1.5"
                  >
                    <span className="text-xs text-[#7fa29a] w-5 shrink-0">
                      #{i + 1}
                    </span>
                    <span className="flex-1 truncate">
                      <AddrLink address={s.validator} cluster={cluster} />
                    </span>
                    <div className="w-24 h-1.5 bg-[#17332f] rounded-full shrink-0">
                      <div
                        className={`h-1.5 rounded-full ${approved ? "bg-[#2af1c3]" : "bg-[#ff7a81]"}`}
                        style={{ width: `${Math.round(s.scoreBps / 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold min-w-[2.75rem] text-right text-[#e5faf4]">
                      {fmtBps(s.scoreBps)}
                    </span>
                    <span
                      className={`text-xs font-bold shrink-0 ${approved ? "text-[#42efbf]" : "text-[#ff8f93]"}`}
                    >
                      {approved ? "✓" : "✗"}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export interface CampaignsPanelProps {
  campaigns: ParsedCampaign[];
  loading: boolean;
  connected: boolean;
  poeClient: PoeClient | null;
  cluster: Cluster;
  isDemo: boolean;
  onRefresh: () => void;
}

export default function CampaignsPanel({
  campaigns,
  loading,
  connected,
  poeClient,
  cluster,
  isDemo,
  onRefresh,
}: CampaignsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[#94b7ae] uppercase tracking-widest">
          All Campaigns
        </span>
        <div className="flex items-center gap-3">
          {campaigns.length > 0 && (
            <span className="text-xs text-[#87aca3]">
              {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
            </span>
          )}
          {connected && (
            <button
              className="text-xs bg-[#0d1b18] text-[#c9e9e0] border border-[#19463e] px-3 py-1 rounded-lg hover:border-[#2af1c3] disabled:opacity-50"
              disabled={loading}
              onClick={onRefresh}
            >
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          )}
        </div>
      </div>

      {isDemo && (
        <div className="bg-[#2d2413] border border-[#654f25] rounded-xl px-4 py-3 text-xs text-[#ffd37a] flex items-center gap-2">
          <span className="font-bold">DEMO</span>
          <span>
            Showing sample campaigns. Connect to a Solana RPC to browse live
            on-chain data.
          </span>
        </div>
      )}

      {loading && (
        <div className="poe-panel rounded-xl py-8 text-center text-sm text-[#8aaea5]">
          <span className="animate-spin inline-block mr-2">⟳</span>Loading
          campaigns…
        </div>
      )}

      {!loading && connected && campaigns.length === 0 && (
        <div className="poe-panel rounded-xl py-8 text-center text-sm text-[#8aaea5]">
          No campaigns found on this cluster.
        </div>
      )}

      {!loading &&
        campaigns.map((item) => (
          <CampaignRow
            key={item.pda.toBase58()}
            item={item}
            poeClient={poeClient}
            cluster={cluster}
          />
        ))}
    </div>
  );
}
