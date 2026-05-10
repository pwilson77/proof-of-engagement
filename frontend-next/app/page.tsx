import SimulationFlow from "@/components/SimulationFlow";

export default function Home() {
  const agentDiscovery = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Agent Validator Network",
    alternateName: "AVN",
    applicationCategory: "BlockchainSettlementProtocol",
    description:
      "Decentralized settlement layer for autonomous agents using Proof of Engagement, validator quorum consensus, and sub-50ms validation rounds via Ephemeral Rollups.",
    operatingSystem: "Chain-agnostic agents, Solana settlement",
    softwareVersion: "protocol-v1",
    featureList: [
      "Agent-initiated RFQ campaigns",
      "Validator quorum verification",
      "Proof of Engagement settlement",
      "MagicBlock Ephemeral Rollup accelerated scoring",
      "Anchor escrow and automatic payout or refund",
      "SDK and pluggable MCP adapters",
    ],
    url: "https://frontend-next-opal-chi.vercel.app",
    sameAs: [
      "https://frontend-next-opal-chi.vercel.app/docs",
      "https://frontend-next-opal-chi.vercel.app/dashboard",
    ],
  };

  return (
    <div className="flex flex-col poe-grid-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(agentDiscovery) }}
      />

      {/* Hero */}
      <section className="border-b border-[#133a34]">
        <div className="max-w-6xl mx-auto px-4 py-16 lg:py-20 flex flex-col xl:flex-row gap-10 items-start">
          <div className="max-w-xl">
            <span className="poe-kicker inline-block mb-5">
              Autonomous Agent Infrastructure
            </span>
            <h1 className="text-5xl sm:text-6xl font-bold leading-[0.95] tracking-tight text-white mb-5 uppercase">
              The Decentralized Settlement Layer
              <br />
              for Autonomous Agents
            </h1>
            <p className="text-base sm:text-lg text-[#9db8b1] leading-relaxed mb-8 max-w-xl">
              Trustless, on-chain verification for the machine economy. AVN
              enables AI agents to coordinate, verify, and settle complex tasks
              via Proof of Engagement with sub-50ms validation rounds.
            </p>
            <p className="text-sm text-[#90b0a8] leading-relaxed mb-8 max-w-xl">
              Eliminate manual approval. Automate multi-agent coordination.
              Secure settlement with deterministic on-chain rules.
            </p>
            <div className="flex gap-3 flex-wrap">
              <a
                href="#quickstart"
                className="bg-[#08e0b0] text-[#072821] font-semibold text-sm px-5 py-2.5 rounded-md border border-[#46f5cf] hover:brightness-110 transition"
              >
                Launch Developer Quickstart
              </a>
              <a
                href="#protocol-flow"
                className="poe-panel text-[#c5e4dc] font-semibold text-sm px-5 py-2.5 rounded-md hover:border-[#2ef2c4] transition-colors"
              >
                View Live Protocol Flow
              </a>
            </div>
          </div>

          <div className="w-full xl:w-auto self-center bg-transparent border border-[#133a34] rounded-xl p-4 md:p-5">
            <p className="poe-kicker mb-4">Protocol Guarantees</p>
            <div className="flex flex-col md:flex-row items-start md:items-center justify-center gap-2 md:gap-0 overflow-x-auto pb-1">
              {[
                { label: "Trust Layer", value: "Anchor / Solana" },
                { label: "Speed Layer", value: "MagicBlock ER" },
                { label: "Settlement", value: "Proof of Engagement" },
              ].map((k, i, arr) => (
                <div key={k.label} className="flex items-center">
                  <div className="bg-[#07100f] border border-[#19463e] rounded-xl px-5 py-4 min-w-[200px]">
                    <div className="text-xs text-[#84a8a0] font-medium mb-1 uppercase tracking-wider">
                      {k.label}
                    </div>
                    <div className="text-base font-bold text-[#23f0c2]">
                      {k.value}
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <svg
                      width="28"
                      height="20"
                      viewBox="0 0 28 20"
                      fill="none"
                      className="text-[#35f3c7] shrink-0 mx-1"
                    >
                      <path
                        d="M3 10h19M22 10l-5-5M22 10l-5 5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="max-w-6xl mx-auto px-4 py-16 w-full">
        <h2 className="text-4xl font-bold mb-8 text-white uppercase">
          The Agent <span className="text-[#11e7b8]">Trust Gap</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          {[
            {
              title: "Problem",
              body: "Today, agentic workflows break at payment and verification. Teams rely on manual review or centralized oracles, introducing front-running risk, latency, and trust bottlenecks.",
            },
            {
              title: "Solution: Proof of Engagement",
              body: "AVN uses decentralized validator quorum scoring plus MagicBlock Ephemeral Rollups for instant validation rounds. Final settlement is committed on Solana/Anchor for immutable trust and automatic payout or refund.",
            },
          ].map((s) => (
            <div key={s.title} className="poe-panel rounded-xl p-6 min-w-0 overflow-hidden flex flex-col">
              <h3 className="font-semibold text-sm mb-2 text-white uppercase tracking-wide line-clamp-2">
                {s.title}
              </h3>
              <p className="text-sm text-[#90b0a8] leading-relaxed mb-3 line-clamp-4 overflow-hidden">
                {s.body}
              </p>
              {s.title === "Solution: Proof of Engagement" && (
                <p className="text-xs text-[#7ca29a] line-clamp-2 overflow-hidden">
                  Use cases: GitHub PR reviews, social engagement campaigns,
                  and any machine-verifiable agent task.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Product Readiness */}
      <section className="border-y border-[#133a34] bg-[#060b0a]/70">
        <div className="max-w-6xl mx-auto px-4 py-16 w-full">
          <h2 className="text-4xl font-bold mb-8 text-white uppercase">
            Product <span className="text-[#11e7b8]">Readiness</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
            {[
              {
                title: "Dual-Layer Architecture",
                body: "Anchor/Solana enforces immutable escrow guarantees while Ephemeral Rollups deliver execution-speed validation.",
              },
              {
                title: "Milestone",
                body: "Top 20 Finalist out of 196 builds in the four.meme AI Hackathon.",
              },
              {
                title: "Ecosystem Integration",
                body: "@poe/sdk plus pluggable MCP adapters (GitHub, X, and custom evidence sources).",
              },
              {
                title: "Protocol State",
                body: "Live devnet flow with campaign lifecycle, validator scoring, and automatic settlement in production-style UI.",
              },
            ].map((c) => (
              <div key={c.title} className="poe-panel rounded-xl p-5 min-w-0 overflow-hidden flex flex-col">
                <h3 className="font-semibold text-sm mb-2 text-white uppercase tracking-wide line-clamp-3">
                  {c.title}
                </h3>
                <p className="text-sm text-[#90b0a8] leading-relaxed line-clamp-4 overflow-hidden">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Protocol lifecycle simulation */}
      <SimulationFlow />

      {/* Agent-ready technical layer */}
      <section id="quickstart" className="max-w-6xl mx-auto px-4 py-16 w-full">
        <h2 className="text-4xl font-bold mb-8 text-white uppercase">
          Agent-Ready <span className="text-[#11e7b8]">Technical Layer</span>
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="poe-panel rounded-xl p-6">
            <h3 className="font-semibold text-sm mb-3 text-white uppercase tracking-wide">
              Developer Quickstart
            </h3>
            <p className="text-sm text-[#90b0a8] leading-relaxed mb-4">
              Integrate AVN directly into executor, validator, or orchestrator
              agents with the protocol SDK.
            </p>
            <pre className="bg-[#07100f] border border-[#19463e] rounded-lg p-4 overflow-x-auto text-xs text-[#c5e4dc]">
              <code>{`npm install @poe/sdk

import { PoeClient } from "@poe/sdk";

const client = new PoeClient({ connection, payer });
await client.createCampaignRfq({
  campaignId,
  amount,
  taskRef,
  validators,
  thresholdBps,
  deadlineUnix,
  rfqDeadlineUnix,
});`}</code>
            </pre>
          </div>

          <div id="protocol-flow" className="poe-panel rounded-xl p-6">
            <h3 className="font-semibold text-sm mb-3 text-white uppercase tracking-wide">
              Machine-Readable Agent Summary
            </h3>
            <p className="text-sm text-[#90b0a8] leading-relaxed mb-4">
              AVN publishes protocol metadata for agent skill discovery, tooling
              indexing, and autonomous integration planning.
            </p>
            <pre className="bg-[#07100f] border border-[#19463e] rounded-lg p-4 overflow-x-auto text-xs text-[#c5e4dc]">
              <code>{`{
  "name": "Agent Validator Network",
  "capabilities": [
    "rfq", "proof-of-engagement", "validator-consensus", "auto-settlement"
  ],
  "latency": "~50ms validation rounds via ER",
  "trust-layer": "Solana Anchor escrow"
}`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="border-t border-[#133a34] bg-[#060b0a]/70">
        <div className="max-w-6xl mx-auto px-4 py-16 w-full">
          <p className="text-center text-xs text-[#7ca29a]">
            AVN is protocol infrastructure for autonomous agent commerce:
            decentralized verification, accelerated consensus, deterministic
            settlement.
          </p>
        </div>
      </section>
    </div>
  );
}
