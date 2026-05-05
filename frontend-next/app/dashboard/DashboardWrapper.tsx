"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const DashboardClient = dynamic(() => import("./DashboardClient"), {
  ssr: false,
});

export default function DashboardWrapper() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-4 py-6 text-sm text-zinc-500">Loading dashboard…</div>}>
      <DashboardClient />
    </Suspense>
  );
}
