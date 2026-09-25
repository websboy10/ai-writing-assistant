// Builds the static site into dist/: the hand-written pages as they are, one
// page per article in content/artikler.json, the /guider hub, and the files
// search and AI engines read (sitemap.xml, robots.txt, llms.txt).
//
//   node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SITE = "https://www.chatbotskriv.dk";
const STORE = "https://chromewebstore.google.com/detail/mpiaefmokkanbodjlephkpdfaidjkndc";
const STATIC_PAGES = ["index.html", "privatliv.html", "handelsbetingelser.html"];

const articles = JSON.parse(readFileSync(path.join(ROOT, "content/artikler.json"), "utf8"));
const config = JSON.parse(readFileSync(path.join(ROOT, "data/motor/config.json"), "utf8"));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paras = (text) => text.split(/\n\n+/).map((p) => `<p>${esc(p)}</p>`).join("\n    ");
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
const dateDa = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" });

function page({ title, description, urlPath, head = "", body }) {
  return `<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${urlPath}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="ChatBot Skriv">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${SITE}${urlPath}">
  <meta property="og:image" content="${SITE}/icon-128.png">
  <link rel="icon" type="image/png" href="/icon-128.png">
  <link rel="stylesheet" href="/styles.css">
  ${head}
</head>
<body>

<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/">
      <img src="/icon-128.png" alt="ChatBot Skriv logo">
      <span>ChatBot Skriv</span>
    </a>
    <nav class="site-nav" aria-label="Hovedmenu">
      <a href="/#funktioner">Funktioner</a>
      <a href="/#pris">Pris</a>
      <a href="/guider">Guider</a>
      <a class="nav-cta" href="${STORE}" rel="noopener">Hent udvidelsen</a>
    </nav>
  </div>
</header>

<main class="legal">
  <div class="wrap">
    ${body}
  </div>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="footer-brand">
      <img src="/icon-128.png" alt="">
      <span>ChatBot Skriv</span>
    </div>
    <nav class="footer-links" aria-label="Sidefod">
      <a href="/guider">Guider</a>
      <a href="/privatliv">Privatlivspolitik</a>
      <a href="/handelsbetingelser">Handelsbetingelser</a>
      <a href="mailto:sehit@degirmenci.dk">Kontakt</a>
    </nav>
    <p class="footer-meta">© 2026 ChatBot Skriv · Danmark · sehit@degirmenci.dk</p>
  </div>
</footer>

</body>
</html>
`;
}

// Same topic first, then the newest, so every guide links onward.
function related(a) {
  const others = articles.filter((o) => o.slug !== a.slug);
  const same = others.filter((o) => o.topic === a.topic);
  const rest = others.filter((o) => o.topic !== a.topic).reverse();
  return [...same, ...rest].slice(0, 4);
}

