/**
 * Shared Solana formatting + link utilities used across dashboard, validators, executors pages.
 */

export type Cluster = "mainnet" | "devnet" | "local";

export function detectCluster(rpc: string): Cluster {
  if (rpc.includes("127.0.0.1") || rpc.includes("localhost")) return "local";
  if (rpc.includes("devnet")) return "devnet";
  return "mainnet";
}

export function short(pk: string): string {
  return `${pk.slice(0, 6)}…${pk.slice(-4)}`;
}

export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function fmtUnix(unix: bigint | number): string {
  return new Date(Number(unix) * 1000).toLocaleString();
}

export function solscanUrl(address: string, cluster: Cluster): string {
  if (cluster === "local")
    return `https://explorer.solana.com/address/${address}?cluster=custom&customUrl=${encodeURIComponent(
      "http://127.0.0.1:8899",
    )}`;
  if (cluster === "devnet")
    return `https://solscan.io/account/${address}?cluster=devnet`;
  return `https://solscan.io/account/${address}`;
}

export function txUrl(sig: string, cluster: Cluster): string {
  if (cluster === "local")
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(
      "http://127.0.0.1:8899",
    )}`;
  if (cluster === "devnet")
    return `https://solscan.io/tx/${sig}?cluster=devnet`;
  return `https://solscan.io/tx/${sig}`;
}

/** Inline SVG arrow-in-box icon that signals "opens in new tab". */
function ExternalIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 12"
      className="w-2.5 h-2.5 shrink-0 opacity-60"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" />
      <path d="M8 1h3m0 0v3m0-3L5.5 6.5" />
    </svg>
  );
}

interface AddrLinkProps {
  address: string;
  cluster: Cluster;
  /** Show full address instead of truncated. Defaults to false. */
  full?: boolean;
}

export function AddrLink({ address, cluster, full = false }: AddrLinkProps) {
  return (
    <a
      href={solscanUrl(address, cluster)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 font-mono text-xs text-[#2af1c3] hover:text-white hover:underline break-all"
      title={address}
      onClick={(e) => e.stopPropagation()}
    >
      {full ? address : short(address)}
      <ExternalIcon />
    </a>
  );
}
