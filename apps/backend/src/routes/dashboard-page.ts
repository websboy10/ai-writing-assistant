/**
 * The dashboard, as one self-contained page.
 *
 * NO FRAMEWORK AND NO CHART LIBRARY, and not for purity: index.ts sends
 * `default-src 'none'` on every HTML response, so a script or stylesheet from a
 * CDN would simply not load, and loosening that for a page showing live revenue
 * is the wrong trade. The charts below are hand-drawn SVG — a few dozen lines
 * for bars, a sparkline and a donut, which is less code than the loader for a
 * charting library would have been.
 *
 * It lives in its own file because a 400-line template literal inside the route
 * file made the routes impossible to read.
 */
export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChatBot Skriv — dashboard</title>
<style>
:root{
  --ink:#15161a; --soft:#6d7078; --faint:#9a9da4;
  --paper:#f7f7f5; --card:#fff; --line:#e6e6e1;
  --good:#1f7a4c; --warn:#9a6b12; --bad:#a33224; --accent:#2f6bd8;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:28px 20px 96px}

/* header */
.top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
h1{font:600 1.45rem/1.2 Charter,Georgia,serif;margin:0}
.stamp{color:var(--faint);font-size:.8rem}
.btn{font:inherit;font-size:.85rem;padding:6px 14px;border-radius:999px;border:1px solid var(--line);
  background:var(--card);color:var(--ink);cursor:pointer}
.btn:hover{border-color:var(--ink)}
.btn.on{background:var(--bad);border-color:var(--bad);color:#fff}

/* health strip */
.health{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 4px}
.pill{display:inline-flex;align-items:center;gap:7px;font-size:.82rem;padding:5px 12px;border-radius:999px;
  background:var(--card);border:1px solid var(--line)}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
.dot.ok{background:var(--good)} .dot.warn{background:var(--warn)} .dot.bad{background:var(--bad)}
.dot.idle{background:var(--faint)}

h2{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);
  margin:34px 0 12px;font-weight:600}

/* cards */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.card .k{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.card .v{font:600 1.7rem/1.15 Charter,Georgia,serif;font-variant-numeric:tabular-nums;margin-top:5px}
.card .n{font-size:.78rem;color:var(--soft);margin-top:3px}
.card.wide{grid-column:1/-1}

/* charts */
.chart{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.chart h3{margin:0 0 2px;font-size:.9rem;font-weight:600}
.chart p.cap{margin:0 0 12px;font-size:.78rem;color:var(--soft)}
svg{display:block;width:100%;overflow:visible}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}

/* funnel + share bars */
.rows{display:flex;flex-direction:column;gap:9px}
.row{display:grid;grid-template-columns:150px 1fr auto;gap:10px;align-items:center;font-size:.85rem}
.row .lab{color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track{height:9px;background:var(--paper);border-radius:999px;overflow:hidden}
.fill{height:100%;background:var(--ink);border-radius:999px}
.fill.accent{background:var(--accent)}
.row .num{font-variant-numeric:tabular-nums;color:var(--ink);min-width:56px;text-align:right}

table{width:100%;border-collapse:collapse;font-size:.86rem;background:var(--card);
  border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid var(--line)}
th{font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:600}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}

.err{color:var(--bad);font-size:.84rem;margin:8px 0 0}
.muted{color:var(--soft);font-size:.84rem;margin:8px 0 0}
form{max-width:330px;margin:14vh auto;display:flex;flex-direction:column;gap:10px}
input{font:inherit;padding:11px 13px;border-radius:11px;border:1px solid var(--line);background:var(--card)}
form .btn{padding:11px;background:var(--ink);color:#fff;border-color:var(--ink)}
#app{display:none}
@media (max-width:520px){ .row{grid-template-columns:110px 1fr auto} }
</style></head><body><div class="wrap">

<form id="login">
  <h1>Dashboard</h1>
  <p class="stamp">Log ind med din administratorkonto.</p>
  <input id="email" type="email" placeholder="E-mail" autocomplete="username">
  <input id="password" type="password" placeholder="Adgangskode" autocomplete="current-password">
  <button class="btn" type="submit">Log ind</button>
  <p class="err" id="loginErr"></p>
</form>

<div id="app">
  <div class="top">
    <h1>ChatBot Skriv</h1>
    <div><span class="stamp" id="stamp"></span>
      <button class="btn" id="paywallToggle" title="Skifter kun det nye brugere får ved oprettelse">…</button>
      <button class="btn" id="refresh">Opdatér</button></div>
  </div>
  <div class="health" id="health"></div>
  <p class="muted" id="scope">Alle tal er uden operatørens egne konti og testkontoen.</p>

  <h2>Penge</h2>
  <div class="grid" id="money"></div>
  <p class="err" id="moneyErr"></p>

  <h2>Hvad det koster</h2>
  <div class="grid" id="cost"></div>
  <p class="err" id="costErr"></p>

  <h2>Brugere</h2>
  <div class="grid" id="product"></div>
  <p class="err" id="productErr"></p>

  <h2>Aktivitet</h2>
  <div class="two">
    <div class="chart"><h3>Svar pr. dag</h3><p class="cap" id="reqCap"></p><div id="reqChart"></div></div>
    <div class="chart"><h3>Omsætning pr. dag</h3><p class="cap" id="revCap"></p><div id="revChart"></div></div>
  </div>

  <h2>Vejen til en betaling</h2>
  <div class="chart"><p class="cap">Antal personer, seneste 90 dage. Hvert trin er en delmængde af det forrige.</p>
    <div class="rows" id="funnel"></div></div>
  <p class="err" id="usageErr"></p>

  <h2>Modeller og længder</h2>
  <div class="two">
    <div class="chart"><h3>Hvilken model svarede</h3><p class="cap">Seneste 30 dage</p><div class="rows" id="models"></div></div>
    <div class="chart"><h3>Valgt længde</h3><p class="cap">Seneste 30 dage</p><div class="rows" id="lengths"></div></div>
  </div>

  <h2>Fejl</h2>
  <div id="failures"></div>

  <h2>Seneste betalinger</h2>
  <div id="recent"></div>
</div>
</div>

<script>
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('awa_admin');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf = (n) => (n === null || n === undefined || Number.isNaN(n)) ? '–' : Number(n).toLocaleString('da-DK');
const kr = (n) => nf(Math.round(n)) + ' kr.';
const card = (k, v, n) => '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + v +
  '</div>' + (n ? '<div class="n">' + n + '</div>' : '') + '</div>';
const pill = (state, text, title) => '<span class="pill"' + (title ? ' title="' + esc(title) + '"' : '') +
  '><span class="dot ' + state + '"></span>' + esc(text) + '</span>';

function table(cols, rows, empty) {
  if (!rows.length) return '<p class="muted">' + esc(empty) + '</p>';
  return '<table><tr>' + cols.map((c,i) => '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>').join('') +
    '</tr>' + rows.map((r) => '<tr>' + r.map((c,i) => '<td' + (i ? ' class="num"' : '') + '>' + esc(c) +
    '</td>').join('') + '</tr>').join('') + '</table>';
}

/**
 * A bar chart in plain SVG. Bars carry a <title>, which is a native browser
 * tooltip — no hover JS, and it works on a touch screen's long-press too.
 */
function bars(series, fmt) {
  if (!series.length) return '<p class="muted">Ingen data endnu.</p>';
  const W = 100, H = 34, gap = 0.6;
  const max = Math.max(1, ...series.map((s) => s[1]));
  const bw = (W - gap * (series.length - 1)) / series.length;
  const body = series.map((s, i) => {
    const h = (s[1] / max) * H;
    const x = i * (bw + gap);
    return '<rect x="' + x.toFixed(2) + '" y="' + (H - h).toFixed(2) + '" width="' + bw.toFixed(2) +
      '" height="' + Math.max(h, 0.4).toFixed(2) + '" rx="0.4" fill="#15161a">' +
      '<title>' + esc(s[0]) + ': ' + fmt(s[1]) + '</title></rect>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" height="132">' + body + '</svg>';
}

function shareRows(items, accent) {
  if (!items.length) return '<p class="muted">Ingen data endnu.</p>';
  const max = Math.max(1, ...items.map((i) => i[1]));
  return items.map(([label, n, note]) =>
    '<div class="row"><div class="lab" title="' + esc(label) + '">' + esc(label) + '</div>' +
    '<div class="track"><div class="fill' + (accent ? ' accent' : '') + '" style="width:' +
    Math.max(2, (n / max) * 100).toFixed(1) + '%"></div></div>' +
    '<div class="num">' + nf(n) + (note ? ' <span class="lab">' + esc(note) + '</span>' : '') + '</div></div>'
  ).join('');
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: $('email').value, password: $('password').value }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.access_token) { $('loginErr').textContent = b.error_description || b.error || b.msg || 'Login mislykkedes.'; return; }
  token = b.access_token;
  sessionStorage.setItem('awa_admin', token);
  load();
  loadPaywallConfig();
});

$('refresh').addEventListener('click', () => load());

function renderPaywallBtn(hardPaywall) {
  const b = $('paywallToggle');
  b.textContent = hardPaywall ? 'Hård betalingsmur: TIL' : 'Hård betalingsmur: FRA (prøveperiode)';
  b.classList.toggle('on', hardPaywall);
}

async function loadPaywallConfig() {
  try {
    const r = await fetch('/api/admin/config', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const b = await r.json();
    renderPaywallBtn(b.hardPaywall);
  } catch (e) { /* leaves the button on its placeholder label */ }
}

$('paywallToggle').addEventListener('click', async () => {
  const turningOn = !$('paywallToggle').classList.contains('on');
  const msg = turningOn
    ? 'Slå hård betalingsmur TIL?\n\nNye brugere får ingen prøveperiode. Alle der er i gang med en prøveperiode nu bliver spærret med det samme.'
    : 'Slå hård betalingsmur FRA?\n\nNye brugere får 7 dages gratis prøveperiode igen. Allerede spærrede konti forbliver spærrede.';
  if (!confirm(msg)) return;
  const btn = $('paywallToggle');
  btn.disabled = true;
  try {
    const r = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: turningOn }),
    });
    const b = await r.json();
    if (!r.ok) { alert(b.error || 'Kunne ikke skifte.'); return; }
    renderPaywallBtn(b.hardPaywall);
  } finally {
    btn.disabled = false;
  }
});

