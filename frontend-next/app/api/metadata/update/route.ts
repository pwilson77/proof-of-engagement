import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "edge";

const BLOB_KEY = "campaign-metadata.devnet.json";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Token-gate: require Authorization: Bearer <SEED_API_SECRET>
  const secret = process.env.SEED_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SEED_API_SECRET not configured on server" },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !("campaigns" in body)) {
    return NextResponse.json(
      { error: "Body must be a MetadataDocument with a campaigns field" },
      { status: 422 },
    );
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not configured on server" },
      { status: 500 },
    );
  }

  const result = await put(BLOB_KEY, JSON.stringify(body), {
    access: "public",
    contentType: "application/json",
    token,
    addRandomSuffix: false,
  });

  return NextResponse.json({ ok: true, url: result.url }, { status: 200 });
}
