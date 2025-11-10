"use client";

import { useState } from "react";
import {
  Connection,
  clusterApiUrl,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

type Status = "idle" | "loading" | "pay" | "paying" | "done" | "error";

export default function Home() {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState("tinder");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [paymentMeta, setPaymentMeta] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Submit profile -> expect HTTP 402 with x402 metadata
  async function submitProfile() {
    try {
      setStatus("loading");
      setReport(null);
      setErrMsg(null);

      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, handle, platform, bio }),
      });

      if (res.status === 402) {
        const data = await res.json();
        setPaymentMeta(data);
        setStatus("pay");
        return;
      }

      const data = await res.json();
      setReport(data);
      setStatus("done");
    } catch (e: any) {
      setErrMsg(e?.message || "Failed to run check");
      setStatus("error");
    }
  }

  // Real SOL payment on Solana Devnet via Phantom, then unlock
  async function doPayment() {
    if (!paymentMeta) return;

    try {
      setStatus("paying");
      setErrMsg(null);

      // Phantom provider
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider: any = (typeof window !== "undefined" && (window as any).solana) || null;
      if (!provider) {
        alert("Please install Phantom wallet to continue.");
        setStatus("pay");
        return;
      }

      // Connect (opens Phantom)
      const resp = await provider.connect();
      const fromPubkey = new PublicKey(resp.publicKey.toString());

      // Recipient + amount from 402 payload
      const recipient =
        paymentMeta.recipient || paymentMeta.pay_to; // support either field
      if (!recipient) {
        throw new Error("Missing recipient in payment metadata.");
      }
      const toPubkey = new PublicKey(recipient);

      // Amount: use 'amount' (in SOL) or default to 0.01 for demo
      const amountStr = String(paymentMeta.amount ?? "0.01");
      const amountSol = parseFloat(amountStr);
      if (Number.isNaN(amountSol) || amountSol <= 0) {
        throw new Error("Invalid amount in payment metadata.");
      }
      const lamports = Math.floor(amountSol * 1_000_000_000);

      // Devnet connection
      const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

      // Build transfer transaction
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: fromPubkey,
      }).add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports,
        })
      );

      // Sign & send via Phantom
      const signedTx = await provider.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      console.log("Payment signature:", sig);

      // After payment -> fetch the protected report
      const res = await fetch(`/api/check?checkId=${paymentMeta.checkId}`);
      const data = await res.json();
      setReport(data);
      setStatus("done");
    } catch (e: any) {
      console.error("solana payment error:", e);
      setErrMsg(e?.message || "Payment failed");
      setStatus("pay");
    }
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>VibeCheck.ai (x402 demo)</h1>
      <p style={styles.subtitle}>Verify a dating / social profile before you talk to them.</p>

      <div style={styles.card}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Profile name (e.g. Riya)"
          style={styles.input}
        />
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="Username / handle (optional)"
          style={styles.input}
        />
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          style={styles.input}
        >
          <option value="tinder">Tinder</option>
          <option value="bumble">Bumble</option>
          <option value="hinge">Hinge</option>
          <option value="instagram">Instagram</option>
          <option value="x">X / Twitter</option>
        </select>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          placeholder="Paste profile bio / description / notes"
          style={{ ...styles.input, height: 100 }}
        />
        <button onClick={submitProfile} style={styles.primaryBtn} disabled={status === "loading"}>
          {status === "loading" ? "Checking..." : "Run Vibe Check"}
        </button>
      </div>

      {errMsg && (
        <div style={styles.errorBox}>
          <b>Error:</b> {errMsg}
        </div>
      )}

      {status === "pay" && paymentMeta && (
        <div style={styles.payBox}>
          <h3 style={{ margin: 0 }}>402 Payment Required (x402)</h3>
          <p style={{ marginTop: 8 }}>
            Pay <b>{paymentMeta.amount ?? "0.01"}</b> {paymentMeta.currency ?? "SOL"} to unlock this
            vibe report.
          </p>
          <p style={{ fontSize: 12, opacity: 0.85 }}>
            Paying to: {(paymentMeta.recipient || paymentMeta.pay_to || "").slice(0, 6)}…
            {(paymentMeta.recipient || paymentMeta.pay_to || "").slice(-6)}
          </p>
          <button onClick={doPayment} style={styles.payBtn} disabled={status === "paying"}>
            {status === "paying" ? "Waiting for wallet…" : "Pay with Solana (Phantom)"}
          </button>
        </div>
      )}

      {status === "done" && report && (
        <div style={styles.reportBox}>
          <h3 style={{ marginTop: 0 }}>Vibe Report</h3>
          <p>
            <b>Score:</b> {report.score}
          </p>
          <p>
            <b>Risk:</b> {report.risk}
          </p>
          {Array.isArray(report.reasons) && report.reasons.length > 0 && (
            <ul>
              {report.reasons.map((r: string, i: number) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

/* ---------- styles ---------- */
const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#0e0e0e",
    color: "white",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: 24,
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system",
  },
  title: { fontSize: 28, margin: "8px 0" },
  subtitle: { opacity: 0.8, marginBottom: 20 },
  card: {
    background: "#111",
    padding: 20,
    borderRadius: 16,
    width: "100%",
    maxWidth: 520,
  },
  input: {
    width: "100%",
    background: "#1b1b1b",
    border: "1px solid #333",
    color: "white",
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    fontSize: 14,
  },
  primaryBtn: {
    background: "#8b5cf6",
    border: "none",
    padding: "10px 16px",
    borderRadius: 10,
    color: "white",
    width: "100%",
    cursor: "pointer",
    fontWeight: 600,
  },
  payBox: {
    background: "#fff3cd",
    color: "#111",
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    width: "100%",
    maxWidth: 520,
  },
  payBtn: {
    background: "#22c55e",
    border: "none",
    padding: "10px 16px",
    borderRadius: 10,
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
    marginTop: 8,
  },
  reportBox: {
    background: "#e6f0ff",
    color: "#111",
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    width: "100%",
    maxWidth: 520,
  },
  errorBox: {
    background: "#fee2e2",
    color: "#7f1d1d",
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    width: "100%",
    maxWidth: 520,
  },
};
