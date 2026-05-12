"use client";

import { useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  PoeClient,
  CAMPAIGN_MODE,
  findValidatorScorePda,
  type CampaignAccount,
  type CampaignStatusLabel,
} from "@poe/sdk";
import {
  AddrLink,
  type Cluster,
  fmtBps,
  fmtUnix,
  short,
  txUrl,
} from "@/lib/solana-utils";

// ---------------------------------------------------------------------------
// Types (exported so other panels can reuse)
// ---------------------------------------------------------------------------
export interface ParsedCampaign {
  pda: PublicKey;
  acct: CampaignAccount;
  status: CampaignStatusLabel;
  mockScores?: ScoreEntry[];
  metadata?: CampaignUiMetadata;
}

export interface ScoreEntry {
  validator: string;
  scoreBps: number;
  voteTxSig?: string;
}

export interface ValidatorUiProfile {
  name?: string;
  description?: string;
}

export interface CampaignUiMetadata {
  campaignPda?: string;
  creator?: string;
  campaignId?: string;
  label?: string;
  name?: string;
  campaignName?: string;
  title?: string;
  description?: string;
  tags?: string[];
  validatorDescriptions?: Record<string, ValidatorUiProfile>;
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

function humanizeCampaignLabel(label: string | undefined): string {
  if (!label) return "";
  return label
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function legacySeededCampaignTitle(campaignId: bigint): string {
  const slot = Number((campaignId - 1n) % 5n);
  if (slot === 0) return "Direct Campaign: Retweet Validation";
  if (slot === 1) return "RFQ Campaign: Competitive Assignment";
  if (slot === 2) return "Settled Success Reference";
  if (slot === 3) return "Primary Live Demo Campaign";
  return "Fallback Live Demo Campaign";
}

// ---------------------------------------------------------------------------
// Campaign row
// ---------------------------------------------------------------------------
function CampaignRow({
  item,
  poeClient,
  cluster,
  rpcUrl,
}: {
  item: ParsedCampaign;
  poeClient: PoeClient | null;
  cluster: Cluster;
  rpcUrl: string;
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
  const campaignTitle =
    item.metadata?.title?.trim() ||
    item.metadata?.name?.trim() ||
    item.metadata?.campaignName?.trim() ||
    humanizeCampaignLabel(item.metadata?.label) ||
    legacySeededCampaignTitle(campaignId);
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
      .then(async (r) => {
        const conn = new Connection(rpcUrl, "confirmed");
        const enriched = await Promise.all(
          r.scores.map(async (s) => {
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
              // leave undefined if lookup fails
            }
            return {
              validator: s.validator.toBase58(),
              scoreBps: s.scoreBps,
              voteTxSig,
            };
          }),
        );
        setScores(enriched);
      })
      .catch(() => setScores([]));
  }, [
    open,
    scores,
    poeClient,
    item.acct.creator,
    campaignId,
    item.pda,
    rpcUrl,
  ]);

  const avgBps =
    scores && scores.length > 0
      ? Math.round(
          scores.reduce((sum, s) => sum + s.scoreBps, 0) / scores.length,
        )
      : null;
  const willSettle = avgBps !== null && avgBps >= threshold;
  const validatorDescriptions = item.metadata?.validatorDescriptions ?? {};

