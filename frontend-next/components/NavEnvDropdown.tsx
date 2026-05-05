"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ENVS = [
  { label: "Demo",    rpc: null,                                  description: "Sample data, no RPC" },
  { label: "Local",   rpc: "http://127.0.0.1:8899",              description: "solana-test-validator" },
  { label: "Devnet",  rpc: "https://api.devnet.solana.com",       description: "Solana devnet" },
] as const;

type EnvLabel = (typeof ENVS)[number]["label"];

function detectEnv(): EnvLabel {
  if (typeof window === "undefined") return "Demo";
  const rpc = new URLSearchParams(window.location.search).get("rpc");
  if (!rpc) return "Demo";
  if (rpc.includes("127.0.0.1") || rpc.includes("localhost")) return "Local";
  if (rpc.includes("devnet")) return "Devnet";
  return "Demo";
}

export default function NavEnvDropdown() {
  const [current, setCurrent] = useState<EnvLabel>("Demo");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Sync with URL on mount
  useEffect(() => {
    setCurrent(detectEnv());
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function pick(env: (typeof ENVS)[number]) {
    setOpen(false);
    setCurrent(env.label);
    const target = env.rpc
      ? `/dashboard?rpc=${encodeURIComponent(env.rpc)}`
      : "/dashboard";
    router.push(target);
  }

  const DOT: Record<EnvLabel, string> = {
    Demo:   "bg-amber-400",
    Local:  "bg-teal-500",
    Devnet: "bg-blue-500",
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-semibold text-zinc-500 hover:text-teal-700 select-none"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${DOT[current]}`} />
        {current}
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 10 6" stroke="currentColor" strokeWidth={2}>
          <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-white border border-zinc-200 rounded-xl shadow-lg py-1 z-50">
          {ENVS.map((env) => (
            <button
              key={env.label}
              onClick={() => pick(env)}
              className={`w-full flex items-start gap-3 px-4 py-2.5 hover:bg-zinc-50 text-left ${current === env.label ? "bg-zinc-50" : ""}`}
            >
              <span className={`mt-1.5 inline-block w-2 h-2 rounded-full shrink-0 ${DOT[env.label]}`} />
              <div>
                <p className={`text-sm font-semibold ${current === env.label ? "text-teal-700" : "text-zinc-700"}`}>
                  {env.label}
                </p>
                <p className="text-xs text-zinc-400">{env.description}</p>
              </div>
              {current === env.label && (
                <svg className="ml-auto mt-1 w-4 h-4 text-teal-600 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M3 8l4 4 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
