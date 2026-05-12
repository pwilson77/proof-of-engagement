import { NextResponse } from "next/server";
import { head } from "@vercel/blob";

export const runtime = "edge";

const BLOB_KEY = "campaign-metadata.devnet.json";
const STATIC_FALLBACK = "/campaign-metadata.devnet.json";

export async function GET(): Promise<NextResponse> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (token) {
    try {
      const meta = await head(BLOB_KEY, { token });
      const upstream = await fetch(meta.url, { cache: "no-store" });
      if (upstream.ok) {
        const data = await upstream.json();
        return NextResponse.json(data, {
          headers: {
            "Cache-Control": "no-store",
            "X-Metadata-Source": "blob",
          },
        });
      }
    } catch {
      // fall through to static file
    }
  }

  // Fallback: static public file (dev / no blob configured)
  return NextResponse.json(
    {
      schemaVersion: 1,
      cluster: "devnet",
      updatedAtUnix: 0,
      campaigns: {},
      _fallback: true,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Metadata-Source": "static-fallback",
      },
    },
  );
}
