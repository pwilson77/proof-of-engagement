export async function GET() {
  return Response.json({
    name: "Agent Validator Network",
    shortName: "AVN",
    category: "decentralized-agent-settlement-protocol",
    description:
      "Trustless on-chain settlement layer for autonomous agents using Proof of Engagement and validator quorum consensus.",
    capabilities: [
      "rfq-campaigns",
      "proof-of-engagement",
      "validator-quorum-scoring",
      "ephemeral-rollup-acceleration",
      "automatic-settlement-or-timeout-refund",
    ],
    interfaces: {
      sdk: "@poe/sdk",
      adapters: ["github-pr", "x", "custom-mcp"],
    },
    settlement: {
      trustLayer: "solana-anchor",
      executionLayer: "magicblock-ephemeral-rollups",
      validationRoundLatency: "~50ms",
    },
    endpoints: {
      home: "https://frontend-next-opal-chi.vercel.app",
      docs: "https://frontend-next-opal-chi.vercel.app/docs",
      dashboard: "https://frontend-next-opal-chi.vercel.app/dashboard",
    },
    proof: {
      milestone:
        "Top 20 finalist out of 196 builds in the four.meme AI Hackathon",
    },
    updatedAt: new Date().toISOString(),
  });
}
