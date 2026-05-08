"use client";
import { useEffect, useId, useState } from "react";

const ER_ENDPOINTS_DISPLAY = {
  devnet: "https://devnet.magicblock.app",
  devnetRouter: "https://devnet-router.magicblock.app",
} as const;

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "rfq", label: "RFQ Mode" },
  { id: "magicblock", label: "MagicBlock · ER" },
  { id: "validators", label: "Validator Adapters" },
  { id: "sdk-install", label: "SDK · Install" },
  { id: "sdk-client", label: "SDK · Client" },
  { id: "sdk-methods", label: "SDK · Methods" },
  { id: "sdk-wiring", label: "SDK · Orchestrator" },
  { id: "dashboard", label: "Dashboard" },
  { id: "notes", label: "Common Notes" },
];

function useSectionSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const ob = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActive(id);
        },
        { rootMargin: "-20% 0px -70% 0px" },
      );
      ob.observe(el);
      observers.push(ob);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, [ids]);
  return active;
}

function Code({ children }: { children: string }) {
  return (
    <code className="bg-[#0d1f1c] border border-[#1d4c44] px-1.5 py-0.5 rounded text-sm font-mono text-[#2af1c3]">
      {children}
    </code>
  );
}

function PreBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[#07100f] border border-[#19463e] rounded-lg p-4 text-xs font-mono text-[#2af1c3] overflow-x-auto whitespace-pre leading-relaxed">
      {children}
    </pre>
  );
}

