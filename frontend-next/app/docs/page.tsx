export default function Docs() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 flex flex-col gap-6 w-full">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 mb-2">Docs</h1>
        <p className="text-zinc-500">
          Quick guide to running the app and using the dashboard for a
          local/devnet campaign flow.
        </p>
      </div>

      {[
        {
          title: "Prerequisites",
          items: [
            "Solana RPC endpoint (local validator or devnet).",
            "Program + config already initialized.",
            "At least one funded payer account for creating campaigns.",
          ],
          ordered: false,
        },
        {
          title: "Run Locally",
          items: [
            <>
              Install deps:{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-sm font-mono">
                npm install
              </code>{" "}
              inside{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-sm font-mono">
                frontend-next/
              </code>
              .
            </>,
            <>
              Start dev server:{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-sm font-mono">
                npm run dev
              </code>
              .
            </>,
            <>
              Open{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-sm font-mono">
                http://localhost:3000
              </code>
              .
            </>,
          ],
          ordered: true,
        },
        {
          title: "Dashboard Walkthrough",
          items: [
            <>
              <strong>Connect &amp; Load</strong>: set RPC URL and click the
              button — all campaigns are fetched automatically.
            </>,
            <>
              <strong>Browse</strong>: click any campaign row to expand full
              details and validator scores.
            </>,
            <>
              <strong>Create Campaign</strong>: fill the form at the bottom and
              submit.
            </>,
            <>
              <strong>Settle</strong>: open campaigns show inline Settle Success
              / Timeout Refund buttons.
            </>,
          ],
          ordered: true,
        },
        {
          title: "Common Notes",
          items: [
            <>
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-sm font-mono">
                taskRef
              </code>{" "}
              must be exactly 64 hex chars (32 bytes).
            </>,
            "Validators list cannot be empty.",
            <>
              Threshold is in basis points —{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-sm font-mono">
                10000 = 100%
              </code>
              .
            </>,
            "Deadline is a Unix timestamp in seconds.",
          ],
          ordered: false,
        },
      ].map((section) => (
        <div
          key={section.title}
          className="bg-white border border-zinc-200 rounded-xl p-6"
        >
          <h2 className="text-base font-bold text-zinc-800 mb-3">
            {section.title}
          </h2>
          {section.ordered ? (
            <ol className="list-decimal list-inside space-y-2 text-sm text-zinc-600">
              {section.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          ) : (
            <ul className="list-disc list-inside space-y-2 text-sm text-zinc-600">
              {section.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div className="bg-teal-50 border border-teal-200 rounded-xl px-5 py-4 text-sm text-teal-800">
        For production use, replace the demo ephemeral keypair flow with
        wallet-adapter based signing.
      </div>
    </div>
  );
}
