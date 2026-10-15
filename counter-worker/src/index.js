const WINDOW_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * WINDOW_MS;
const ALLOWED_ORIGIN = "https://pogodansk.tuqo.ru";
const BOT_PATTERN = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|telegrambot|whatsapp|discordbot|uptime|monitoring/i;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function visitorHash(ip, userAgent, secret) {
  const material = new TextEncoder().encode(`${secret}\n${ip}\n${userAgent.slice(0, 300)}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (url.pathname !== "/visit" && url.pathname !== "/count") {
      return json({ error: "Not found" }, 404);
    }
    if (!env.DB || !env.COUNTER_SALT) {
      return json({ error: "Counter is not configured" }, 503);
    }

    const now = Date.now();
    try {
      if (url.pathname === "/visit") {
        const userAgent = request.headers.get("User-Agent") || "";
        if (!BOT_PATTERN.test(userAgent)) {
          const ip = request.headers.get("CF-Connecting-IP") || "";
          if (ip) {
            const fingerprint = await visitorHash(ip, userAgent, env.COUNTER_SALT);
            await env.DB.prepare(
              "INSERT INTO visitors (fingerprint, last_seen) VALUES (?, ?) ON CONFLICT(fingerprint) DO UPDATE SET last_seen = excluded.last_seen"
            ).bind(fingerprint, now).run();
          }
        }
      }

      const result = await env.DB.prepare(
        "SELECT COUNT(*) AS visitors FROM visitors WHERE last_seen >= ?"
      ).bind(now - WINDOW_MS).first();

      return json({ visitors: Number(result?.visitors || 0), window: "24h" });
    } catch {
      return json({ error: "Counter temporarily unavailable" }, 503);
    }
  },

  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM visitors WHERE last_seen < ?")
      .bind(Date.now() - RETENTION_MS)
      .run();
  }
};
