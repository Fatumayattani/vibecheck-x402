// app/api/check/route.ts
import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

// in-memory store for this demo
const CHECKS: Record<string, any> = {};
const PAID: Set<string> = new Set();

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

// POST = user submits profile → we ask for x402 payment
export async function POST(req: Request) {
  const body = await req.json();
  const { name, handle, platform, bio } = body;

  const checkId = makeId();

  // store what they sent
CHECKS[checkId] = { name, handle, platform, bio };

const responseBody = {
  x402Version: 1,
  accepts: [
    {
      type: "solana",
      token: "SOL",
      network: "devnet",
      recipient: "AWDiwHHqjf1mxUH1fHLZaT6utStEYsszYLXmVpU4FRLV",
      amount: "0.01", // tiny SOL micropayment
    },
  ],
  checkId,
};

// Optional debug print (safe to remove later)
console.log(">>> 402 response being sent:", responseBody);

// ✅ return the response
return new NextResponse(JSON.stringify(responseBody), {
  status: 402,
  headers: {
    "Content-Type": "application/json",
    "X-402-Payment-Required": "true",
  },
});

}

// GET = after payment, frontend will call /api/check?checkId=abc to get the report
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const checkId = searchParams.get("checkId") || "";
  const sig = searchParams.get("sig");

  if (!checkId || !CHECKS[checkId]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ✅ added: verify payment on-chain using transaction signature
  if (sig && !PAID.has(checkId)) { // ✅ only verify if not already marked paid
    try {
      const connection = new Connection("https://api.devnet.solana.com"); // ✅ added: devnet connection
      const tx = await connection.getTransaction(sig, { commitment: "confirmed" }); // ✅ added: fetch transaction
      if (tx && tx.meta && !tx.meta.err) { // ✅ added: check if transaction succeeded
        PAID.add(checkId); // ✅ added: mark checkId as paid
        console.log(`💰 Payment confirmed for checkId: ${checkId}`); // ✅ added: debug log
      } else {
        console.log(`⚠️ Transaction not confirmed or invalid for sig: ${sig}`); // ✅ added: fallback log
      }
    } catch (err) {
      console.error("Error verifying payment:", err); // ✅ added: handle errors gracefully
    }
  }

  if (!PAID.has(checkId)) {
    return NextResponse.json({ error: "not paid" }, { status: 402 });
  }

  const data = CHECKS[checkId];

  // very simple fake analysis
  let score = 80;
  const reasons: string[] = [];

  if (!data.handle) {
    score -= 10;
    reasons.push("No public handle provided.");
  }
  if (!data.bio || data.bio.length < 10) {
    score -= 10;
    reasons.push("Bio is too short or missing.");
  }
  if (data.bio && data.bio.toLowerCase().includes("telegram")) {
    score -= 15;
    reasons.push("External contact in bio (Telegram).");
  }

  const risk = score < 40 ? "High" : score < 60 ? "Medium" : "Low";

  return NextResponse.json({
    score,
    risk,
    reasons,
    profile: {
      name: data.name,
      handle: data.handle,
      platform: data.platform,
    },
  });
}

// expose the PAID set so /api/pay can use it
// @ts-ignore
globalThis.__WIPECHECK_PAID__ = PAID;