async function load() {
  $('login').style.display = 'none';
  $('app').style.display = 'block';
  $('stamp').textContent = 'Henter…';

  let d;
  try {
    const r = await fetch('/api/admin/overview', { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401 || r.status === 404) {
      sessionStorage.removeItem('awa_admin');
      $('app').style.display = 'none'; $('login').style.display = 'flex';
      $('loginErr').textContent = 'Kontoen har ikke adgang til dashboardet.';
      return;
    }
    d = await r.json();
  } catch (e) {
    $('stamp').textContent = 'Kunne ikke hente data.';
    return;
  }
  $('stamp').textContent = 'Hentet ' + new Date(d.generatedAt).toLocaleString('da-DK');

  const m = d.money, c = d.cost, p = d.product, u = d.usage, x = d.excluded;

  // ---- health strip: the three things worth being told without asking ----
  const health = [];
  // Said first, because every other number below depends on it being true.
  if (x && !x.error) {
    health.push(pill('idle', 'Uden ' + nf(x.emails.length) + ' interne konti',
                     'Ekskluderet fra alle tal: ' + x.emails.join(', ')));
  } else if (x && x.error) {
    health.push(pill('bad', 'Interne konti tælles muligvis med'));
  }
  if (c && !c.error) {
    const days = c.runway_days;
    health.push(days === null
      ? pill('idle', 'AI-kredit: ' + nf(c.left_credits) + ' tilbage')
      : pill(days < 14 ? 'bad' : days < 45 ? 'warn' : 'ok',
             'AI-kredit rækker ca. ' + nf(days) + ' dage'));
  }
  if (u && !u.error) {
    const done = (u.byEvent.find((e) => e[0] === 'chat_completed') || [,0])[1];
    const fail = (u.byEvent.find((e) => e[0] === 'chat_failed') || [,0])[1];
    const rate = done + fail ? (100 * fail / (done + fail)) : 0;
    health.push(pill(rate > 10 ? 'bad' : rate > 3 ? 'warn' : 'ok', 'Fejlrate ' + rate.toFixed(1) + '%'));
    const p95 = u.speed[1];
    health.push(pill(p95 > 30000 ? 'warn' : 'ok', 'Svartid p95 ' + (p95 ? (p95/1000).toFixed(1) : '–') + ' s'));
  }
  if (m && !m.error && m.truncated) health.push(pill('warn', 'Over 100 rækker hos Stripe — tal er undervurderede'));
  $('health').innerHTML = health.join('');

  // ---- money ----
  if (m.error) { $('moneyErr').textContent = m.error; $('money').innerHTML = ''; }
  else {
    const s = m.subscriptions || {};
    const conv = m.checkout.started_90d ? Math.round(100 * m.checkout.completed_90d / m.checkout.started_90d) : null;
    $('money').innerHTML =
      card('MRR', kr(m.mrr_dkk), 'løbende abonnementer') +
      card('Omsætning 30 dage', kr(m.revenue_dkk.d30), '7 dage: ' + kr(m.revenue_dkk.d7)) +
      card('Aktive abonnenter', nf(s.active || 0), nf(s.past_due || 0) + ' forfaldne · ' + nf(s.canceled || 0) + ' opsagte') +
      card('Månedspas', nf(m.passes.d30), nf(m.passes.d90) + ' på 90 dage · ' + kr(m.passes.revenue_d90_dkk)) +
      card('Checkout fuldført', conv === null ? '–' : conv + '%', m.checkout.completed_90d + ' af ' + m.checkout.started_90d + ' påbegyndte') +
      card('Nye kunder', nf(m.customers_90d), 'seneste 90 dage') +
      card('Mislykkede betalinger', nf(m.payments.failed_90d), 'seneste 90 dage');
    $('revChart').innerHTML = bars(m.daily_revenue, (v) => v + ' kr.');
    $('revCap').textContent = m.daily_revenue.length
      ? m.daily_revenue[0][0] + ' til ' + m.daily_revenue[m.daily_revenue.length-1][0] + ' · peg på en søjle'
      : 'Ingen betalinger endnu.';
    $('recent').innerHTML = table(['Tidspunkt','Beløb'],
      m.recent.map((x) => [new Date(x.at).toLocaleString('da-DK'), kr(x.dkk) + (x.refunded ? ' (refunderet)' : '')]),
      'Ingen betalinger endnu.');
  }

  // ---- cost ----
  if (c.error) { $('costErr').textContent = c.error; $('cost').innerHTML = ''; }
  else {
    const pct = c.total_credits ? Math.round(100 * c.left_credits / c.total_credits) : 0;
    $('cost').innerHTML =
      card('AI-kredit tilbage', nf(c.left_credits), pct + '% af ' + nf(c.total_credits) + ' købt') +
      card('Rækker ca.', c.runway_days === null ? '–' : nf(c.runway_days) + ' dage', 'ved forbruget de sidste 30 dage') +
      card('Forbrug 30 dage', c.spend_30d === null ? '–' : nf(c.spend_30d), 'kredit') +
      card('Pris pr. svar', c.cost_per_answer === null ? '–' : c.cost_per_answer.toFixed(4), 'kredit i gennemsnit') +
      card('Svar 30 dage', nf(c.answers_30d), 'talt hos PostHog');
  }

  // ---- product ----
  if (p.error) { $('productErr').textContent = p.error; $('product').innerHTML = ''; }
  else {
    const paying = (p.subscribed || 0) + (p.pass_active || 0);
    const conv = p.accounts ? Math.round(100 * paying / p.accounts) : 0;
    $('product').innerHTML =
      card('Konti', nf(p.accounts), '+' + nf(p.accounts_7d) + ' på 7 dage') +
      card('Betaler', nf(paying), nf(p.subscribed) + ' abonnement · ' + nf(p.pass_active) + ' pas') +
      card('Konto til betaling', conv + '%', 'af alle oprettede konti') +
      card('I prøveperiode', nf(p.trialing), nf(p.trial_expired) + ' udløbet uden køb') +
      card('Svar i dag', nf(p.requests_today), nf(p.requests_30d) + ' på 30 dage') +
      card('Samtaler', nf(p.conversations), nf(p.messages) + ' beskeder');
    $('reqChart').innerHTML = bars(p.daily_requests || [], (v) => v + ' svar');
    $('reqCap').textContent = (p.daily_requests || []).length
      ? 'Fra kvotetælleren, som ikke kan miste en linje · peg på en søjle'
      : 'Ingen svar endnu.';
  }

  // ---- behaviour ----
  if (u.error) { $('usageErr').textContent = u.error; }
  else {
    const f = Object.fromEntries(u.funnel.map((r) => [r[0], r[1]]));
    $('funnel').innerHTML = shareRows([
      ['Oprettet konto', f.signed_up || 0],
      ['Fik skrevet noget', f.chat_completed || 0],
      ['Ramte betalingsmuren', f.paywall_hit || 0],
      ['Åbnede checkout', f.checkout_started || 0],
      ['Betalte', (f.pass_granted || 0) + (f.subscription_state || 0)],
    ], true);
    $('models').innerHTML = shareRows(u.models.map((r) => [r[0] || 'ukendt', r[1], Math.round(r[2]/1000) + 's']));
    $('lengths').innerHTML = shareRows(u.lengths.map((r) => [
      ({short:'Kort',medium:'Middel',long:'Lang'})[r[0]] || r[0] || 'ukendt', r[1]]));
    $('failures').innerHTML = table(['Fejlkode','Antal 30 dage'], u.failures.map((r) => [r[0] || 'ukendt', nf(r[1])]),
      'Ingen fejl de seneste 30 dage.');
  }
}

if (token) { load(); loadPaywallConfig(); }
</script></body></html>`;
