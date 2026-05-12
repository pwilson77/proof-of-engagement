"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  PoeClient,
  PROGRAM_ID,
  deserializeCampaign,
  statusLabel,
} from "@/lib/sdk";
import { type Cluster, detectCluster } from "@/lib/solana-utils";
import { sha256 } from "@noble/hashes/sha2.js";
import CampaignsPanel, {
  type CampaignUiMetadata,
  type ParsedCampaign,
} from "./CampaignsPanel";
import ValidatorsPanel from "./ValidatorsPanel";
import ExecutorsPanel from "./ExecutorsPanel";

// ---------------------------------------------------------------------------
// Discriminator helpers
// ---------------------------------------------------------------------------
function accountDisc(name: string): number[] {
  return Array.from(sha256(new TextEncoder().encode(`account:${name}`))).slice(
    0,
    8,
  );
}
const CAMPAIGN_DISC = accountDisc("Campaign");

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const DEFAULT_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://devnet.helius-rpc.com/?api-key=b539e607-6c09-4971-9115-7e8e1befc126";

// ---------------------------------------------------------------------------
// Sidebar tab definitions
// ---------------------------------------------------------------------------
type Tab = "campaigns" | "validators" | "executors";

type MetadataDocument = {
  schemaVersion?: number;
  cluster?: string;
  updatedAtUnix?: number;
  campaigns?: Record<string, CampaignUiMetadata>;
};

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "campaigns", label: "Campaigns", icon: "◈" },
  { id: "validators", label: "Validators", icon: "◉" },
  { id: "executors", label: "Executors", icon: "◎" },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DashboardClient() {
  const searchParams = useSearchParams();
  const rpcFromUrl = searchParams.get("rpc");

  const [rpcUrl, setRpcUrl] = useState(rpcFromUrl ?? DEFAULT_RPC_URL);
  const [status, setStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<ParsedCampaign[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("campaigns");
  const connectionRef = useRef<Connection | null>(null);
  const payerRef = useRef<Keypair | null>(null);
  const connectAttemptRef = useRef(0);
  const [poeClient, setPoeClient] = useState<PoeClient | null>(null);
  const [campaignMetadata, setCampaignMetadata] = useState<
    Record<string, CampaignUiMetadata>
  >({});

  const cluster: Cluster = detectCluster(rpcUrl);

  const lookupCampaignMetadata = useCallback(
    (item: ParsedCampaign): CampaignUiMetadata | undefined => {
      const pda = item.pda.toBase58();
      const direct = campaignMetadata[pda];
      if (direct) return direct;

      const creator = item.acct.creator.toBase58();
      const campaignId = item.acct.campaignId.toString();
      return Object.values(campaignMetadata).find(
        (m) => m.creator === creator && m.campaignId === campaignId,
      );
    },
    [campaignMetadata],
  );

  const enrichedCampaigns = useMemo(
    () => campaigns.map((c) => ({ ...c, metadata: lookupCampaignMetadata(c) })),
    [campaigns, lookupCampaignMetadata],
  );

  const loadCampaigns = useCallback(
    async (conn: Connection, client: PoeClient) => {
      setLoading(true);
      try {
        const accounts = await conn.getProgramAccounts(PROGRAM_ID);
        const parsed: ParsedCampaign[] = accounts
          .filter(({ account }) => {
            const d = account.data;
            if (d.length < 8) return false;
            for (let i = 0; i < 8; i++)
              if (d[i] !== CAMPAIGN_DISC[i]) return false;
            return true;
          })
          .flatMap(({ pubkey: pda, account }) => {
            try {
              const acct = deserializeCampaign(account.data);
              const sl = statusLabel(acct.status);
              return [{ pda, acct, status: sl }];
            } catch {
              return [];
            }
          })
          .sort((a, b) => (a.acct.campaignId < b.acct.campaignId ? 1 : -1));
        setCampaigns(parsed);
      } catch (e: unknown) {
        setStatus(
          `Failed to fetch campaigns: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const connectAndLoad = useCallback(
    async (overrideRpc?: string) => {
      const attemptId = ++connectAttemptRef.current;
      const url = overrideRpc ?? rpcUrl;
      setConnecting(true);
      setStatus("Connecting…");
      try {
        const conn = new Connection(url, "confirmed");
        const slot = await withTimeout(conn.getSlot(), 8000, "RPC handshake");
        if (!payerRef.current) payerRef.current = Keypair.generate();
        const client = new PoeClient({
          connection: conn,
          payer: payerRef.current,
        });
        if (attemptId !== connectAttemptRef.current) return;
        connectionRef.current = conn;
        setPoeClient(client);
        setStatus(`Connected — slot ${slot}`);
        setConnected(true);
        await loadCampaigns(conn, client);
      } catch (e: unknown) {
        if (attemptId !== connectAttemptRef.current) return;
        setStatus(
          `Connection failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        setConnected(false);
      } finally {
        if (attemptId === connectAttemptRef.current) setConnecting(false);
      }
    },
    [rpcUrl, loadCampaigns],
  );

  // Auto-connect: use URL override when present, otherwise default to devnet.
  useEffect(() => {
    const targetRpc = rpcFromUrl ?? DEFAULT_RPC_URL;
    setRpcUrl(targetRpc);
    const id = setTimeout(() => connectAndLoad(targetRpc), 50);
    return () => clearTimeout(id);
  }, [rpcFromUrl, connectAndLoad]);

  useEffect(() => {
    let cancelled = false;

    if (cluster !== "devnet") {
      setCampaignMetadata({});
      return;
    }

    (async () => {
      // Try the runtime API route first (reads from Vercel Blob when deployed).
      // Falls back to the static public file for local dev without blob configured.
      const sources = ["/api/metadata", "/campaign-metadata.devnet.json"];
      for (const src of sources) {
        try {
          const res = await fetch(src, { cache: "no-store" });
          if (!res.ok) continue;
          const doc = (await res.json()) as MetadataDocument;
          if (!cancelled) setCampaignMetadata(doc.campaigns ?? {});
          return;
        } catch {
          // try next source
        }
      }
      if (!cancelled) setCampaignMetadata({});
    })();

    return () => {
      cancelled = true;
    };
  }, [cluster]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-5 w-full">
      {/* Toolbar */}
      <div className="poe-panel rounded-xl px-4 py-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-60">
          <label className="text-xs text-[#8aaea5] mb-1 block">
            RPC Endpoint
          </label>
          <input
            className="w-full border border-[#19463e] bg-[#07100f] text-[#d9f7ef] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2af1c3]"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
          />
        </div>
        <button
          className="bg-[#08e0b0] text-[#072821] font-semibold text-sm px-4 py-2 rounded-lg border border-[#46f5cf] hover:brightness-110 whitespace-nowrap disabled:opacity-50"
          onClick={() => connectAndLoad()}
          disabled={connecting || loading}
        >
          {connecting ? "Connecting…" : "Connect & Load"}
        </button>
        {connected && (
          <button
            className="bg-[#0d1b18] text-[#c9e9e0] border border-[#19463e] font-semibold text-sm px-4 py-2 rounded-lg hover:border-[#2af1c3] whitespace-nowrap disabled:opacity-50"
            disabled={loading}
            onClick={() =>
              poeClient &&
              connectionRef.current &&
              loadCampaigns(connectionRef.current, poeClient)
            }
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        )}
        {status && (
          <p className="w-full text-xs text-[#8aaea5] -mt-1">{status}</p>
        )}
      </div>

      {/* Mobile tab pills */}
      <div className="lg:hidden flex gap-2 overflow-x-auto scrollbar-none pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              activeTab === t.id
                ? "bg-[#08e0b0] text-[#072821] border-[#08e0b0]"
                : "bg-[#0a0f0f] text-[#8aaea5] border-[#1a3f38] hover:border-[#2af1c3]"
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div className="flex gap-6 items-start">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex flex-col gap-1 w-44 shrink-0 sticky top-24">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition-colors text-left ${
                activeTab === t.id
                  ? "bg-[#081c18] text-[#2af1c3] border-[#1c5948]"
                  : "bg-transparent text-[#8aaea5] border-transparent hover:text-[#c9e9e0] hover:bg-[#0a1512]"
              }`}
            >
              <span className="text-base">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </aside>

        {/* Content panel */}
        <main className="flex-1 min-w-0">
          {activeTab === "campaigns" && (
            <CampaignsPanel
              campaigns={enrichedCampaigns}
              loading={loading}
              connected={connected}
              poeClient={poeClient}
              cluster={cluster}
              rpcUrl={rpcUrl}
              onRefresh={() =>
                poeClient &&
                connectionRef.current &&
                loadCampaigns(connectionRef.current, poeClient)
              }
            />
          )}
          {activeTab === "validators" && (
            <ValidatorsPanel
              campaigns={enrichedCampaigns}
              poeClient={poeClient}
              connected={connected}
              cluster={cluster}
              rpcUrl={rpcUrl}
            />
          )}
          {activeTab === "executors" && (
            <ExecutorsPanel
              campaigns={enrichedCampaigns}
              connected={connected}
              cluster={cluster}
            />
          )}
        </main>
      </div>
    </div>
  );
}
