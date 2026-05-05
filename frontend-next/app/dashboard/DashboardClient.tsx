"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  PoeClient,
  PROGRAM_ID,
  deserializeCampaign,
  statusLabel,
  type CampaignAccount,
  type CampaignStatusLabel,
} from "@poe/sdk";
import { sha256 } from "@noble/hashes/sha2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ParsedCampaign {
  pda: PublicKey;
  acct: CampaignAccount;
  status: CampaignStatusLabel;
  mockScores?: ScoreEntry[];
}

interface ScoreEntry {
  validator: string;
  scoreBps: number;
}

// ---------------------------------------------------------------------------
// Discriminator helpers
// ---------------------------------------------------------------------------
function accountDisc(name: string): number[] {
  return Array.from(sha256(new TextEncoder().encode(`account:${name}`))).slice(0, 8);
}
const CAMPAIGN_DISC = accountDisc("Campaign");

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function fmtBps(bps: number) { return `${(bps / 100).toFixed(2)}%`; }
function fmtUnix(unix: bigint | number) { return new Date(Number(unix) * 1000).toLocaleString(); }
function short(pk: string) { return `${pk.slice(0, 6)}…${pk.slice(-4)}`; }

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const BADGE: Record<CampaignStatusLabel, string> = {
  open: "bg-blue-100 text-blue-700",
  settled_success: "bg-green-100 text-green-700",
  settled_refund: "bg-red-100 text-red-700",
};