function articlePage(a) {
  const url = `${SITE}/${a.slug}`;
  const table = a.table
    ? `<div class="table-scroll"><table>
      ${a.table.caption ? `<caption>${esc(a.table.caption)}</caption>` : ""}
      <thead><tr>${a.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${a.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`
    : "";
  const examples = a.examples
    ? `<h2>${esc(a.examples.heading)}</h2>\n    <ul>${a.examples.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
    : "";
  const more = related(a);
  const head = [
    jsonLd({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: a.h1,
      description: a.metaDescription,
      datePublished: a.datePublished,
      dateModified: a.dateModified || a.datePublished,
      inLanguage: "da-DK",
      mainEntityOfPage: url,
      author: { "@type": "Organization", name: "ChatBot Skriv", url: SITE },
      publisher: { "@type": "Organization", name: "ChatBot Skriv", url: SITE, logo: `${SITE}/icon-128.png` },
    }),
    jsonLd({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ q: a.h1, a: a.answer }, ...a.faq].map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    }),
    jsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "ChatBot Skriv", item: SITE },
        { "@type": "ListItem", position: 2, name: "Guider", item: `${SITE}/guider` },
        { "@type": "ListItem", position: 3, name: a.h1, item: url },
      ],
    }),
  ].join("\n  ");

  const body = `<span class="eyebrow"><a href="/guider">Guider</a></span>
    <h1>${esc(a.h1)}</h1>
    <p class="updated">Udgivet ${dateDa(a.datePublished)}${a.dateModified ? ` · opdateret ${dateDa(a.dateModified)}` : ""}</p>

    <div class="answer-box"><p>${esc(a.answer)}</p></div>

    ${paras(a.intro)}

    ${examples}

    ${a.sections.map((s) => `<h2>${esc(s.heading)}</h2>\n    ${paras(s.body)}`).join("\n\n    ")}

    ${table}

    <h2>Hvem passer det til?</h2>
    <ul>${a.bestFor.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>

    <h2>Ofte stillede spørgsmål</h2>
    ${a.faq.map((f) => `<h3>${esc(f.q)}</h3>\n    <p>${esc(f.a)}</p>`).join("\n    ")}

    <div class="guide-cta">
      <a class="btn btn-store" href="${STORE}" rel="noopener">Prøv ChatBot Skriv gratis i 7 dage</a>
    </div>

    ${more.length ? `<h2>Læs også</h2>\n    <ul class="guide-list">${more.map((o) => `<li><a href="/${o.slug}">${esc(o.h1)}</a></li>`).join("")}</ul>` : ""}`;

  return page({ title: a.metaTitle, description: a.metaDescription, urlPath: `/${a.slug}`, head, body });
}

function hubPage() {
  const newest = [...articles].reverse();
  const body = `<span class="eyebrow">Guider</span>
    <h1>Guider til at skrive med AI</h1>
    <p>Korte, ærlige svar på det, folk spørger om, når de skriver mails, ansøgninger og tekster med AI. ${esc(config.entitySentence)}</p>
    <ul class="guide-list">${newest.map((a) => `<li><a href="/${a.slug}">${esc(a.h1)}</a></li>`).join("")}</ul>`;
  return page({
    title: "Guider til at skrive med AI | ChatBot Skriv",
    description: "Guider til at skrive mails, ansøgninger og tekster på dansk med AI, og til at få AI til at skrive direkte i Google Docs.",
    urlPath: "/guider",
    body,
  });
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ["/", today],
    ["/guider", articles.at(-1)?.datePublished || today],
    ...articles.map((a) => [`/${a.slug}`, a.dateModified || a.datePublished]),
    ["/privatliv", null],
    ["/handelsbetingelser", null],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${SITE}${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
}

const robots = `User-agent: *
Allow: /

# AI search and answer engines are welcome to read and cite this site.
User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: PerplexityBot
User-agent: Google-Extended
User-agent: Applebot-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

function llms() {
  return `# ChatBot Skriv

> ${config.entitySentence} Man chatter med assistenten i et panel i kanten af siden, vedhæfter filer (også scannede PDF'er med dansk OCR), vælger længde, og teksten skrives ind i den editor, man arbejder i, med det samme eller i menneskeligt tempo.

- Pris: 7 dage gratis uden kort, derefter 100 kr. om måneden uden binding, eller et 30-dages månedspas betalt med MobilePay.
- Data: konto og historik i EU (Stockholm), vedhæftede filer gemmes ikke, personligt indhold sendes kun til betalte AI-modeller med træning slået fra.
- Hent: ${STORE}

## Sider

- [Forside](${SITE}/): funktioner, pris og ofte stillede spørgsmål
- [Guider](${SITE}/guider): alle guider til at skrive med AI
- [Privatlivspolitik](${SITE}/privatliv)
- [Handelsbetingelser](${SITE}/handelsbetingelser)

## Guider

${articles.map((a) => `- [${a.h1}](${SITE}/${a.slug}): ${a.metaDescription}`).join("\n")}
`;
}

// The home page's structured data: the product, and its FAQ read from the
// page itself so the two can never disagree.
function withHomeData(html) {
  const text = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const faq = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p class="answer">([\s\S]*?)<\/p>/g)];
  if (!faq.length) throw new Error("index.html: FAQ markup changed, update withHomeData");
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "ChatBot Skriv",
      description: config.entitySentence,
      url: `${SITE}/`,
      downloadUrl: STORE,
      image: `${SITE}/icon-128.png`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Chrome",
      inLanguage: "da-DK",
      offers: { "@type": "Offer", price: "100", priceCurrency: "DKK", description: "7 dage gratis, derefter 100 kr. om måneden uden binding" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "ChatBot Skriv",
      url: `${SITE}/`,
      logo: `${SITE}/icon-128.png`,
      email: "sehit@degirmenci.dk",
      areaServed: "DK",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(([, q, a]) => ({ "@type": "Question", name: text(q), acceptedAnswer: { "@type": "Answer", text: text(a) } })),
    },
  ];
  return html.replace("</head>", `  ${data.map(jsonLd).join("\n  ")}\n</head>`);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
for (const f of readdirSync(ROOT)) {
  if (STATIC_PAGES.includes(f) || /\.(css|png|txt)$/.test(f)) copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}
writeFileSync(path.join(DIST, "index.html"), withHomeData(readFileSync(path.join(ROOT, "index.html"), "utf8")));
for (const a of articles) writeFileSync(path.join(DIST, `${a.slug}.html`), articlePage(a));
writeFileSync(path.join(DIST, "guider.html"), hubPage());
writeFileSync(path.join(DIST, "sitemap.xml"), sitemap());
writeFileSync(path.join(DIST, "robots.txt"), robots);
writeFileSync(path.join(DIST, "llms.txt"), llms());
// Cookieless visit counting (apps/backend/src/routes/site.ts). Only on the real
// domain, so previews and local builds never count as visitors.
const TRACKER = `<script>
(function () {
  if (!/(^|\\.)chatbotskriv\\.dk$/.test(location.hostname)) return;
  function send(e) {
    try {
      var q = new URLSearchParams(location.search);
      navigator.sendBeacon("https://ai-skriveassistent-api.vercel.app/api/site-event", JSON.stringify({
        e: e, p: location.pathname, r: document.referrer,
        us: q.get("utm_source"), um: q.get("utm_medium"), uc: q.get("utm_campaign")
      }));
    } catch (x) {}
  }
  send("pageview");
  document.addEventListener("click", function (ev) {
    if (ev.target.closest && ev.target.closest('a[href*="chromewebstore.google.com"]')) send("store_click");
  });
})();
</script>
</body>`;
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".html"))) {
  const p = path.join(DIST, f);
  writeFileSync(p, readFileSync(p, "utf8").replace("</body>", TRACKER));
}
console.log(`Built ${articles.length} guides into dist/`);
