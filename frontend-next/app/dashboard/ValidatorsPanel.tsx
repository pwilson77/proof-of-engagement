"use client";

import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";
import {
  PoeClient,
  findValidatorScorePda,
  type CampaignStatusLabel,
} from "@/lib/sdk";
import { AddrLink, type Cluster, fmtBps, short } from "@/lib/solana-utils";
import { BADGE, type ParsedCampaign } from "./CampaignsPanel";
import CampaignModal, { type ModalCampaignRow } from "./CampaignModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ReviewEntry {
  campaignId: bigint;
  creator: string;
  campaignPda: string;
  scoreBps: number;
  campaignStatus: CampaignStatusLabel;
  voteTxSig?: string;
}

interface ValidatorRow {
  address: string;
  reviews: ReviewEntry[];
}

// ---------------------------------------------------------------------------
// Derive validators by fetching scores for each campaign
// ---------------------------------------------------------------------------
function useValidators(
  campaigns: ParsedCampaign[],
  poeClient: PoeClient | null,
  connected: boolean,
  rpcUrl: string,
): { validators: ValidatorRow[]; loading: boolean; statusMsg: string } {
  const [validators, setValidators] = useState<ValidatorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!connected || !poeClient || campaigns.length === 0) {
      setValidators([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setStatusMsg("Building validator index…");

    (async () => {
      const conn = new Connection(rpcUrl, "confirmed");
      const map = new Map<string, ReviewEntry[]>();

      for (const item of campaigns) {
        if (cancelled) break;
        setStatusMsg(`Fetching scores for campaign #${item.acct.campaignId}…`);
        try {
          const result = await poeClient.queryCampaignStatus(
            item.acct.creator,
            item.acct.campaignId,
          );
          for (const s of result.scores) {
            const vk = s.validator.toBase58();
            let voteTxSig: string | undefined;
            try {
              const [scorePda] = await findValidatorScorePda(
                item.pda,
                s.validator,
              );
              const sigs = await conn.getSignaturesForAddress(scorePda, {
                limit: 1,
              });
              voteTxSig = sigs[0]?.signature;
            } catch {
              // keep modal usable even if signature lookup fails
            }
            if (!map.has(vk)) map.set(vk, []);
            map.get(vk)!.push({
              campaignId: item.acct.campaignId,
              creator: item.acct.creator.toBase58(),
              campaignPda: item.pda.toBase58(),
              scoreBps: s.scoreBps,
              campaignStatus: item.status,
              voteTxSig,
            });
          }
        } catch {
          // skip campaigns with no score accounts
        }
      }

      if (cancelled) return;
      const rows: ValidatorRow[] = Array.from(map.entries()).map(
        ([address, reviews]) => ({
          address,
          reviews: reviews.sort((a, b) => Number(b.campaignId - a.campaignId)),
        }),
      );
      rows.sort((a, b) => b.reviews.length - a.reviews.length);
      setValidators(rows);
      setStatusMsg(
        `${rows.length} validator${rows.length !== 1 ? "s" : ""} found`,
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [campaigns, poeClient, connected, rpcUrl]);

  return { validators, loading, statusMsg };
}

// ---------------------------------------------------------------------------
// Validator card (grid style)
// ---------------------------------------------------------------------------
function ValidatorCard({
  row,
  cluster,
  onViewCampaigns,
}: {
  row: ValidatorRow;
  cluster: Cluster;
  onViewCampaigns: () => void;
}) {
  const reviewCount = row.reviews.length;
  const avgBps =
    reviewCount > 0
      ? Math.round(
          row.reviews.reduce((s, r) => s + r.scoreBps, 0) / row.reviews.length,
        )
      : null;

  // Status breakdown counts
  const statusCounts = row.reviews.reduce<Record<CampaignStatusLabel, number>>(
    (acc, r) => {
      acc[r.campaignStatus] = (acc[r.campaignStatus] ?? 0) + 1;
      return acc;
    },
    {} as Record<CampaignStatusLabel, number>,
  );

  return (
    <div className="poe-panel rounded-2xl p-5 flex flex-col gap-4 border-[#18413a] hover:border-[#2cf0c3] transition-colors">
      {/* Address */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a8a80] mb-1">
            Validator
          </p>
          <AddrLink address={row.address} cluster={cluster} full />
        </div>
        <span className="text-xl shrink-0 mt-1 text-[#2af1c3]">◉</span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex flex-col">
          <span className="text-[#5a8a80] text-[10px] uppercase tracking-wider">
            Reviews
          </span>
          <span className="font-bold text-[#d6f2ea] text-base">
            {reviewCount}
          </span>
        </div>
        {avgBps !== null && (
          <div className="flex flex-col">
            <span className="text-[#5a8a80] text-[10px] uppercase tracking-wider">
              Avg Score
            </span>
            <span className="font-bold text-[#2af1c3] text-base font-mono">
              {fmtBps(avgBps)}
            </span>
          </div>
        )}
      </div>

      {/* Score bar */}
      {avgBps !== null && (
        <div>
          <div className="h-1.5 bg-[#17332f] rounded-full overflow-hidden">
            <div
              className="h-1.5 rounded-full bg-linear-to-r from-[#08e0b0] to-[#2cf0c3]"
              style={{ width: `${Math.round(avgBps / 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[#5a8a80] mt-1">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
      )}

      {/* Status breakdown */}
      {reviewCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(
            Object.entries(statusCounts) as [CampaignStatusLabel, number][]
          ).map(([label, count]) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE[label]}`}
            >
              <span>{count}×</span>
              <span>{label.replace(/_/g, " ")}</span>
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto pt-2 border-t border-[#122f2b] flex items-center justify-between">
        <span className="text-xs text-[#5a8a80]">
          {reviewCount === 0 ? "No reviews yet" : `${reviewCount} reviewed`}
        </span>
        <button
          onClick={onViewCampaigns}
          className="text-xs font-semibold text-[#2af1c3] hover:text-white border border-[#1c5948] hover:border-[#2af1c3] px-3 py-1.5 rounded-lg transition-colors"
        >
          View Campaigns →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export interface ValidatorsPanelProps {
  campaigns: ParsedCampaign[];
  poeClient: PoeClient | null;
  connected: boolean;
  cluster: Cluster;
  rpcUrl: string;
}

export default function ValidatorsPanel({
  campaigns,
  poeClient,
  connected,
  cluster,
  rpcUrl,
}: ValidatorsPanelProps) {
  const { validators, loading, statusMsg } = useValidators(
    campaigns,
    poeClient,
    connected,
    rpcUrl,
  );
  const [search, setSearch] = useState("");
  const [modalRow, setModalRow] = useState<ValidatorRow | null>(null);

  const filtered = search
    ? validators.filter((v) =>
        v.address.toLowerCase().includes(search.toLowerCase()),
      )
    : validators;

  const modalRows: ModalCampaignRow[] = modalRow
    ? modalRow.reviews.map((r) => ({
        campaignId: r.campaignId,
        creator: r.creator,
        campaignPda: r.campaignPda,
        campaignStatus: r.campaignStatus,
        scoreBps: r.scoreBps,
        voteTxSig: r.voteTxSig,
      }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-[#94b7ae] uppercase tracking-widest flex-1">
          Validators / Reviewers
        </span>
        {statusMsg && (
          <span className="text-xs text-[#8aaea5]">{statusMsg}</span>
        )}
        <input
          type="text"
          placeholder="Filter by address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#07100f] border border-[#19463e] text-[#d6f2ea] placeholder-[#4a7a72] rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#2af1c3] w-48"
        />
      </div>

      {/* States */}
      {!connected && (
        <div className="poe-panel rounded-xl py-8 text-center text-sm text-[#8aaea5]">
          Connect to an RPC endpoint to view validators.
        </div>
      )}
      {connected && loading && (
        <div className="poe-panel rounded-xl py-8 text-center text-sm text-[#8aaea5]">
          <span className="animate-spin inline-block mr-2">⟳</span>
          {statusMsg}
        </div>
      )}
      {connected && !loading && filtered.length === 0 && (
        <div className="poe-panel rounded-xl py-6 text-center text-sm text-[#8aaea5]">
          No validators found.
        </div>
      )}

      {/* Card grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((row) => (
            <ValidatorCard
              key={row.address}
              row={row}
              cluster={cluster}
              onViewCampaigns={() => setModalRow(row)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalRow && (
        <CampaignModal
          title={short(modalRow.address)}
          subtitle={`${modalRow.reviews.length} campaign${modalRow.reviews.length !== 1 ? "s" : ""} reviewed`}
          rows={modalRows}
          mode="validator"
          cluster={cluster}
          onClose={() => setModalRow(null)}
        />
      )}
    </div>
  );
}
