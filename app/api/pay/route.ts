import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const { checkId } = body;

  if (!checkId) {
    return NextResponse.json({ error: "checkId required" }, { status: 400 });
  }

  // get the shared PAID set from the other file
  // @ts-ignore
  const PAID: Set<string> = globalThis.__WIPECHECK_PAID__ || new Set();
  PAID.add(checkId);
  // @ts-ignore
  globalThis.__WIPECHECK_PAID__ = PAID;

  // here is where real Solana/x402 verification would go later

  return NextResponse.json({ ok: true });
}
