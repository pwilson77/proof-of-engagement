"use client";

import { useEffect } from "react";
import { type CampaignStatusLabel } from "@poe/sdk";
import { AddrLink, type Cluster, fmtBps, fmtUnix } from "@/lib/solana-utils";
import { BADGE } from "./CampaignsPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ModalCampaignRow {
  campaignId: bigint;
  creator: string;
  campaignPda: string;
  campaignStatus: CampaignStatusLabel;
  // validator-specific
  scoreBps?: number;
  // executor-specific
  amount?: bigint;
  thresholdBps?: number;
  deadlineUnix?: bigint;
}

export type ModalMode = "validator" | "executor";

interface CampaignModalProps {
  title: string;
  subtitle: string;
  rows: ModalCampaignRow[];
  mode: ModalMode;
  cluster: Cluster;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export default function CampaignModal({
  title,
  subtitle,
  rows,
  mode,
  cluster,
  onClose,
}: CampaignModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(3,8,8,0.85)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-[#1c4f47] shadow-[0_0_60px_rgba(8,224,176,0.12)]"
        style={{ background: "#07100f" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#143833] shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a8a80] mb-1">
              {mode === "validator" ? "Validator" : "Executor"} · campaigns
            </p>
            <p className="text-sm font-bold text-[#2af1c3] truncate">{title}</p>
            <p className="text-xs text-[#8aaea5] mt-0.5">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-[#5a8a80] hover:text-[#2af1c3] text-lg leading-none mt-0.5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1 px-6 py-4">
          {rows.length === 0 ? (
            <p className="text-sm text-[#8aaea5] text-center py-8">
              No campaigns found.
            </p>
          ) : (
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-[#07100f]">
                <tr className="text-[#5a8a80] uppercase tracking-widest border-b border-[#132f2b]">
                  <th className="pb-3 font-normal pr-4">Campaign</th>
                  <th className="pb-3 font-normal pr-4">Creator</th>
                  {mode === "validator" && (
                    <th className="pb-3 font-normal text-right pr-4">Score</th>
                  )}
                  {mode === "executor" && (
                    <>
                      <th className="pb-3 font-normal text-right pr-4">
                        Amount
                      </th>
                      <th className="pb-3 font-normal text-right pr-4">
                        Threshold
                      </th>
                      <th className="pb-3 font-normal text-right pr-4">
                        Deadline
                      </th>
                    </>
                  )}
                  <th className="pb-3 font-normal text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.campaignPda}
                    className="border-b border-[#0f2520] last:border-none hover:bg-[#0a1712] transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-mono text-[#2af1c3]">
                      #{String(r.campaignId)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <AddrLink address={r.creator} cluster={cluster} />
                    </td>
                    {mode === "validator" && r.scoreBps !== undefined && (
                      <td className="py-2.5 pr-4 text-right">
                        <span className="font-mono text-[#e5faf4]">
                          {fmtBps(r.scoreBps)}
                        </span>
                      </td>
                    )}
                    {mode === "executor" && (
                      <>
                        <td className="py-2.5 pr-4 text-right font-mono text-[#e5faf4]">
                          {r.amount !== undefined ? String(r.amount) : "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-[#e5faf4]">
                          {r.thresholdBps !== undefined
                            ? fmtBps(r.thresholdBps)
                            : "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-[#9db8b1]">
                          {r.deadlineUnix !== undefined
                            ? fmtUnix(r.deadlineUnix)
                            : "—"}
                        </td>
                      </>
                    )}
                    <td className="py-2.5 text-right">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE[r.campaignStatus]}`}
                      >
                        {r.campaignStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
