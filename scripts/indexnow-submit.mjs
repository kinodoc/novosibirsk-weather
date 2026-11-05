const SITE_URL = (process.env.SITE_URL || "https://pogodansk.tuqo.ru/").replace(/\/$/, "") + "/";
const KEY = process.env.INDEXNOW_KEY || "9b2c6f4d8e1a7c305f6b9d2e4a8c1f73";
const keyLocation = new URL(`/${KEY}.txt`, SITE_URL).href;
const payload = {
  host: new URL(SITE_URL).host,
  key: KEY,
  keyLocation,
  urlList: [SITE_URL]
};

let lastError;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.text();
    if (response.ok || response.status === 202) {
      console.log(`IndexNow accepted submission (HTTP ${response.status}) for ${SITE_URL}`);
      process.exit(0);
    }
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  } catch (error) {
    lastError = error;
    console.error(`IndexNow attempt ${attempt}/4 failed: ${error.message}`);
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
  }
}
console.error(`IndexNow submission failed: ${lastError?.message || "unknown error"}`);
process.exit(1);