function SectionTitle({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-xl font-bold text-white mb-5 scroll-mt-24 border-b border-[#133a34] pb-3"
    >
      {children}
    </h2>
  );
}

const ARCH_DIAGRAM = `
flowchart TD
    CA["🧑‍💻 Creator Agent\\ncreate_campaign / create_campaign_rfq"]
    EA["⚙️ Executor Agent\\nperforms the task"]
    CP(["Campaign PDA\\non-chain escrow · USDC locked"])
    SP(["Score PDAs\\nper-validator accounts"])

    CA -->|"escrow + rules"| CP
    CA -->|"direct or RFQ"| EA
    EA -->|"task ref"| SP

    subgraph ER ["⚡ MagicBlock Ephemeral Rollup  ~50 ms/slot"]
        VA["Validator A\\nsubmitValidatorScoreEr"]
        VB["Validator B\\nsubmitValidatorScoreEr"]
        VC["Validator C\\nsubmitValidatorScoreEr"]
    end

    SP --> VA & VB & VC
    CP -->|"delegate_campaign"| ER
    ER -->|"undelegate → commit state"| CP

    VA & VB & VC --> CO

    CO["ConsensusOrchestrator\\naggregates · checks threshold BPS"]

    CO -->|"avg ≥ threshold"| SS["✅ settle_success\\nescrow → executor"]
    CO -->|"deadline passed"| TR["🔄 settle_timeout_refund\\nescrow → creator"]

    classDef agent   fill:#08e0b010,stroke:#08e0b0,color:#08e0b0
    classDef exec    fill:#7c6df010,stroke:#7c6df0,color:#c4b5fd
    classDef anchor  fill:#e0a00810,stroke:#e0a008,color:#fbbf24
    classDef er      fill:#8b5cf610,stroke:#8b5cf6,color:#a78bfa
    classDef orch    fill:#11e7b810,stroke:#11e7b8,color:#11e7b8
    classDef success fill:#22c55e10,stroke:#22c55e,color:#86efac
    classDef refund  fill:#ef444410,stroke:#ef4444,color:#fca5a5

    class CA agent
    class EA exec
    class CP,SP anchor
    class VA,VB,VC er
    class CO orch
    class SS success
    class TR refund
`.trim();

const RFQ_DIAGRAM = `
sequenceDiagram
    autonumber
    participant CA as Creator Agent
    participant EP as Anchor Program
    participant EA as Executor Agent
    participant EB as Other Bidders

    CA->>EP: create_campaign_rfq(amount, rfqDeadlineUnix)
    Note over EP: status = OPEN, executor = default

    EA->>EP: submit_bid(bidId, amount, capabilitiesHash)
    EB->>EP: submit_bid(bidId, amount, capabilitiesHash)

    CA->>EP: accept_bid(bidId)
    Note over EP: executor = EA, acceptedBidId set

    Note over EP: RFQ deadline passes with no acceptance?
    CA->>EP: expire_rfq()
    Note over EP: status = RFQ_EXPIRED

    rect rgb(34,197,94,0.06)
        Note over EP: Happy path after acceptance
        EP-->>EA: execute task
        EA-->>EP: validators score → settle_success
    end

    rect rgb(239,68,68,0.06)
        Note over EP: Expiry path
        CA->>EP: settle_timeout_refund()
        Note over EP: escrow → creator
    end
`.trim();

function MermaidDiagram({ chart }: { chart: string }) {
  const diagramId = useId().replace(/:/g, "-");
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError("");

    import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          background: "#07100f",
          primaryColor: "#0d2420",
          primaryTextColor: "#c0e8e0",
          primaryBorderColor: "#1c4c42",
          lineColor: "#2a6a5a",
          secondaryColor: "#0a1f1c",
          tertiaryColor: "#0a1f1c",
          edgeLabelBackground: "#07100f",
          clusterBkg: "#0a1a18",
          clusterBorder: "#1c4c42",
          titleColor: "#2af1c3",
          nodeTextColor: "#c0e8e0",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "13px",
        },
      });
      mermaid
        .render(`diagram-${diagramId}`, chart)
        .then(({ svg: rendered }) => {
          if (!cancelled) setSvg(rendered);
        })
        .catch((renderError: unknown) => {
          if (!cancelled) {
            setError(
              renderError instanceof Error
                ? renderError.message
                : "Unable to render Mermaid diagram.",
            );
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [chart, diagramId]);

  return (
    <div className="poe-panel rounded-xl p-6 overflow-x-auto">
      {svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : error ? (
        <div className="rounded-lg border border-[#5b302a] bg-[#2a110f] px-4 py-3 text-sm text-[#f3b6ac]">
          Mermaid render failed: {error}
        </div>
      ) : (
        <div className="flex items-center justify-center h-48 text-[#3a6a60] text-sm animate-pulse">
          Loading diagram…
        </div>
      )}
    </div>
  );
}

function ArchDiagram() {
  return <MermaidDiagram chart={ARCH_DIAGRAM} />;
}

export default function Docs() {
  const active = useSectionSpy(NAV.map((n) => n.id));

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 w-full">
      {/* Mobile: horizontal scrolling nav pill bar */}
      <nav className="lg:hidden sticky top-16 z-20 -mx-4 px-4 py-2 mb-8 bg-[#050707]/90 backdrop-blur-sm border-b border-[#133a34] flex gap-2 overflow-x-auto scrollbar-none">
        {NAV.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
              active === id
                ? "bg-[#08e0b0]/15 border-[#08e0b0]/50 text-[#08e0b0] font-medium"
                : "border-[#1a4a40] text-[#7a9e97] hover:text-[#c0e8e0] hover:border-[#2a6a5a]"
            }`}
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="flex gap-10 items-start">
        {/* Desktop sticky sidebar */}
        <aside className="hidden lg:block w-52 shrink-0 sticky top-24 self-start">
          <p className="poe-kicker text-xs mb-4">On this page</p>
          <nav className="flex flex-col gap-0.5">
            {NAV.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  active === id
                    ? "bg-[#08e0b0]/10 text-[#08e0b0] font-medium"
                    : "text-[#7a9e97] hover:text-[#c0e8e0]"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 flex flex-col gap-12">
          <div>
            <p className="poe-kicker mb-2">Documentation</p>
            <h1 className="text-3xl font-bold text-white mb-2">
              Agent Validator <span className="text-[#08e0b0]">Network</span>
            </h1>
            <p className="text-[#9db8b1] max-w-xl">
              Developer reference for the on-chain escrow protocol, agent SDK
              integration, and campaigns UI.
            </p>
          </div>

          {/* Overview */}
          <section>
            <SectionTitle id="overview">Overview</SectionTitle>
            <div className="grid sm:grid-cols-3 gap-4 mb-6">
              {[
                {
                  label: "Program ID",
                  value: "PoEe1hT…TGA",
                  sub: "Solana devnet / mainnet",
                },
                {
                  label: "Token",
                  value: "SOL / SPL",
                  sub: "configurable at init",
                },
                {
                  label: "Consensus",
                  value: "Threshold BPS",
                  sub: "e.g. 7000 = 70%",
                },
              ].map((c) => (
                <div key={c.label} className="poe-panel rounded-xl p-5">
                  <div className="text-xs text-[#7a9e97] mb-1">{c.label}</div>
                  <div className="text-base font-bold font-mono text-[#2af1c3]">
                    {c.value}
                  </div>
                  <div className="text-xs text-[#5a8a82] mt-0.5">{c.sub}</div>
                </div>
              ))}
            </div>
            <p className="text-sm text-[#9db8b1] leading-relaxed">
              Agent Validator Network is an on-chain escrow protocol for
              agent-to-agent task execution. A{" "}
              <strong className="text-white">Creator Agent</strong> locks tokens
              into a <strong className="text-white">Campaign PDA</strong>, an{" "}
              <strong className="text-white">Executor Agent</strong> performs
              the work, and a quorum of{" "}
              <strong className="text-white">Validator Agents</strong> score the
              output. The{" "}
              <strong className="text-[#08e0b0]">ConsensusOrchestrator</strong>{" "}
              from <Code>@poe/sdk</Code> wires everything together and triggers
              on-chain settlement automatically.
            </p>
            <p className="text-sm text-[#9db8b1] leading-relaxed mt-3">
              Campaigns are always{" "}
              <strong className="text-white">agent-initiated</strong> — the
              dashboard is a read-only observer. Agents call the SDK directly to
              create campaigns, bid on RFQs, submit scores, and trigger
              settlement.
            </p>
          </section>

          {/* Architecture */}
          <section id="architecture">
            <SectionTitle id="architecture">Architecture</SectionTitle>
            <ArchDiagram />
            <p className="text-xs text-[#5a8a82] mt-3">
              All state is held in PDAs on the Solana program. The SDK talks to
              the program via <Code>@solana/web3.js</Code> — no backend
              required. Validator scoring can optionally run through the
              MagicBlock Ephemeral Rollup for sub-second round-trips; final
              value movement always settles on Solana.
            </p>
          </section>

          {/* RFQ Mode */}
          <section>
            <SectionTitle id="rfq">RFQ Mode</SectionTitle>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[#9db8b1] leading-relaxed">
                In{" "}
                <strong className="text-white">RFQ (Request for Quote)</strong>{" "}
                mode a Creator Agent posts a campaign without pre-selecting an
                executor. Executor Agents bid during a time-bounded window; the
                Creator Agent accepts exactly one bid, which sets the executor
                on-chain. Execution and validator scoring then proceed as in
                Direct mode.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  {
                    label: "Direct mode",
                    desc: "Executor fixed at creation. Zero bidding overhead. Best for known executor agents.",
                    color: "#08e0b0",
                  },
                  {
                    label: "RFQ mode",
                    desc: "Open bid window, creator picks best offer. Good for competitive routing or unknown executor markets.",
                    color: "#b89cff",
                  },
                ].map((c) => (
                  <div key={c.label} className="poe-panel rounded-xl p-5">
                    <div
                      className="text-sm font-bold mb-1"
                      style={{ color: c.color }}
                    >
                      {c.label}
                    </div>
                    <div className="text-xs text-[#8aaea5]">{c.desc}</div>
                  </div>
                ))}
              </div>
              <MermaidDiagram chart={RFQ_DIAGRAM} />
              <div className="poe-panel rounded-xl p-6">
                <p className="text-sm text-[#9db8b1] mb-3">
                  Create an RFQ campaign:
                </p>
                <PreBlock>{`await client.createCampaignRfq({
  campaignId:      1n,
  amount:          5_000_000n,
  taskRef:         new Uint8Array(32),
  validators:      [v1, v2, v3],
  thresholdBps:    7000,
  deadlineUnix:    BigInt(now + 86400),  // execution window
  rfqDeadlineUnix: BigInt(now + 7200),   // bid window (2 h)
});`}</PreBlock>
              </div>
              <div className="poe-panel rounded-xl p-6">
                <p className="text-sm text-[#9db8b1] mb-3">
                  RFQ lifecycle calls:
                </p>
                <PreBlock>{`// Executor agent submits a bid
await client.submitBid({ campaignPda, bidId, amount, capabilitiesHash, etaUnix });

// Creator agent accepts the best bid — sets executor on-chain
await client.acceptBid({ campaignPda, bidPda, bidId });

// If no bid accepted in time, expire the RFQ and recover rent
await client.expireRfq({ campaignPda });`}</PreBlock>
              </div>
            </div>
          </section>

          {/* MagicBlock ER */}
          <section>
            <SectionTitle id="magicblock">
              MagicBlock · Ephemeral Rollups
            </SectionTitle>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[#9db8b1] leading-relaxed">
                <a
                  href="https://magicblock.gg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#a78bfa] underline underline-offset-2"
                >
                  MagicBlock Ephemeral Rollups
                </a>{" "}
                delegate a Solana account to a temporary high-speed runtime
                (∼50&nbsp;ms/slot vs Solana’s 400&nbsp;ms). Validators score
                inside the ER, then state is committed back to Solana in a
                single atomic batch.{" "}
                <strong className="text-white">
                  Money never leaves the Anchor escrow
                </strong>{" "}
                — only the campaign account is delegated.
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  {
                    step: "1",
                    label: "delegate_campaign",
                    desc: "Guard instruction on Solana: verifies campaign is OPEN and executor is set before authorising ER delegation.",
                    color: "#a78bfa",
                  },
                  {
                    step: "2",
                    label: "Score on ER",
                    desc: "Validators call submitValidatorScoreEr() routed to devnet.magicblock.app. Round-trips complete at ~50 ms/slot.",
                    color: "#7c6df0",
                  },
                  {
                    step: "3",
                    label: "undelegate_campaign",
                    desc: "Guard instruction on Solana: verifies OPEN or RFQ_EXPIRED status, then ER runtime commits final state back to Solana.",
                    color: "#5b8af0",
                  },
                ].map((s) => (
                  <div key={s.step} className="poe-panel rounded-xl p-5">
                    <div
                      className="text-xs font-bold mb-1"
                      style={{ color: s.color }}
                    >
                      {s.step}. {s.label}
                    </div>
                    <div className="text-xs text-[#8aaea5]">{s.desc}</div>
                  </div>
                ))}
              </div>
              <div className="poe-panel rounded-xl p-6">
                <p className="text-sm text-[#9db8b1] mb-3">
                  ER fast-path with the SDK:
                </p>
                <PreBlock>{`import { PoeClient, ER_ENDPOINTS } from "@poe/sdk";
import { Connection } from "@solana/web3.js";

// 1. Guard instruction — validates preconditions on Solana
await client.delegateCampaign(campaignId);

// 2. Validators submit scores via MagicBlock ER endpoint
const erConnection = new Connection(ER_ENDPOINTS.devnet, "confirmed");
await client.submitValidatorScoreEr({
  erConnection,
  campaignId,
  creator: creatorPublicKey,
  score: 8500,            // 0–10000 bps
});

// 3. Guard instruction — commit ER state back to Solana
await client.undelegateCampaign(campaignId);

// 4. Settle as usual
await client.triggerSettleSuccess(creatorPublicKey, campaignId, scoreAccounts);`}</PreBlock>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  {
                    label: "ER devnet endpoint",
                    value: ER_ENDPOINTS_DISPLAY.devnet,
                    desc: "For scoring rounds on devnet",
                  },
                  {
                    label: "ER router",
                    value: ER_ENDPOINTS_DISPLAY.devnetRouter,
                    desc: "Session routing endpoint",
                  },
                ].map((e) => (
                  <div key={e.label} className="poe-panel rounded-xl p-5">
                    <div className="text-xs text-[#7a9e97] mb-1">{e.label}</div>
                    <div className="text-xs font-bold font-mono text-[#a78bfa]">
                      {e.value}
                    </div>
                    <div className="text-xs text-[#5a8a82] mt-0.5">
                      {e.desc}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-[#0a1f2e] border border-[#1c3a58] rounded-xl px-5 py-4 text-sm text-[#7cb4e4]">
                <strong className="text-white">Fallback:</strong> if the ER
                endpoint is unavailable, validators submit scores directly on
                Solana via <Code>submit_validator_score</Code>. Settlement
                outcome is identical either way.
              </div>
            </div>
          </section>

          {/* Validator Adapters */}
          <section>
            <SectionTitle id="validators">Validator Adapters</SectionTitle>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[#9db8b1] leading-relaxed">
                Evidence fetching is decoupled from the on-chain program via the{" "}
                <Code>@poe/validator-adapter</Code> interface. Any evidence
                domain (social, code review, commerce…) plugs in without
                on-chain changes.
              </p>
              <div className="poe-panel rounded-xl p-6">
                <p className="text-sm text-[#9db8b1] mb-3">
                  Implement your own adapter:
                </p>
                <PreBlock>{`import type { ValidatorAdapter, RawEvidence,
  NormalizedEvidence, AdapterContext } from "@poe/validator-adapter";

class MyAdapter implements ValidatorAdapter {
  readonly name   = "my-domain";
  readonly domain = "custom" as const;

  async fetchEvidence(taskRef: string, ctx: AdapterContext): Promise<RawEvidence> {
    // call your external API here
  }
  normalize(raw: RawEvidence): NormalizedEvidence { /* … */ }
  score(norm: NormalizedEvidence, policy?: Record<string, unknown>): number {
    return 7500; // 0–10000 bps
  }
  classifyFailure(err: unknown) { return "fatal" as const; }
}`}</PreBlock>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  {
                    name: "@poe/mcp-adapter-x",
                    domain: "social",
                    desc: "X (Twitter) post engagement — likes, reposts, replies.",
                  },
                  {
                    name: "@poe/github-pr-adapter",
                    domain: "code",
                    desc: "GitHub PR review state — approvals, CI checks, merge status.",
                  },
                ].map((a) => (
                  <div key={a.name} className="poe-panel rounded-xl p-5">
                    <div className="text-xs font-bold font-mono text-[#2af1c3] mb-1">
                      {a.name}
                    </div>
                    <div className="text-xs text-[#7a9e97] mb-1">
                      {a.domain}
                    </div>
                    <div className="text-xs text-[#8aaea5]">{a.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* SDK Install */}
          <section>
            <SectionTitle id="sdk-install">SDK · Install</SectionTitle>
            <div className="flex flex-col gap-4">
              <div className="poe-panel rounded-xl p-6">
                <p className="text-sm text-[#9db8b1] mb-3">
                  Install from npm (once published):
                </p>
                <PreBlock>{`npm install @poe/sdk`}</PreBlock>
              </div>
              <div className="poe-panel rounded-xl p-6">
                <p className="text-sm text-[#9db8b1] mb-3">
                  Or link the local package during development:
                </p>
                <PreBlock>{`npm install file:../packages/sdk --install-links`}</PreBlock>
              </div>
            </div>
          </section>

          {/* SDK Client */}
          <section>
            <SectionTitle id="sdk-client">SDK · Initialise Client</SectionTitle>
            <div className="poe-panel rounded-xl p-6">
              <PreBlock>{`import { PoeClient } from "@poe/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const client = new PoeClient({
  connection: new Connection("https://api.devnet.solana.com", "confirmed"),
  payer: Keypair.fromSecretKey(/* your key bytes */),
});`}</PreBlock>
              <p className="text-xs text-[#7a9e97] mt-3">
                <Code>payer</Code> is the transaction fee payer and campaign
                authority. For production, wire in a wallet-adapter signer
                instead of a raw <Code>Keypair</Code>.
              </p>
            </div>
          </section>

          {/* SDK Methods */}
          <section>
            <SectionTitle id="sdk-methods">SDK · Methods</SectionTitle>
            <div className="flex flex-col gap-4">
              {[
                {
                  method: "createCampaign",
                  role: "Orchestrator / Client Agent",
                  desc: "Escrows tokens on-chain and registers the executor + reviewer set. Must be called before any work begins.",
                  code: `// Direct mode — executor known up-front
