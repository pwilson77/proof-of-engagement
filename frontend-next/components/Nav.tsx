import NavEnvDropdown from "./NavEnvDropdown";

export default function Nav() {
  return (
    <header className="border-b border-[#133a34] bg-[#060a09]/90 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <a
          href="/"
          className="text-base font-bold tracking-tight text-white uppercase"
        >
          Agent Validator <span className="text-[#1beabf]">Network</span>
        </a>
        <nav className="flex items-center gap-5">
          <a
            href="/"
            className="text-sm font-semibold text-[#8db1aa] hover:text-[#2af1c3]"
          >
            Home
          </a>
          <a
            href="/docs"
            className="text-sm font-semibold text-[#8db1aa] hover:text-[#2af1c3]"
          >
            Docs
          </a>
          <a
            href="/dashboard"
            className="text-sm font-semibold text-[#8db1aa] hover:text-[#2af1c3]"
          >
            Campaigns
          </a>
          <NavEnvDropdown />
        </nav>
      </div>
    </header>
  );
}
