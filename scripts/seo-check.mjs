const SITE_URL = (process.env.SITE_URL || "https://pogodansk.tuqo.ru/").replace(/\/$/, "") + "/";
const TIMEOUT_MS = 15000;

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "NovosibirskWeather-SEO-Monitor/1.0" }
    });
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const failures = [];
const report = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    report.push(`- ✅ **${label}:** ${detail}`);
    console.log(`PASS: ${label} — ${detail}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    report.push(`- ❌ **${label}:** ${error.message}`);
    console.error(`FAIL: ${label} — ${error.message}`);
  }
}

let pageHtml = "";
await check("Главная страница", async () => {
  const response = await get(SITE_URL);
  assert(response.status === 200, `HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  assert(type.includes("text/html"), `неожиданный Content-Type: ${type || "отсутствует"}`);
  pageHtml = await response.text();
  assert(pageHtml.length > 500, "HTML слишком короткий");
  return `HTTP ${response.status}, ${pageHtml.length} символов HTML`;
});

if (pageHtml) {
  await check("Title", async () => {
    const title = pageHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    assert(title && title.length >= 10, "title отсутствует или слишком короткий");
    return title.replace(/\s+/g, " ");
  });

  await check("Meta description", async () => {
    const description = pageHtml.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1];
    assert(description && description.trim().length >= 50, "description отсутствует или слишком короткий");
    return `${description.trim().length} символов`;
  });

  await check("Canonical", async () => {
    const canonical = pageHtml.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1]
      || pageHtml.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i)?.[1];
    assert(canonical, "canonical не найден");
    assert(new URL(canonical).href === SITE_URL, `canonical указывает на ${canonical}`);
    return canonical;
  });

  await check("Индексация разрешена", async () => {
    const robotsMeta = [...pageHtml.matchAll(/<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/gi)]
      .map(match => match[1].toLowerCase()).join(",");
    assert(!robotsMeta.includes("noindex"), `найден robots noindex: ${robotsMeta}`);
    return robotsMeta || "robots meta отсутствует (по умолчанию индексация разрешена)";
  });
}

await check("robots.txt", async () => {
  const url = new URL("/robots.txt", SITE_URL);
  const response = await get(url);
  assert(response.status === 200, `HTTP ${response.status}`);
  const body = await response.text();
  assert(/User-agent:\s*\*/i.test(body), "не найдено правило User-agent: *");
  assert(/Sitemap:\s*https?:\/\//i.test(body), "не указана ссылка Sitemap");
  return "HTTP 200, sitemap указан";
});

await check("sitemap.xml", async () => {
  const response = await get(new URL("/sitemap.xml", SITE_URL));
  assert(response.status === 200, `HTTP ${response.status}`);
  const body = await response.text();
  assert(/<urlset[\s>]/i.test(body), "не найден элемент urlset");
  assert(body.includes(SITE_URL), `в sitemap нет URL ${SITE_URL}`);
  return "HTTP 200, главная страница присутствует";
});

const summary = [
  "# SEO: автоматическая техническая проверка",
  `Сайт: ${SITE_URL}`,
  `Время UTC: ${new Date().toISOString()}`,
  ...report,
  failures.length ? `\n**Ошибок: ${failures.length}.**` : "\n**Все проверки пройдены.**"
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import("node:fs/promises");
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

if (failures.length) process.exitCode = 1;
