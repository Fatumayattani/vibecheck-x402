// app/api/search/route.ts
import { NextResponse } from "next/server";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders() });
}

type SearchRequest = {
  handle?: string;
  platform?: string;
  name?: string;
};

function safeJson(res: Response) {
  return res.json().catch(() => ({}));
}

function buildMockProfile(handle: string, platform: string, name?: string) {
  const lower = (handle || name || "").toLowerCase();
  if (lower.includes("riya") || platform === "instagram") {
    return {
      name: name || "Riya S.",
      handle: handle || "riya_travels",
      platform: platform || "instagram",
      bio: "Travel ✈️ | Coffee ☕ | Crypto-curious 💎 | Telegram: @riya_contact",
      profile_pic: "https://placekitten.com/320/320",
      followers: 5120,
      verified: false,
      last_active: "2025-10-20T12:34:00Z",
      source_urls: [],
    };
  } else if (lower.includes("alex") || platform === "tinder") {
    return {
      name: name || "Alex K",
      handle: handle || "alex99",
      platform: platform || "tinder",
      bio: "Outdoorsy • Indie music • Looking for someone who loves hikes",
      profile_pic: "https://placekitten.com/321/321",
      followers: 120,
      verified: false,
      last_active: "2025-11-01T09:00:00Z",
      source_urls: [],
    };
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body: SearchRequest = await req.json().catch(() => ({}));
    const handle = (body.handle || "").trim();
    const name = (body.name || "").trim();
    const platform = (body.platform || "").trim().toLowerCase();

    if (!handle && !name) {
      return new NextResponse(
        JSON.stringify({ error: "handle or name required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

    // If Tavern/Tavily key configured, attempt real search
    if (TAVILY_API_KEY) {
      try {
        const queryParts = [];
        if (handle) queryParts.push(handle);
        if (platform) queryParts.push(platform);
        if (name) queryParts.push(`"${name}"`);
        queryParts.push("profile");
        const query = queryParts.join(" ");

        const tavilyRes = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TAVILY_API_KEY}`,
          },
          body: JSON.stringify({
            query,
            depth: "basic",
            max_results: 5,
          }),
        });

        const tavilyJson = await safeJson(tavilyRes);

        if (tavilyRes.ok && (Array.isArray(tavilyJson.results) && tavilyJson.results.length > 0 || tavilyJson.answer)) {
          const results = tavilyJson.results || [];
          const socialHint =
            results.find((r: any) =>
              /(instagram\.com|t\.co|x\.com|twitter\.com|tiktok\.com|facebook\.com|linkedin\.com|tinder)/i.test(
                (r.link || r.url || "")
              )
            ) || results[0];

          const snippetParts: string[] = [];
          if (tavilyJson.answer && typeof tavilyJson.answer === "string") snippetParts.push(tavilyJson.answer);
          if (socialHint && socialHint.snippet) snippetParts.push(socialHint.snippet);
          for (let i = 0; i < Math.min(3, results.length); i++) {
            if (results[i].snippet) snippetParts.push(results[i].snippet);
          }

          let derivedName =
            name ||
            (typeof tavilyJson.answer_title === "string" ? tavilyJson.answer_title : undefined) ||
            (socialHint && (socialHint.title || socialHint.name));

          if (derivedName && typeof derivedName === "string") {
            derivedName = derivedName.replace(/\s*[-|•].*$/g, "").trim();
          }

          const bio = snippetParts.join(" ").slice(0, 800);

          // attempt to infer handle from socialHint.link
          let inferredHandle = handle || "";
          const source_urls = results.map((r: any) => r.link || r.url).filter(Boolean);
          if (!inferredHandle && socialHint && (socialHint.link || socialHint.url)) {
            try {
              const url = new URL(socialHint.link || socialHint.url);
              inferredHandle = url.pathname.split("/").filter(Boolean).pop() || "";
            } catch (e) {
              // ignore
            }
          }

          const profile = {
            name: derivedName || name || undefined,
            handle: inferredHandle || undefined,
            platform: platform || undefined,
            bio: bio || undefined,
            profile_pic: undefined,
            followers: undefined,
            verified: undefined,
            last_active: undefined,
            source_urls,
          };

          return new NextResponse(JSON.stringify({ found: true, profile }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        } else {
          // no meaningful tavily result -> fallback to mock
          const mock = buildMockProfile(handle, platform, name);
          if (mock) {
            return new NextResponse(JSON.stringify({ found: true, profile: mock }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...corsHeaders() },
            });
          }

          return new NextResponse(JSON.stringify({ found: false, message: "No profile found" }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        }
      } catch (tErr) {
        console.error("tavily search failed:", tErr);
        // fall back to mock below
      }
    }

    // fallback mock (no key or tavily failure)
    const mock = buildMockProfile(handle, platform, name);
    if (mock) {
      return new NextResponse(JSON.stringify({ found: true, profile: mock }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    return new NextResponse(JSON.stringify({ found: false, message: "No public profile found for that handle" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    console.error("api/search error:", err);
    return new NextResponse(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}
