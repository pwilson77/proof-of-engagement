"use client";

import { useMemo, useState } from "react";
import { type CampaignStatusLabel } from "@poe/sdk";
import {
  AddrLink,
  type Cluster,
  fmtBps,
  fmtUnix,
  short,
} from "@/lib/solana-utils";
import { BADGE, type ParsedCampaign } from "./CampaignsPanel";
import CampaignModal, { type ModalCampaignRow } from "./CampaignModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ExecutionEntry {
  campaignId: bigint;
  creator: string;
  campaignPda: string;
  amount: bigint;
  thresholdBps: number;
  deadlineUnix: bigint;
  campaignStatus: CampaignStatusLabel;
}

interface ExecutorRow {
  address: string;
  executions: ExecutionEntry[];
}

// ---------------------------------------------------------------------------
// Derive executors from already-fetched campaigns (no extra RPC calls)
// ---------------------------------------------------------------------------
function deriveExecutors(campaigns: ParsedCampaign[]): ExecutorRow[] {
  const map = new Map<string, ExecutionEntry[]>();
  for (const item of campaigns) {
    const executorStr = item.acct.executor.toBase58();
    if (!map.has(executorStr)) map.set(executorStr, []);
    map.get(executorStr)!.push({
      campaignId: item.acct.campaignId,
      creator: item.acct.creator.toBase58(),
      campaignPda: item.pda.toBase58(),
      amount: item.acct.amount,
      thresholdBps: item.acct.thresholdBps,
      deadlineUnix: item.acct.deadlineUnix,
      campaignStatus: item.status,
    });
  }
  const rows: ExecutorRow[] = Array.from(map.entries()).map(
    ([address, executions]) => ({
      address,
      executions: executions.sort((a, b) =>
        Number(b.campaignId - a.campaignId),
      ),
    }),
  );
  rows.sort((a, b) => b.executions.length - a.executions.length);
  return rows;
}

// ---------------------------------------------------------------------------
// Executor card (grid style)
// ---------------------------------------------------------------------------
function ExecutorCard({
  row,
  cluster,
  onViewCampaigns,
}: {
  row: ExecutorRow;
  cluster: Cluster;
  onViewCampaigns: () => void;
}) {
  const total = row.executions.length;
  const successes = row.executions.filter(
    (e) => e.campaignStatus === "settled_success",
  ).length;
  const refunds = row.executions.filter(
    (e) => e.campaignStatus === "settled_refund",
  ).length;
  const open = row.executions.filter((e) => e.campaignStatus === "open").length;
  const totalEarned = row.executions
    .filter((e) => e.campaignStatus === "settled_success")
    .reduce((s, e) => s + e.amount, 0n);
  const successRate = total > 0 ? Math.round((successes / total) * 100) : 0;

  return (
    <div className="poe-panel rounded-2xl p-5 flex flex-col gap-4 border-[#18413a] hover:border-[#2cf0c3] transition-colors">
      {/* Address */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a8a80] mb-1">
            Executor
          </p>
          <AddrLink address={row.address} cluster={cluster} full />
        </div>
        <span className="text-xl shrink-0 mt-1 text-[#2af1c3]">◎</span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <div className="flex flex-col">
          <span className="text-[#5a8a80] text-[10px] uppercase tracking-wider">
            Campaigns
          </span>
          <span className="font-bold text-[#d6f2ea] text-base">{total}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[#5a8a80] text-[10px] uppercase tracking-wider">
            Settled
          </span>
          <span className="font-bold text-[#2af1c3] text-base font-mono">
            {successes}/{total}
          </span>
        </div>
        {totalEarned > 0n && (
          <div className="flex flex-col">
            <span className="text-[#5a8a80] text-[10px] uppercase tracking-wider">
              Earned
            </span>
            <span className="font-bold text-[#d6f2ea] text-sm font-mono">
              {String(totalEarned)}
            </span>
          </div>
        )}
      </div>

      {/* Success rate bar */}
      {total > 0 && (
        <div>
          <div className="h-1.5 bg-[#17332f] rounded-full overflow-hidden">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-[#08e0b0] to-[#2cf0c3]"
              style={{ width: `${successRate}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[#5a8a80] mt-1">
            <span>Success rate</span>
            <span>{successRate}%</span>
          </div>
        </div>
      )}

      {/* Status breakdown */}
      <div className="flex flex-wrap gap-1.5">
        {open > 0 && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE["open"]}`}
          >
            {open}× open
          </span>
        )}
        {successes > 0 && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE["settled_success"]}`}
          >
            {successes}× settled
          </span>
        )}
        {refunds > 0 && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE["settled_refund"]}`}
          >
            {refunds}× refunded
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto pt-2 border-t border-[#122f2b] flex items-center justify-between">
        <span className="text-xs text-[#5a8a80]">
          {total} campaign{total !== 1 ? "s" : ""}
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
export interface ExecutorsPanelProps {
  campaigns: ParsedCampaign[];
  connected: boolean;
  cluster: Cluster;
}

export default function ExecutorsPanel({
  campaigns,
  connected,
  cluster,
}: ExecutorsPanelProps) {
  const [search, setSearch] = useState("");
  const executors = useMemo(() => deriveExecutors(campaigns), [campaigns]);
  const [modalRow, setModalRow] = useState<ExecutorRow | null>(null);

  const filtered = search
    ? executors.filter((e) =>
        e.address.toLowerCase().includes(search.toLowerCase()),
      )
    : executors;

  const modalRows: ModalCampaignRow[] = modalRow
    ? modalRow.executions.map((e) => ({
        campaignId: e.campaignId,
        creator: e.creator,
        campaignPda: e.campaignPda,
        campaignStatus: e.campaignStatus,
        amount: e.amount,
        thresholdBps: e.thresholdBps,
        deadlineUnix: e.deadlineUnix,
      }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-[#94b7ae] uppercase tracking-widest flex-1">
          Executors
        </span>
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
          Connect to an RPC endpoint to view executors.
        </div>
      )}
      {connected && filtered.length === 0 && (
        <div className="poe-panel rounded-xl py-6 text-center text-sm text-[#8aaea5]">
          No executors found.
        </div>
      )}

      {/* Card grid */}
      {connected && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((row) => (
            <ExecutorCard
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
          subtitle={`${modalRow.executions.length} campaign${modalRow.executions.length !== 1 ? "s" : ""}`}
          rows={modalRows}
          mode="executor"
          cluster={cluster}
          onClose={() => setModalRow(null)}
        />
      )}
    </div>
  );
}
