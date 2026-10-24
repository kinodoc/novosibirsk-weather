import { createSign } from "node:crypto";

const SITE_URL = process.env.SITE_URL || "https://pogodansk.tuqo.ru/";
const lines = ["# SEO: отчёт поисковых систем", `Сайт: ${SITE_URL}`, `Время UTC: ${new Date().toISOString()}`];
const warnings = [];

async function googleSearchConsole() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  const property = process.env.GSC_SITE_URL || SITE_URL;
  if (!raw) {
    lines.push("- ⏭️ Google Search Console: не настроено — добавьте секрет GSC_SERVICE_ACCOUNT_JSON и переменную GSC_SITE_URL.");
    return;
  }

  const account = JSON.parse(raw);
  const now = new Date();
  const end = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 10 * 86400000).toISOString().slice(0, 10);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const jwt = `${header}.${claims}.${signer.sign(account.private_key).toString("base64url")}`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(20000)
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(`Google OAuth HTTP ${tokenResponse.status}: ${tokenData.error_description || tokenData.error || "token request failed"}`);

  const apiUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenData.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      startDate: start,
      endDate: end,
      dimensions: ["query"],
      rowLimit: 10,
      dataState: "final"
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Search Console HTTP ${response.status}: ${data.error?.message || "query failed"}`);
  const rows = data.rows || [];
  lines.push(`## Google Search Console (${start} — ${end})`);
  lines.push(`Строк запросов: ${rows.length}`);
  if (!rows.length) lines.push("Данные по запросам пока не возвращены. Это не доказывает, что URL не проиндексирован.");
  for (const row of rows) {
    lines.push(`- ${row.keys?.[0] || "(без запроса)"} — показы: ${Math.round(row.impressions || 0)}, клики: ${Math.round(row.clicks || 0)}, CTR: ${((row.ctr || 0) * 100).toFixed(1)}%, позиция: ${(row.position || 0).toFixed(1)}`);
  }
}

async function bingWebmaster() {
  const key = process.env.BING_WEBMASTER_API_KEY;
  const site = process.env.BING_SITE_URL || SITE_URL;
  if (!key) {
    lines.push("- ⏭️ Bing Webmaster Tools: не настроено — добавьте секрет BING_WEBMASTER_API_KEY и переменную BING_SITE_URL.");
    return;
  }
  const url = new URL("https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats");
  url.searchParams.set("apikey", key);
  url.searchParams.set("siteUrl", site);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Bing Webmaster API HTTP ${response.status}: ${body.slice(0, 300)}`);
  let data;
  try { data = JSON.parse(body); } catch { data = body; }
  lines.push("## Bing Webmaster Tools");
  lines.push("API статистики ранжирования и трафика ответил успешно. Сырой ответ добавлен ниже.");
  lines.push("```json");
  lines.push(JSON.stringify(data, null, 2).slice(0, 12000));
  lines.push("```");
}

for (const [name, fn] of [["Google Search Console", googleSearchConsole], ["Bing Webmaster Tools", bingWebmaster]]) {
  try { await fn(); }
  catch (error) {
    warnings.push(`${name}: ${error.message}`);
    lines.push(`- ❌ ${name}: ${error.message}`);
    console.error(`${name}: ${error.message}`);
  }
}

if (warnings.length) lines.push("\n## Требует внимания", ...warnings.map(w => `- ${w}`));
if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import("node:fs/promises");
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}
if (warnings.length) process.exitCode = 1;
