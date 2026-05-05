import NavEnvDropdown from "./NavEnvDropdown";

export default function Nav() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <a href="/" className="text-base font-bold tracking-tight text-zinc-900">
          Proof-of-<span className="text-teal-700">Engagement</span>
        </a>
        <nav className="flex items-center gap-5">
          <a
            href="/"
            className="text-sm font-semibold text-zinc-500 hover:text-teal-700"
          >
            Home
          </a>
          <a
            href="/docs"
            className="text-sm font-semibold text-zinc-500 hover:text-teal-700"
          >
            Docs
          </a>
          <a
            href="/dashboard"
            className="text-sm font-semibold text-zinc-500 hover:text-teal-700"
          >
            Dashboard
          </a>
          <NavEnvDropdown />
        </nav>
      </div>
    </header>
  );
}