function StatusBadge({ label }: { label: CampaignStatusLabel }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${BADGE[label]}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mock data (shown until a real RPC connection is made)
// ---------------------------------------------------------------------------
const _pk = (seed: number) => new PublicKey(new Uint8Array(32).fill(seed));
const _b32 = (n: number) => new Uint8Array(32).fill(n);
const _now = () => Math.floor(Date.now() / 1000);

const MOCK_CAMPAIGNS: ParsedCampaign[] = [
  {
    pda: _pk(10),
    status: "open",
    acct: {
      campaignId: 42n,
      creator: _pk(1),
      executor: _pk(2),
      mint: _pk(3),
      escrowTokenAccount: _pk(4),
      amount: 5_000_000n,
      taskRef: _b32(0xab),
      validatorSetHash: _b32(0xcd),
      validatorCount: 3,
      thresholdBps: 7000,
      deadlineUnix: BigInt(_now() + 86400),
      status: 0,
      createdAtUnix: BigInt(_now() - 3600),
      bump: 254,
    },
    mockScores: [
      { validator: _pk(20).toBase58(), scoreBps: 8200 },
      { validator: _pk(21).toBase58(), scoreBps: 7500 },
      { validator: _pk(22).toBase58(), scoreBps: 9100 },
    ],
  },
  {
    pda: _pk(11),
    status: "settled_success",
    acct: {
      campaignId: 41n,
      creator: _pk(1),
      executor: _pk(5),
      mint: _pk(3),
      escrowTokenAccount: _pk(6),
      amount: 2_000_000n,
      taskRef: _b32(0xef),
      validatorSetHash: _b32(0x12),
      validatorCount: 3,
      thresholdBps: 6000,
      deadlineUnix: BigInt(_now() - 7200),
      status: 1,
      createdAtUnix: BigInt(_now() - 86400),
      bump: 253,
    },
    mockScores: [
      { validator: _pk(20).toBase58(), scoreBps: 8800 },
      { validator: _pk(21).toBase58(), scoreBps: 7200 },
      { validator: _pk(22).toBase58(), scoreBps: 9000 },
    ],
  },
  {
    pda: _pk(12),
    status: "settled_refund",
    acct: {
      campaignId: 37n,
      creator: _pk(7),
      executor: _pk(8),
      mint: _pk(3),
      escrowTokenAccount: _pk(9),
      amount: 10_000_000n,
      taskRef: _b32(0x34),
      validatorSetHash: _b32(0x56),
      validatorCount: 5,
      thresholdBps: 8000,
      deadlineUnix: BigInt(_now() - 14400),
      status: 2,
      createdAtUnix: BigInt(_now() - 172800),
      bump: 252,
    },
    mockScores: [],
  },
];

// ---------------------------------------------------------------------------
// Campaign row
// ---------------------------------------------------------------------------
function CampaignRow({ item, poeClient }: { item: ParsedCampaign; poeClient: PoeClient | null }) {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<ScoreEntry[] | null>(item.mockScores ?? null);

  const creatorStr = item.acct.creator.toBase58();
  const campaignId = item.acct.campaignId;
  const threshold = item.acct.thresholdBps;
  const reviewerCount = item.acct.validatorCount;

  useEffect(() => {
    if (!open || scores !== null) return;
    if (!poeClient) { setScores([]); return; }
    poeClient
      .queryCampaignStatus(item.acct.creator, campaignId)
      .then((r) => setScores(r.scores.map((s) => ({ validator: s.validator.toBase58(), scoreBps: s.scoreBps }))))
      .catch(() => setScores([]));
  }, [open, scores, poeClient, item.acct.creator, campaignId]);

  // Aggregate reviewer summary
  const avgBps = scores && scores.length > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.scoreBps, 0) / scores.length)
    : null;
  const willSettle = avgBps !== null && avgBps >= threshold;

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-colors ${open ? "border-teal-500" : "border-zinc-200 hover:border-zinc-400"}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer flex-wrap"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-mono text-sm font-bold text-teal-700 min-w-27.5">#{String(campaignId)}</span>
        <span className="font-mono text-xs text-zinc-400 flex-1 truncate" title={creatorStr}>{short(creatorStr)}</span>
        <span className="text-xs text-zinc-400 whitespace-nowrap">⏱ {fmtUnix(item.acct.deadlineUnix)}</span>
        <StatusBadge label={item.status} />
        <span className={`text-xs text-zinc-400 ml-auto transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-4 py-4 bg-zinc-50 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-0 mb-4">
            {[
              ["Campaign ID", String(campaignId)],
              ["Status", null],
              ["Creator", creatorStr],
              ["Executor", item.acct.executor.toBase58()],
              ["Amount (raw)", String(item.acct.amount)],
              ["Payout threshold", fmtBps(threshold)],
              ["Deadline", fmtUnix(item.acct.deadlineUnix)],
              ["Reviewers", String(reviewerCount)],
              ["Escrow ATA", item.acct.escrowTokenAccount.toBase58()],
              ["Campaign PDA", item.pda.toBase58()],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between py-1.5 border-b border-zinc-100 last:border-none gap-2">
                <span className="text-zinc-500 shrink-0">{label}</span>
                {val === null ? <StatusBadge label={item.status} /> : (
                  <span className="font-mono text-xs break-all text-right">{val}</span>
                )}
              </div>
            ))}
          </div>

          {/* Reviewer section */}
          <div className="mb-2">
            {/* Header + sealed note */}
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Independent Reviewers</p>
              <span className="text-xs text-zinc-300">🔒 sealed at creation</span>
            </div>

            {/* Plain-English settlement rule */}
            <p className="text-xs text-zinc-400 mb-3">
              Needs average reviewer score ≥ {fmtBps(threshold)} across all {reviewerCount} reviewer{reviewerCount !== 1 ? "s" : ""} to pay out to the executor.
            </p>

            {/* Aggregate summary */}
            {scores !== null && scores.length > 0 && avgBps !== null && (
              <div className={`flex items-center gap-3 rounded-lg px-3 py-2 mb-3 text-xs font-semibold border ${
                willSettle
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}>
                <span>{willSettle ? "✓" : "✗"}</span>
                <span>
                  {scores.length}/{reviewerCount} reviewed · avg {fmtBps(avgBps)} · threshold {fmtBps(threshold)}
                  {" · "}{willSettle ? "meets payout threshold" : "below payout threshold"}
                </span>
              </div>
            )}

            {scores === null && <p className="text-xs text-zinc-400">Loading…</p>}
            {scores !== null && scores.length === 0 && (
              <p className="text-xs text-zinc-400">No reviews submitted yet.</p>
            )}

            {/* Per-reviewer rows */}
            {scores !== null && scores.length > 0 && scores.map((s, i) => {
              const approved = s.scoreBps >= threshold;
              return (
                <div key={s.validator} className="flex items-center gap-3 bg-white border border-zinc-100 rounded-lg px-3 py-2 mb-1.5">
                  <span className="text-xs text-zinc-300 w-5 shrink-0">#{i + 1}</span>
                  <span className="font-mono text-xs text-zinc-400 flex-1 truncate" title={s.validator}>{short(s.validator)}</span>
                  <div className="w-24 h-1.5 bg-zinc-200 rounded-full shrink-0">
                    <div
                      className={`h-1.5 rounded-full ${approved ? "bg-teal-500" : "bg-red-400"}`}
                      style={{ width: `${Math.round(s.scoreBps / 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold min-w-11 text-right">{fmtBps(s.scoreBps)}</span>
                  <span className={`text-xs font-bold shrink-0 ${approved ? "text-green-600" : "text-red-500"}`}>
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
// Dashboard page
// ---------------------------------------------------------------------------
export default function DashboardClient() {
  const searchParams = useSearchParams();
  const rpcFromUrl = searchParams.get("rpc");

  const [rpcUrl, setRpcUrl] = useState(rpcFromUrl ?? "http://127.0.0.1:8899");
  const [status, setStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<ParsedCampaign[]>(MOCK_CAMPAIGNS);
  const [isDemo, setIsDemo] = useState(!rpcFromUrl);
  const connectionRef = useRef<Connection | null>(null);
  const payerRef = useRef<Keypair | null>(null);
  const connectAttemptRef = useRef(0);
  const [poeClient, setPoeClient] = useState<PoeClient | null>(null);

  const loadCampaigns = useCallback(async (conn: Connection, client: PoeClient) => {
    setLoading(true);
    try {
      const accounts = await conn.getProgramAccounts(PROGRAM_ID);
      const parsed: ParsedCampaign[] = accounts
        .filter(({ account }) => {
          const d = account.data;
          if (d.length < 8) return false;
          for (let i = 0; i < 8; i++) if (d[i] !== CAMPAIGN_DISC[i]) return false;
          return true;
        })
        .flatMap(({ pubkey: pda, account }) => {
          try {
            const acct = deserializeCampaign(account.data);
            const sl = statusLabel(acct.status);
            return [{ pda, acct, status: sl }];
          } catch { return []; }
        })
        .sort((a, b) => (a.acct.campaignId < b.acct.campaignId ? 1 : -1));
      setCampaigns(parsed);
      setIsDemo(false);
    } catch (e: unknown) {
      setStatus(`Failed to fetch campaigns: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  async function connectAndLoad(overrideRpc?: string) {
    const attemptId = ++connectAttemptRef.current;
    const url = overrideRpc ?? rpcUrl;
    setConnecting(true);
    setStatus("Connecting…");
    try {
      const conn = new Connection(url, "confirmed");
      const slot = await withTimeout(conn.getSlot(), 8000, "RPC handshake");
      if (!payerRef.current) payerRef.current = Keypair.generate();
      const client = new PoeClient({ connection: conn, payer: payerRef.current });
      if (attemptId !== connectAttemptRef.current) return;
      connectionRef.current = conn;
      setPoeClient(client);
      setStatus(`Connected — slot ${slot}`);
      setConnected(true);
      await loadCampaigns(conn, client);
    } catch (e: unknown) {
      if (attemptId !== connectAttemptRef.current) return;
      setStatus(`Connection failed: ${e instanceof Error ? e.message : String(e)}`);
      setConnected(false);
    } finally {
      if (attemptId === connectAttemptRef.current) {
        setConnecting(false);
      }
    }
  }

  // Auto-connect whenever the ?rpc= param changes (including on first load)
  useEffect(() => {
    if (!rpcFromUrl) {
      // Switched back to demo — reset to mock data
      connectAttemptRef.current += 1;
      setCampaigns(MOCK_CAMPAIGNS);
      setIsDemo(true);
      setConnected(false);
      setConnecting(false);
      setLoading(false);
      setStatus("");
      connectionRef.current = null;
      setPoeClient(null);
      setRpcUrl("http://127.0.0.1:8899");
      return;
    }
    setRpcUrl(rpcFromUrl);
    // Small delay so state settles before connecting
    const id = setTimeout(() => connectAndLoad(rpcFromUrl), 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpcFromUrl]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-5 w-full">
      {/* Toolbar */}
      <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-60">
          <label className="text-xs text-zinc-500 mb-1 block">RPC Endpoint</label>
          <input
            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
          />
        </div>
        <button
          className="bg-teal-700 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 whitespace-nowrap disabled:opacity-50"
          onClick={() => connectAndLoad()}
          disabled={connecting || loading}
        >
          {connecting ? "Connecting…" : "Connect & Load"}
        </button>
        {connected && (
          <button
            className="bg-zinc-100 text-zinc-700 font-semibold text-sm px-4 py-2 rounded-lg hover:bg-zinc-200 whitespace-nowrap disabled:opacity-50"
            disabled={loading}
            onClick={() => poeClient && connectionRef.current && loadCampaigns(connectionRef.current, poeClient)}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        )}
        {status && <p className="w-full text-xs text-zinc-400 -mt-1">{status}</p>}
      </div>

      {/* Demo banner */}
      {isDemo && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 flex items-center gap-2">
          <span className="font-bold">DEMO</span>
          <span>Showing sample campaigns. Connect to a Solana RPC to browse live on-chain data.</span>
        </div>
      )}

      {/* Campaign list */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">All Campaigns</span>
          {campaigns.length > 0 && (
            <span className="text-xs text-zinc-400">{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {loading && (
          <div className="bg-white border border-zinc-200 rounded-xl py-8 text-center text-sm text-zinc-400">
            <span className="animate-spin inline-block mr-2">⟳</span>Loading campaigns…
          </div>
        )}

        {!loading && connected && campaigns.length === 0 && (
          <div className="bg-white border border-zinc-200 rounded-xl py-8 text-center text-sm text-zinc-400">
            No campaigns found on this cluster.
          </div>
        )}

        {!loading && campaigns.map((item) => (
          <CampaignRow key={item.pda.toBase58()} item={item} poeClient={poeClient} />
        ))}
      </div>
    </div>
  );
}