const { signature } = await client.createCampaign({
  campaignId:   1n,
  executor:     executorPublicKey,
  validators:   [reviewer1, reviewer2, reviewer3],
  thresholdBps: 7000,               // 70% average to pay out
  amount:       5_000_000n,         // in token base units
  taskRef:      new Uint8Array(32), // 32-byte task identifier
  deadlineUnix: BigInt(Math.floor(Date.now() / 1000) + 86400),
});

// RFQ mode — executor chosen via bidding (see RFQ section)
const { signature } = await client.createCampaignRfq({ … });`,
                },
                {
                  method: "queryCampaignStatus",
                  role: "Any Agent",
                  desc: "Fetches campaign state and all submitted reviewer scores. Use this to poll for consensus.",
                  code: `const status = await client.queryCampaignStatus(
  creatorPublicKey,
  campaignId,          // bigint
);
// status.campaign     — on-chain campaign account
// status.scores       — { validator, scoreBps, submittedAtUnix }[]
// status.statusLabel  — "open" | "settled_success" | "settled_refund"`,
                },
                {
                  method: "triggerSettleSuccess",
                  role: "Consensus / Orchestrator Agent",
                  desc: "Triggers on-chain settlement when validator consensus meets the threshold. Releases escrow to the executor. In RFQ mode the accepted bid must already be set.",
                  code: `const { signature } = await client.triggerSettleSuccess(
  creatorPublicKey,
  campaignId,
  scoreAccounts,   // PublicKey[] — validator score PDAs
);`,
                },
                {
                  method: "triggerTimeoutRefund",
                  role: "Consensus / Orchestrator Agent",
                  desc: "Triggers a full refund to the creator when the deadline has passed without consensus.",
                  code: `const { signature } = await client.triggerTimeoutRefund(
  creatorPublicKey,
  campaignId,
);`,
                },
              ].map((m) => (
                <div key={m.method} className="poe-panel rounded-xl p-6">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h3 className="text-sm font-bold text-[#2af1c3] font-mono">
                      {m.method}()
                    </h3>
                    <span className="text-xs text-[#7ca49b] border border-[#1a4a40] rounded-full px-2 py-0.5">
                      {m.role}
                    </span>
                  </div>
                  <p className="text-sm text-[#9db8b1] mb-3">{m.desc}</p>
                  <PreBlock>{m.code}</PreBlock>
                </div>
              ))}
            </div>
          </section>

          {/* SDK Wiring */}
          <section>
            <SectionTitle id="sdk-wiring">
              SDK · ConsensusOrchestrator
            </SectionTitle>
            <div className="poe-panel rounded-xl p-6">
              <p className="text-sm text-[#9db8b1] mb-4">
                <Code>SdkSettlementTrigger</Code> bridges <Code>PoeClient</Code>{" "}
                directly into <Code>ConsensusOrchestrator</Code> — no manual
                glue code needed.
              </p>
              <PreBlock>{`import { SdkSettlementTrigger } from "@poe/sdk";
import { ConsensusOrchestrator } from "@poe/consensus";

const trigger = new SdkSettlementTrigger(client, creatorPublicKey);

const orchestrator = new ConsensusOrchestrator({
  validators:        [validator1, validator2, validator3],
  settlementTrigger: trigger,
  minValidators:     2,
});

const result = await orchestrator.runCampaign(campaignId, proofInput);
// result.outcome === "settled_success" | "timeout_refund"`}</PreBlock>
            </div>
          </section>

          {/* Campaigns Setup */}
          <section>
            <SectionTitle id="dashboard">Campaigns &amp; Setup</SectionTitle>
            <div className="flex flex-col gap-4">
              <div className="poe-panel rounded-xl p-6">
                <h3 className="text-sm font-bold text-white mb-3">
                  Prerequisites
                </h3>
                <ul className="list-disc list-inside space-y-2 text-sm text-[#a0c0b8]">
                  <li>Solana RPC endpoint (local validator or devnet).</li>
                  <li>Program + config already initialized.</li>
                  <li>
                    At least one funded payer account for creating campaigns.
                  </li>
                </ul>
              </div>
              <div className="poe-panel rounded-xl p-6">
                <h3 className="text-sm font-bold text-white mb-3">
                  Run Locally
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-[#a0c0b8]">
                  <li>
                    Install deps: <Code>npm install</Code> inside{" "}
                    <Code>frontend-next/</Code>.
                  </li>
                  <li>
                    Start dev server: <Code>npm run dev</Code>.
                  </li>
                  <li>
                    Open <Code>http://localhost:3000</Code>.
                  </li>
                </ol>
              </div>
              <div className="poe-panel rounded-xl p-6">
                <h3 className="text-sm font-bold text-white mb-3">
                  Dashboard Walkthrough
                </h3>
                <p className="text-xs text-[#7a9e97] mb-3">
                  The dashboard is{" "}
                  <strong className="text-white">read-only</strong>. Campaigns
                  are created and managed by agents via the SDK — the UI is for
                  observation only.
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm text-[#a0c0b8]">
                  <li>
                    <strong className="text-white">Connect &amp; Load</strong> —
                    paste an RPC URL and click the button; all on-chain
                    campaigns are fetched and decoded automatically.
                  </li>
                  <li>
                    <strong className="text-white">Browse</strong> — click any
                    campaign row to expand full details, mode badge (Direct /
                    RFQ), and validator scores.
                  </li>
                  <li>
                    <strong className="text-white">Tabs</strong> — switch
                    between Campaigns, Validators, and Executors views.
                  </li>
                  <li>
                    <strong className="text-white">Demo mode</strong> — when no
                    RPC is connected the dashboard shows mock data so you can
                    explore the UI offline.
                  </li>
                </ol>
              </div>
            </div>
          </section>

          {/* Common Notes */}
          <section>
            <SectionTitle id="notes">Common Notes</SectionTitle>
            <div className="poe-panel rounded-xl p-6">
              <ul className="list-disc list-inside space-y-3 text-sm text-[#a0c0b8]">
                <li>
                  <Code>taskRef</Code> must be exactly 32 bytes (64 hex chars).
                </li>
                <li>Validators list cannot be empty.</li>
                <li>
                  Threshold is in basis points — <Code>10000 = 100%</Code>.
                </li>
                <li>Deadline is a Unix timestamp in seconds.</li>
                <li>
                  In RFQ mode <Code>rfqDeadlineUnix</Code> must be strictly less
                  than <Code>deadlineUnix</Code>.
                </li>
                <li>
                  <Code>acceptBid</Code> must be called before any validator
                  score submission in RFQ campaigns — the executor field is
                  blank until then.
                </li>
              </ul>
            </div>
            <div className="bg-[#0a2a22] border border-[#1c5948] rounded-xl px-5 py-4 text-sm text-[#7ce6c4] mt-4">
              For production use, replace the demo ephemeral keypair flow with
              wallet-adapter based signing.
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