  return (
    <div className="poe-panel rounded-xl overflow-hidden border-[#18413a]">
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer flex-wrap"
        onClick={() => setOpen(true)}
      >
        <span className="font-mono text-sm font-bold text-[#23f0c2] min-w-[5rem]">
          #{String(campaignId)}
        </span>
        <div className="flex-1 min-w-[14rem]">
          <p className="truncate text-sm font-semibold text-[#d6f2ea]">
            {campaignTitle}
          </p>
          <p className="truncate text-xs text-[#87aca3]">
            <AddrLink address={creatorStr} cluster={cluster} />
          </p>
        </div>
        <span className="text-xs text-[#85a89f] whitespace-nowrap">
          ⏱ {fmtUnix(item.acct.deadlineUnix)}
        </span>
        {isRfq && <RfqModeBadge />}
        <StatusBadge label={item.status} />
        <span className="text-xs text-[#85a89f] ml-auto">View</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[85vh] overflow-y-auto poe-panel rounded-xl border-[#1f5a4f] bg-[#070d0c] text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-[#091311] border-b border-[#143833] px-4 py-2.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#d6f2ea]">
                  {campaignTitle}
                </p>
                <p className="text-xs text-[#87aca3]">
                  Campaign #{String(campaignId)}
                </p>
              </div>
              <button
                className="text-xs bg-[#0d1b18] text-[#c9e9e0] border border-[#19463e] px-3 py-1 rounded-lg hover:border-[#2af1c3]"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="px-4 py-4">
              {(item.metadata?.title || item.metadata?.description) && (
                <div className="mb-4 rounded-lg border border-[#1a4e44] bg-[#081613] px-3 py-3">
                  {item.metadata?.title && (
                    <p className="text-sm font-semibold text-[#b8f6e7]">
                      {item.metadata.title}
                    </p>
                  )}
                  {item.metadata?.description && (
                    <p className="mt-1 text-xs text-[#97bdb2] leading-relaxed">
                      {item.metadata.description}
                    </p>
                  )}
                  {item.metadata?.tags && item.metadata.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.metadata.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-[#122b26] text-[#7dd7c1] border border-[#1f5a4f]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
                        [
                          "RFQ Deadline",
                          fmtUnix(item.acct.rfqDeadlineUnix),
                        ] as [string, string],
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
                  {reviewerCount} reviewer{reviewerCount !== 1 ? "s" : ""} to
                  pay out to the executor.
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

                {Object.keys(validatorDescriptions).length > 0 && (
                  <div className="mt-3 mb-3">
                    <p className="text-xs font-bold text-[#9bb6af] uppercase tracking-widest mb-2">
                      Validator Profiles
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {Object.entries(validatorDescriptions).map(
                        ([address, info]) => (
                          <div
                            key={address}
                            className="rounded-lg border border-[#163c35] bg-[#091210] px-3 py-2"
                          >
                            <div className="text-xs font-semibold text-[#d6f2ea] mb-0.5">
                              {info.name ?? "Validator"}
                            </div>
                            <div className="text-[11px] text-[#8aaea5] mb-1.5">
                              {info.description ??
                                "Independent reviewer in the campaign validator set."}
                            </div>
                            <AddrLink address={address} cluster={cluster} />
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {scores !== null &&
                  scores.length > 0 &&
                  scores.map((s, i) => {
                    const approved = s.scoreBps >= threshold;
                    const validatorProfile = validatorDescriptions[s.validator];
                    return (
                      <div
                        key={s.validator}
                        className="flex items-center gap-3 bg-[#091210] border border-[#163c35] rounded-lg px-3 py-2 mb-1.5"
                      >
                        <span className="text-xs text-[#7fa29a] w-5 shrink-0">
                          #{i + 1}
                        </span>
                        <span className="flex-1 truncate text-xs text-[#d6f2ea]">
                          {validatorProfile?.name ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="font-semibold">
                                {validatorProfile.name}
                              </span>
                              <span className="text-[10px] text-[#7fa29a]">
                                ·
                              </span>
                              <AddrLink
                                address={s.validator}
                                cluster={cluster}
                              />
                            </span>
                          ) : (
                            <AddrLink address={s.validator} cluster={cluster} />
                          )}
                        </span>
                        <div className="w-24 h-1.5 bg-[#17332f] rounded-full shrink-0">
                          <div
                            className={`h-1.5 rounded-full ${approved ? "bg-[#2af1c3]" : "bg-[#ff7a81]"}`}
                            style={{
                              width: `${Math.round(s.scoreBps / 100)}%`,
                            }}
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
                        {s.voteTxSig ? (
                          <a
                            href={txUrl(s.voteTxSig, cluster)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-mono text-[#2af1c3] hover:text-white hover:underline shrink-0"
                            title={s.voteTxSig}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {short(s.voteTxSig)}
                          </a>
                        ) : (
                          <span className="text-[11px] text-[#6f8f86] shrink-0">
                            —
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
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
  rpcUrl: string;
  onRefresh: () => void;
}

type StatusFilter = CampaignStatusLabel | "all";
type ModeFilter = "all" | "direct" | "rfq";
type SortOption =
  | "deadline_asc"
  | "deadline_desc"
  | "campaign_newest"
  | "campaign_oldest"
  | "amount_desc";

const STATUS_ORDER: CampaignStatusLabel[] = [
  "open",
  "settled_success",
  "settled_refund",
  "rfq_expired",
];

const STATUS_LABEL: Record<CampaignStatusLabel, string> = {
  open: "Open",
  settled_success: "Settled Success",
  settled_refund: "Settled Refund",
  rfq_expired: "RFQ Expired",
};

export default function CampaignsPanel({
  campaigns,
  loading,
  connected,
  poeClient,
  cluster,
  rpcUrl,
  onRefresh,
}: CampaignsPanelProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("campaign_newest");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<
    Record<CampaignStatusLabel, boolean>
  >({
    open: false,
    settled_success: false,
    settled_refund: false,
    rfq_expired: false,
  });

  const statusCounts = useMemo(() => {
    return campaigns.reduce(
      (acc, item) => {
        acc[item.status] += 1;
        return acc;
      },
      {
        open: 0,
        settled_success: 0,
        settled_refund: 0,
        rfq_expired: 0,
      } as Record<CampaignStatusLabel, number>,
    );
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const cmpBigint = (a: bigint, b: bigint) => {
      if (a === b) return 0;
      return a > b ? 1 : -1;
    };

    const q = query.trim().toLowerCase();
    let rows = campaigns.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (modeFilter === "rfq" && item.acct.mode !== CAMPAIGN_MODE.RFQ)
        return false;
      if (modeFilter === "direct" && item.acct.mode === CAMPAIGN_MODE.RFQ)
        return false;
      if (!q) return true;

      const title = item.metadata?.title?.toLowerCase() ?? "";
      const label = item.metadata?.label?.toLowerCase() ?? "";
      const creator = item.acct.creator.toBase58().toLowerCase();
      const campaignId = String(item.acct.campaignId);
      const pda = item.pda.toBase58().toLowerCase();
      return (
        title.includes(q) ||
        label.includes(q) ||
        creator.includes(q) ||
        campaignId.includes(q) ||
        pda.includes(q)
      );
    });

    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case "deadline_desc":
          return cmpBigint(b.acct.deadlineUnix, a.acct.deadlineUnix);
        case "campaign_newest":
          return cmpBigint(b.acct.campaignId, a.acct.campaignId);
        case "campaign_oldest":
          return cmpBigint(a.acct.campaignId, b.acct.campaignId);
        case "amount_desc":
          return cmpBigint(b.acct.amount, a.acct.amount);
        case "deadline_asc":
        default:
          return cmpBigint(a.acct.deadlineUnix, b.acct.deadlineUnix);
      }
    });

    return rows;
  }, [campaigns, modeFilter, query, sortBy, statusFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCampaigns.length / pageSize),
  );
  const startIndex = (page - 1) * pageSize;
  const visibleCampaigns = filteredCampaigns.slice(
    startIndex,
    startIndex + pageSize,
  );
  const showingStart = filteredCampaigns.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(startIndex + pageSize, filteredCampaigns.length);

  const groupedVisibleCampaigns = useMemo(() => {
    const grouped = STATUS_ORDER.map((status) => ({
      status,
      items: visibleCampaigns.filter((item) => item.status === status),
    })).filter((group) => group.items.length > 0);
    return grouped;
  }, [visibleCampaigns]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, modeFilter, sortBy, pageSize]);

  const toggleGroup = (status: CampaignStatusLabel) => {
    setCollapsed((current) => ({
      ...current,
      [status]: !current[status],
    }));
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[#94b7ae] uppercase tracking-widest">
          All Campaigns
        </span>
        <div className="flex items-center gap-3">
          {campaigns.length > 0 && (
            <span className="text-xs text-[#87aca3]">
              {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
              {" · "}
              showing {showingStart}-{showingEnd}
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

      <div className="poe-panel rounded-xl p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`text-xs px-3 py-1.5 rounded-lg border ${
              statusFilter === "all"
                ? "border-[#2af1c3] text-[#d6f2ea] bg-[#0d1b18]"
                : "border-[#19463e] text-[#87aca3] bg-[#0b1513]"
            }`}
            onClick={() => setStatusFilter("all")}
          >
            All ({campaigns.length})
          </button>
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                statusFilter === status
                  ? "border-[#2af1c3] text-[#d6f2ea] bg-[#0d1b18]"
                  : "border-[#19463e] text-[#87aca3] bg-[#0b1513]"
              }`}
              onClick={() => setStatusFilter(status)}
            >
              {STATUS_LABEL[status]} ({statusCounts[status]})
            </button>
          ))}
        </div>
      </div>

      <div className="poe-panel rounded-xl p-2.5 flex flex-col gap-2">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-1.5">
          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-[11px] uppercase tracking-widest text-[#86a9a0]">
              Search
            </span>
            <input
              className="bg-[#0b1513] border border-[#1c4a41] rounded-lg px-3 py-2 text-sm text-[#d6f2ea] placeholder:text-[#62867d] focus:outline-none focus:border-[#2af1c3]"
              placeholder="Name, campaign ID, creator, or PDA"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-[#86a9a0]">
              Mode
            </span>
            <select
              className="bg-[#0b1513] border border-[#1c4a41] rounded-lg px-2.5 py-2 text-sm text-[#d6f2ea] focus:outline-none focus:border-[#2af1c3]"
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as ModeFilter)}
            >
              <option value="all">All modes</option>
              <option value="direct">Direct</option>
              <option value="rfq">RFQ</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-[#86a9a0]">
              Sort
            </span>
            <select
              className="bg-[#0b1513] border border-[#1c4a41] rounded-lg px-2.5 py-2 text-sm text-[#d6f2ea] focus:outline-none focus:border-[#2af1c3]"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="deadline_asc">Deadline (soonest)</option>
              <option value="deadline_desc">Deadline (latest)</option>
              <option value="campaign_newest">Campaign ID (newest)</option>
              <option value="campaign_oldest">Campaign ID (oldest)</option>
              <option value="amount_desc">Amount (highest)</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-[#86a9a0]">
            <span>{filteredCampaigns.length} match(es)</span>
            {(query || statusFilter !== "all" || modeFilter !== "all") && (
              <button
                className="px-2 py-1 border border-[#1c4a41] rounded-md hover:border-[#2af1c3] text-[#c9e9e0]"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setModeFilter("all");
                  setSortBy("campaign_newest");
                }}
              >
                Reset filters
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-[#86a9a0]">
            <span>Rows</span>
            <select
              className="bg-[#0b1513] border border-[#1c4a41] rounded-md px-2 py-1 text-xs text-[#d6f2ea]"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && (
        <div className="poe-panel rounded-xl py-8 text-center text-sm text-[#8aaea5]">
          <span className="animate-spin inline-block mr-2">⟳</span>Loading
          campaigns…
        </div>
      )}

      {!loading && connected && filteredCampaigns.length === 0 && (
        <div className="poe-panel rounded-xl py-8 text-center text-sm text-[#8aaea5]">
          No campaigns match the current filters.
        </div>
      )}

      {!loading && filteredCampaigns.length > pageSize && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-[#87aca3]">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="text-xs bg-[#0d1b18] text-[#c9e9e0] border border-[#19463e] px-3 py-1 rounded-lg hover:border-[#2af1c3] disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              className="text-xs bg-[#0d1b18] text-[#c9e9e0] border border-[#19463e] px-3 py-1 rounded-lg hover:border-[#2af1c3] disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
            <select
              className="text-xs bg-[#0d1b18] text-[#c9e9e0] border border-[#19463e] px-2 py-1 rounded-lg"
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!loading &&
        groupedVisibleCampaigns.map((group) => (
          <div key={group.status} className="flex flex-col gap-1.5">
            <button
              className="poe-panel rounded-lg px-2.5 py-1.5 flex items-center justify-between"
              onClick={() => toggleGroup(group.status)}
            >
              <span className="text-xs font-bold tracking-widest uppercase text-[#94b7ae]">
                {STATUS_LABEL[group.status]} ({group.items.length})
              </span>
              <span className="text-xs text-[#85a89f]">▶</span>
            </button>

            {!collapsed[group.status] &&
              group.items.map((item) => (
                <CampaignRow
                  key={item.pda.toBase58()}
                  item={item}
                  poeClient={poeClient}
                  cluster={cluster}
                  rpcUrl={rpcUrl}
                />
              ))}
          </div>
        ))}
    </div>
  );
}
