import { NextResponse } from "next/server";

// this route runs on the server, so CORS isn't a problem here
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { payment_endpoint, amount, receiver, network, currency } = body;

    if (!payment_endpoint) {
      return NextResponse.json(
        { error: "payment_endpoint required" },
        { status: 400 }
      );
    }

    // forward the request to the real x402 endpoint (Rapid402 / Corbits)
    const upstream = await fetch(payment_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        receiver,
        network,
        currency,
      }),
    });

    const json = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "upstream payment failed", upstream: json },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, upstream: json });
  } catch (err) {
    console.error("x402-pay error:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
