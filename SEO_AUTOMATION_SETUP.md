# SEO automation setup

The SEO automation is designed for the live site `https://pogodansk.tuqo.ru/` and runs from the `develop` branch.

## Included automatically

- Daily check of homepage HTTP status, HTML content, title, meta description, canonical, robots directives, `robots.txt` and `sitemap.xml`.
- IndexNow submission after changes to public site files. IndexNow can notify participating search engines, but it does not guarantee crawling, indexing, or ranking.
- Daily Search Console and Bing Webmaster Tools report. The report is written to the GitHub Actions run summary.
- The site remains a static HTML/CSS/JS project; no runtime server or npm dependencies are added.

## One-time setup for search-engine reports

### Google Search Console

1. Verify ownership of `https://pogodansk.tuqo.ru/` in Google Search Console and make sure the URL-prefix property is accessible.
2. In Google Cloud, enable the Google Search Console API and create a service account with a JSON key.
3. Add the service-account email as a user of the verified Search Console property (read-only permission is sufficient).
4. In GitHub repository settings, add repository **Secret** `GSC_SERVICE_ACCOUNT_JSON` containing the entire service-account JSON file.
5. Add repository **Variable** `GSC_SITE_URL` with the exact property URL, normally `https://pogodansk.tuqo.ru/`.

Do not commit the service-account JSON or private key to the repository.

### Bing Webmaster Tools

1. Add and verify `https://pogodansk.tuqo.ru/` in Bing Webmaster Tools.
2. Generate/copy the Bing Webmaster API key from the account.
3. Add repository **Secret** `BING_WEBMASTER_API_KEY`.
4. Add repository **Variable** `BING_SITE_URL` with the exact verified site URL, normally `https://pogodansk.tuqo.ru/`.

### Where to find settings

In GitHub: repository → **Settings** → **Secrets and variables** → **Actions**. Add the credentials as secrets and property URLs as variables. Never paste credentials into issues, commits, or chat.

## How to run and read reports

- Open the repository's **Actions** tab.
- Run **SEO and search monitoring** manually with **Run workflow**, or wait for the daily UTC schedule.
- Open a completed run and read **Summary** for the technical checks and search performance.
- The **IndexNow URL submission** workflow runs on relevant pushes to `develop`. It verifies the public key file before sending the URL.

If the Google/Bing credentials have not been configured yet, those sections will be marked as not configured. After configuration, authentication/API errors are reported in the run summary.

## Notes

- The daily technical check tests the currently published website. If the hosting platform takes longer than the workflow's initial wait to publish, IndexNow verification may fail; rerun the workflow after the site is live.
- Search performance data may be delayed by the search engines. No data in a report is not proof that the page is not indexed.
- Search Console query data is requested for the most recent 7-day window excluding the latest 3 days, to reduce incomplete-data effects.
- IndexNow is not a universal submission API for every search engine. Google Search Console has a separate API and does not provide a general public API to submit an arbitrary URL for indexing.
