/*
 * Submit every URL in the sitemap to IndexNow.
 *
 * IndexNow is a push protocol: instead of waiting for a crawler to notice new
 * pages, the site tells the engines directly. Bing, Yandex, Seznam and Naver
 * honour it and share submissions between them. Google does not participate,
 * so this does nothing for Google rankings - it is worth running anyway,
 * because Bing's index is what several AI answer engines read from, and it
 * picks pages up in days rather than the weeks Google takes.
 *
 * Ownership is proven by a key file served from the site root. The key lives in
 * public/<key>.txt, so it deploys with the site and there is no account, no
 * token and no dashboard involved.
 *
 * Run after a deploy, not before: submitting a URL that 404s teaches the
 * engines to trust the next submission less.
 *
 *   node scripts/indexnow.mjs            # submit everything in the sitemap
 *   node scripts/indexnow.mjs --dry-run  # print what would be sent
 */

const HOST = "www.chatbotskriv.dk";
const KEY = "54ffebb71a5dcda4c1601680c46bdad4";
const ENDPOINT = "https://api.indexnow.org/IndexNow";
/* The spec caps a single submission at 10,000 URLs. */
const BATCH = 10000;

const dryRun = process.argv.includes("--dry-run");

const sitemap = await fetch(`https://${HOST}/sitemap.xml`);
if (!sitemap.ok) {
  console.error(`Could not read sitemap: HTTP ${sitemap.status}`);
  process.exit(1);
}

const xml = await sitemap.text();
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (urlList.length === 0) {
  console.error("Sitemap contained no URLs - refusing to submit nothing.");
  process.exit(1);
}

/*
 * Verify the key file is actually reachable before submitting. IndexNow
 * answers 202 to almost anything and only checks the key afterwards, so a
 * missing key file otherwise fails silently and looks like success.
 */
const keyCheck = await fetch(`https://${HOST}/${KEY}.txt`);
const keyBody = keyCheck.ok ? (await keyCheck.text()).trim() : "";
if (keyBody !== KEY) {
  console.error(
    `Key file at https://${HOST}/${KEY}.txt is missing or wrong ` +
      `(HTTP ${keyCheck.status}). Deploy before submitting.`,
  );
  process.exit(1);
}
console.log(`Key file verified. ${urlList.length} URLs in sitemap.`);

if (dryRun) {
  console.log(urlList.join("\n"));
  process.exit(0);
}

for (let i = 0; i < urlList.length; i += BATCH) {
  const batch = urlList.slice(i, i + BATCH);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, urlList: batch }),
  });
  console.log(`Submitted ${batch.length} URLs -> HTTP ${res.status}`);
  if (res.status !== 200 && res.status !== 202) {
    console.error(await res.text());
    process.exit(1);
  }
}

console.log("Done. Bing typically reflects this within a few days.");
