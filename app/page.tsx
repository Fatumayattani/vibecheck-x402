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

  // search state
  const [working, setWorking] = useState(false);
  const [foundProfile, setFoundProfile] = useState<any | null>(null);
  const [imgError, setImgError] = useState(false);

  // Combined flow: search -> /api/check
  async function searchAndCheck() {
    try {
      setWorking(true);
      setErrMsg(null);
      setFoundProfile(null);
      setReport(null);
      setPaymentMeta(null);

      if (!handle && !name) {
        setErrMsg("Provide a handle or name to search.");
        setWorking(false);
        return;
      }

      // 1) search
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, platform, name }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrMsg(data?.error || "Search failed");
        setWorking(false);
        return;
      }
      if (data.found === false) {
        setErrMsg(data.message || "No profile found");
        setWorking(false);
        return;
      }

      const p = data.profile;
      setName(p.name || name);
      setHandle(p.handle || handle);
      setPlatform(p.platform || platform);
      setBio(p.bio || bio);
      setFoundProfile(p);

      // 2) call /api/check with the profile object
      setStatus("loading");
      const checkRes = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: p.name || name,
          handle: p.handle || handle,
          platform: p.platform || platform,
          bio: p.bio || bio,
        }),
      });

      if (checkRes.status === 402) {
        const meta = await checkRes.json();
        setPaymentMeta(meta);
        setStatus("pay");
        setWorking(false);
        return;
      }

      const reportJson = await checkRes.json();
      setReport(reportJson);
      setStatus("done");
      setWorking(false);
    } catch (e: any) {
      setErrMsg(e?.message || "Search + check failed");
      setWorking(false);
      setStatus("error");
    }
  }

  // Fetch the protected report (used by "Result" button)
  async function fetchResult() {
    try {
      setErrMsg(null);

      // If we already have a report, nothing to fetch
      if (report) return;

      // If paymentMeta exists, try to fetch by checkId
      if (paymentMeta?.checkId) {
        const res = await fetch(`/api/check?checkId=${paymentMeta.checkId}`);
        if (res.status === 402) {
          setErrMsg("Report still locked (not paid).");
          return;
        }
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setErrMsg(json?.error || "Failed to fetch report");
          return;
        }
        const data = await res.json();
        setReport(data);
        setStatus("done");
        return;
      }

      setErrMsg("No checkId available. Run 'Run Vibe Check' first.");
    } catch (e: any) {
      setErrMsg(e?.message || "Failed to fetch result");
    }
  }

  // Payment flow (unchanged): Phantom + SOL transfer, then fetch report
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

  // Helper: generate initials avatar when image not available
  function initialsAvatar(nameStr?: string, handleStr?: string) {
    const source = nameStr || handleStr || "";
    const parts = source.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return "?";
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
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

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={searchAndCheck}
            style={{ ...styles.primaryBtn, width: "50%", background: "#06b6d4" }}
            disabled={working || status === "loading" || status === "paying"}
          >
            {working || status === "loading" ? "Working…" : "Run Vibe Check"}
          </button>
          <button
            onClick={() => { setName(""); setHandle(""); setBio(""); setFoundProfile(null); setErrMsg(null); setPaymentMeta(null); setReport(null); setStatus("idle"); }}
            style={{ ...styles.primaryBtn, width: "48%", background: "#ef4444" }}
          >
            Reset
          </button>
          <button
            onClick={fetchResult}
            style={{ ...styles.primaryBtn, width: "50%", background: "#8b5cf6" }}
            disabled={status === "loading" || status === "paying"}
          >
            Fetch Result
          </button>
        </div>
      </div>

      {errMsg && (
        <div style={styles.errorBox}>
          <b>Error:</b> {errMsg}
        </div>
      )}

      {/* Found profile preview (image + details). If image fails, show initials avatar */}
      {foundProfile && (
  <div
    style={{
      ...styles.payBox,
      marginTop: 12,
      display: "flex",
      gap: 12,
      alignItems: "center",
    }}
  >
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#222",
      }}
    >
      {foundProfile.profile_pic && !imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={foundProfile.profile_pic}
          alt="pfp"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgError(true)}
        />
      ) : (
        <div style={{ color: "white", fontSize: 22, fontWeight: 700 }}>
          {initialsAvatar(foundProfile.name, foundProfile.handle)}
        </div>
      )}
    </div>

    <div>
      <div style={{ marginBottom: 4 }}>
        <b>{foundProfile.name ?? "Unknown"}</b>{" "}
        <span style={{ opacity: 0.8 }}>@{foundProfile.handle ?? ""}</span>
      </div>

      {/* Profile link (opens first source URL) */}
      {Array.isArray(foundProfile.source_urls) && foundProfile.source_urls.length > 0 && (
        <a
          href={foundProfile.source_urls[0]}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 13,
            color: "#06b6d4",
            textDecoration: "none",
            display: "inline-block",
            marginBottom: 6,
          }}
        >
          🔗 View profile
        </a>
      )}

      <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>
        {foundProfile.bio}
      </div>

      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {foundProfile.followers ? `${foundProfile.followers} followers • ` : ""}
        {foundProfile.last_active
          ? `Last active: ${new Date(foundProfile.last_active).toLocaleDateString()}`
          : ""}
      </div>
    </div>
  </div>
)}


      {/* Payment UI */}
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
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={doPayment} style={styles.payBtn} disabled={status === "paying"}>
              {status === "paying" ? "Waiting for wallet…" : "Pay with Solana (Phantom)"}
            </button>
            <button onClick={() => fetchResult()} style={{ ...styles.primaryBtn, background: "#f59e0b" }}>
              Try fetch result
            </button>
          </div>
        </div>
      )}

      {/* Report UI */}
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
    marginTop: 0,
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
