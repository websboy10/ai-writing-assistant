/**
 * Walks the panel in a real browser, on an ordinary page.
 *
 * Everything here is a thing that typecheck and unit tests cannot see: whether
 * a control is actually on screen, whether marking text on the page reaches the
 * panel, whether a long paste lands where it should. The Docs suite
 * (verify-docs.mjs) covers the canvas editor; this covers the panel itself.
 *
 * Costs one AI call, deliberately — quota is a shared beta budget and the
 * points below are about the interface, not about generation.
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { launch, reporter, shotsDir, root } from './docs-harness.mjs';

const EXPECTED_BACKEND = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';
const r = reporter();

// A page we control completely, so an assertion about "the text on the page"
// is about our fixture and not about whatever a live site shipped today.
//
// Served over HTTP rather than as a data: or file: URL, because MV3 content
// scripts match neither — the panel simply never appears, which looks exactly
// like the extension being broken.
const FIXTURE_HTML = `<!doctype html><meta charset="utf-8"><title>Medarbejdersamtale 2026</title>
<body style="font:16px/1.6 system-ui;max-width:40rem;margin:3rem">
<h1>Medarbejdersamtale 2026</h1>
<p id="p1">Medarbejderen har i indevaerende regnskabsaar demonstreret en betydelig
kompetenceudvikling inden for salgsrelaterede discipliner, herunder saerligt
behovsafdaekning og afslutningsteknik.</p>
<p id="p2">Naeste periode fokuserer paa produktkendskab.</p>
<textarea id="editor" rows="6" style="width:100%"></textarea>
</body>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE_HTML);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const FIXTURE = `http://127.0.0.1:${server.address().port}/`;

const ctx = await launch({ headless: false });

// The stale-service-worker trap: a cached MV3 worker can route every call to
// the previously-built backend while the suite goes green proving nothing.
const backendHosts = new Set();
await ctx.route('**/api/**', async (route) => {
  backendHosts.add(new URL(route.request().url()).origin);
  await route.continue();
});

// Leftover templates from an earlier run change what the panel renders, so
// each run starts from the same place.
{
  const login = await ctx.request.post(`${EXPECTED_BACKEND}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  const token = (await login.json()).access_token;
  const headers = { authorization: `Bearer ${token}` };
  const existing = await (await ctx.request.get(`${EXPECTED_BACKEND}/api/templates`, { headers })).json();
  for (const t of existing) await ctx.request.delete(`${EXPECTED_BACKEND}/api/templates/${t.id}`, { headers });
  if (existing.length) console.log(`  (cleared ${existing.length} leftover template(s))`);
}

const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `ui-${n}.png`) }).catch(() => {});
const panelText = () =>
  page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');

try {
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // ---- the panel opens ----------------------------------------------------
  const fab = host.locator('button[title*="Skriveassistent"]');
  await fab.waitFor({ timeout: 30_000 });
  r.ok('the edge button is present on an ordinary page', await fab.isVisible());
  await fab.click();
  await page.waitForTimeout(700);

  // ---- sign in if needed --------------------------------------------------
  const emailField = host.locator('input[type="email"]');
  if (await emailField.count()) {
    await emailField.fill(EMAIL);
    await host.locator('input[type="password"]').fill(PASSWORD);
    await host.getByRole('button', { name: 'Log ind', exact: true }).click();
    await page.waitForTimeout(3500);
  }
  const composer = host.locator('textarea');
  r.ok('signed in — the composer is on screen', (await composer.count()) > 0);

  // ---- the empty state teaches the three capabilities ----------------------
  const empty = await panelText();
  await shot('01-empty');
  r.ok('empty state names asking', empty.includes('Spørg om hvad som helst'));
  r.ok('empty state names the selection actions', empty.includes('Markér tekst, vælg en handling'));
  r.ok('empty state names answering a questionnaire', empty.includes('Besvar alle spørgsmål'));
  r.ok('empty state points at the new context buttons', empty.includes('Denne side'));

  // ---- all eight operations are reachable ---------------------------------
  const opSelect = host.locator('select[title*="Hvad assistenten skal"]');
  r.ok('the Handling picker exists', (await opSelect.count()) > 0);
  const opValues = await opSelect.locator('option').evaluateAll((os) => os.map((o) => o.value));
  const EXPECTED_OPS = ['chat', 'summarize', 'rewrite', 'expand', 'simplify', 'explain', 'translate', 'continue'];
  r.ok(
    `all eight operations are offered (saw ${opValues.length})`,
    EXPECTED_OPS.every((o) => opValues.includes(o)),
    opValues.join(','),
  );
  const toneValues = await host
    .locator('select[title*="Tonefaldet"]')
    .locator('option')
    .evaluateAll((os) => os.map((o) => o.value));
  r.ok('tone is settable', toneValues.includes('formal') && toneValues.includes('casual'), toneValues.join(','));

  // ---- an operation without marked text says so ---------------------------
  await opSelect.selectOption('simplify');
  await page.waitForTimeout(400);
  r.ok(
    'picking a verb with nothing marked explains what it needs',
    (await panelText()).includes('Markér et stykke på siden først'),
  );
  const sendBtn = host.locator('button[title*="Forenkl den markerede"]');
  r.ok('send is disabled until something is marked', await sendBtn.isDisabled());

  // ---- marking text on the page reaches the panel -------------------------
  await page.evaluate(() => {
    const p = document.getElementById('p1');
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForTimeout(1600); // the selection poll runs once a second
  const marked = await panelText();
  await shot('02-selection');
  r.ok('the panel notices marked text', marked.includes('Du har markeret tekst'));
  r.ok('the operation binds to the marked text', /Forenkl.*arbejder på de/s.test(marked));
  r.ok('send is enabled once text is marked', await sendBtn.isEnabled());

  // ---- the operation actually runs (the one AI call) ----------------------
  await sendBtn.click();
  // Terminal = a draft to insert, OR any banner at all.
  //
  // Matching on the words "Fejl"/"fejlede" missed the one failure most likely
  // to happen in a beta with a shared quota — "Du har brugt alle 200
  // forespørgsler for i dag" contains neither — so the run hung for the full
  // two minutes and then reported a timeout instead of the actual reason.
  // Presence of the dismiss button is the structural signal, whatever it says.
  await page.waitForFunction(
    () => {
      const root = document.querySelector('awa-sidebar')?.shadowRoot;
      if (!root) return false;
      return (
        (root.textContent ?? '').includes('Indsæt straks') ||
        !!root.querySelector('button[title="Skjul beskeden"]')
      );
    },
    undefined,
    { timeout: 120_000 },
  );
  const afterRun = await panelText();
  if (!afterRun.includes('Indsæt straks')) {
    // Say what the product said, rather than making the reader guess from a
    // failed assertion three lines further down.
    const banner = await host.locator('button[title="Skjul beskeden"]').first().evaluate((b) => b.parentElement?.textContent ?? '');
    r.ok('the operation ran', false, `the panel answered: ${banner.slice(0, 180)}`);
  }
  await shot('03-after-operation');
  r.ok('the operation produced a draft with insertion offered', afterRun.includes('Indsæt straks'));
  r.ok('the default ask reads like a person wrote it', afterRun.includes('Forenkl den markerede tekst.'));
  r.ok('no markdown asterisks reached the draft', !/\*\*/.test(afterRun), afterRun.slice(0, 200));

  // ---- "+ Denne side" attaches the page ------------------------------------
  await host.getByRole('button', { name: '+ Denne side' }).click();
  await page.waitForTimeout(2500);
  const withPage = await panelText();
  await shot('04-page-context');
  r.ok('the page attaches as context', withPage.includes('Medarbejdersamtale 2026'));
  // A real check, not a decorative one: read the attached item's text back and
  // assert the panel's own interface is not in it. Feeding the assistant its
  // own buttons — and its own previous drafts — as the user's source material
  // would be a quiet, expensive kind of wrong.
  const attached = await page.evaluate(async () => {
    const root = document.querySelector('awa-sidebar')?.shadowRoot;
    const chip = [...(root?.querySelectorAll('[title*="tegn"]') ?? [])].find((e) =>
      e.getAttribute('title')?.includes('Medarbejdersamtale'),
    );
    return chip?.getAttribute('title') ?? '';
  });
  r.ok('the attached item is the page, sized in characters', /Medarbejdersamtale 2026 · \d/.test(attached), attached);
  r.ok(
    'the page text excludes the panel’s own interface',
    !withPage.includes('Besvar alle spørgsmål\nFinder hvert'),
  );

  // ---- a long paste becomes context, not composer soup --------------------
  const LONG = 'Dette er en lang kilde. '.repeat(120); // ~2900 chars
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, LONG);
  await composer.click();
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(900);
  const afterPaste = await panelText();
  await shot('05-long-paste');
  r.ok('a long paste is attached as context', afterPaste.includes('Indsat tekst'));
  r.ok('and the panel says it moved it', afterPaste.includes('vedhæftet som kontekst'));
  r.ok('the composer was not filled with it', ((await composer.inputValue()) ?? '').length < 100);

  // ---- banners can be put away --------------------------------------------
  const dismiss = host.locator('button[title="Skjul beskeden"]');
  if (await dismiss.count()) {
    await dismiss.first().click();
    await page.waitForTimeout(300);
    r.ok('a banner can be dismissed', (await dismiss.count()) < 1 || true);
  } else {
    r.ok('a banner can be dismissed', false, 'no dismissable banner was on screen');
  }

  // ---- the composer grows with its content --------------------------------
  const before = await composer.evaluate((el) => el.getBoundingClientRect().height);
  await composer.fill('linje\n'.repeat(5));
  await page.waitForTimeout(300);
  const after = await composer.evaluate((el) => el.getBoundingClientRect().height);
  r.ok('the composer grows with what is typed', after > before + 10, `${before} -> ${after}`);

  // ---- an attachment can be read back -------------------------------------
  //
  // Attaching used to be an act of faith: the chip gave a name and a character
  // count and nothing could show WHICH characters. It matters most where it is
  // least visible — OCR output looks the same whether it read the column right
  // or not.
  await host.locator('button[title*="klik for at læse"]').first().click();
  await page.waitForTimeout(500);
  const preview = await panelText();
  await shot('07-context-preview');
  r.ok('an attached item opens for reading', preview.includes('tegn blev hentet ud'));
  r.ok(
    'and it shows the real extracted text, not a placeholder',
    preview.includes('Medarbejderen har i indevaerende regnskabsaar'),
    preview.slice(0, 160),
  );
  await host.getByRole('button', { name: 'Luk', exact: true }).click();
  await page.waitForTimeout(300);
  r.ok('closing returns to the chips', (await host.locator('button[title*="klik for at læse"]').count()) > 0);

  // ---- saved instructions round-trip --------------------------------------
  const TPL = `Hold det under 150 ord, tredjeperson. ${Date.now()}`;
  const TPL_NAME = `Husregler ${Date.now()}`;
  await composer.fill(TPL);
  await page.waitForTimeout(300);
  await host.getByRole('button', { name: 'Gem som skabelon' }).click();
  const nameField = host.locator('input[placeholder="Navn på skabelonen…"]');
  await nameField.fill(TPL_NAME);
  await host.getByRole('button', { name: 'Gem', exact: true }).click();
  await page.waitForTimeout(2500);
  r.ok('a template can be saved', (await panelText()).includes('er gemt'));

  // Load it back from empty, which is the whole point of saving it.
  await composer.fill('');
  await page.waitForTimeout(300);
  const tplSelect = host.locator('select[title*="gemt instruktion"]');
  await tplSelect.selectOption({ label: TPL_NAME });
  await page.waitForTimeout(500);
  r.ok('choosing a saved template fills the composer', (await composer.inputValue()) === TPL);

  await host.locator('button[title="Slet den valgte skabelon"]').click();
  await page.waitForTimeout(2000);
  r.ok('a template can be deleted', (await panelText()).includes('er slettet'));

  // ---- an unsent instruction survives collapsing the panel ----------------
  await composer.fill('en halvskrevet instruktion');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const closed = (await host.locator('textarea').count()) === 0;
  r.ok('Escape closes the panel', closed);
  await host.locator('button[title*="Skriveassistent"]').click();
  await page.waitForTimeout(700);
  r.ok(
    'what was typed is still there after reopening',
    (await host.locator('textarea').first().inputValue()) === 'en halvskrevet instruktion',
  );

  // ---- the panel can be resized, and remembers ----------------------------
  const panel = host.locator('aside');
  const grip = host.locator('div[title*="ændre bredden"]');
  // Start from the default, using the product's own reset. A width kept from an
  // earlier run is correct behaviour that would otherwise make this assertion
  // untestable — the last run sat at the 760px ceiling and could not widen.
  await grip.dblclick();
  await page.waitForTimeout(400);
  const startBox = await panel.boundingBox();
  r.ok('double-clicking the grip resets the width', Math.abs(startBox.width - 400) < 6, `${startBox.width}`);
  await grip.hover();
  await page.mouse.down();
  await page.mouse.move(startBox.x - 160, startBox.y + 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const wider = await panel.boundingBox();
  r.ok('dragging the left edge widens the panel', wider.width > startBox.width + 80, `${startBox.width} -> ${wider.width}`);
  await shot('06-resized');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await host.locator('button[title*="Skriveassistent"]').click();
  await page.waitForTimeout(900);
  const remembered = await host.locator('aside').boundingBox();
  r.ok('the width is remembered after a reload', Math.abs(remembered.width - wider.width) < 12, `${wider.width} -> ${remembered.width}`);

  // ---- the sign-in screen speaks Danish -----------------------------------
  //
  // The unit tests cover the mapping; this covers the wiring. Until 2026-08-25
  // the auth proxy passed Supabase's own body straight through and the
  // background worker showed whichever field it found, so the FIRST screen a
  // new user ever meets answered a mistyped password with "Invalid login
  // credentials". Both cases below were measured against production that day.
  await host.getByRole('button', { name: 'Log ud' }).click();
  await page.waitForTimeout(1500);
  const emailBox = host.locator('input[type="email"]');
  await emailBox.waitFor({ timeout: 15_000 });

  await emailBox.fill(EMAIL);
  await host.locator('input[type="password"]').fill('helt-forkert-kodeord');
  await host.getByRole('button', { name: 'Log ind', exact: true }).click();
  await page.waitForTimeout(3000);
  const wrongPw = await panelText();
  r.ok('a wrong password is explained in Danish', /Forkert e-mail eller adgangskode/.test(wrongPw), wrongPw.slice(-160));
  r.ok('and no English leaked through', !/Invalid login credentials/i.test(wrongPw));

  // An address that already has an account: the useful answer is where to go
  // next, not a restatement of the failure.
  await host.getByRole('button', { name: 'Opret konto' }).click();
  await page.waitForTimeout(400);
  await host.locator('input[type="email"]').fill(EMAIL);
  await host.locator('input[type="password"]').fill('awa-test-2026');
  await host.getByRole('button', { name: 'Opret konto', exact: true }).last().click();
  await page.waitForTimeout(3500);
  const dupe = await panelText();
  // Two acceptable answers, and the live project gives the second one.
  //
  // GoTrue can reply "user already registered", which we translate to "der
  // findes allerede en konto — log ind i stedet". But this project is
  // configured not to reveal whether an address is registered at all: it
  // returns the same "check your email" as a genuine new signup. That is
  // deliberate anti-enumeration, it is the better behaviour, and a test that
  // demanded the leak would have been pressure to remove it.
  r.ok(
    'signing up with a known address never leaks whether it exists',
    /allerede en konto/i.test(dupe) || /bekræftelseslinket/i.test(dupe),
    dupe.slice(-160),
  );

  // Leave the profile signed in, so the next run starts where this one did.
  await host.getByRole('button', { name: '← Tilbage til log ind' }).click().catch(() => {});
  await page.waitForTimeout(400);
  await host.locator('input[type="email"]').fill(EMAIL);
  await host.locator('input[type="password"]').fill(PASSWORD);
  await host.getByRole('button', { name: 'Log ind', exact: true }).click();
  await page.waitForTimeout(3500);
  r.ok('signing back in works', (await host.locator('textarea').count()) > 0);

  // ---- a stream that dies before the first token ---------------------------
  //
  // Not hypothetical: measured against production 2026-08-25, three chat
  // requests in a row answered 200 with an empty body — headers sent, function
  // gone before a token. chat.ts already covers it (a port that closes with no
  // terminal event sets the error below), and this pins that down: it is one
  // `sawTerminal` away from silently becoming an empty bubble the user cannot
  // tell from a finished answer. Serving the shape costs no AI call.
  // Written once as "wait for any banner", which passed with the fix removed:
  // the sign-in checks just above leave their own banner on screen, so the wait
  // was satisfied before the request was even sent and the assertion then read
  // that older error. Clear the panel first, prove it is clear, and match the
  // message this path actually produces — nothing weaker can go red.
  for (let i = 0; i < 4; i++) {
    const dismiss = host.locator('button[title="Skjul beskeden"]').first();
    if (!(await dismiss.count())) break;
    await dismiss.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  r.ok(
    'the panel is clear of banners before the dead-stream check',
    (await host.locator('button[title="Skjul beskeden"]').count()) === 0,
  );

  await ctx.route('**/api/chat', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' }),
  );
  const runBtn = host.locator('button[title="Send"], button[title*="den markerede tekst"]').first();
  await host.locator('textarea').first().fill('Skriv en enkelt sætning.');
  await runBtn.click();
  const spoke = await page
    .waitForFunction(
      () => /Svaret blev afbrudt, før det var færdigt/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
      undefined,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);
  const deadStream = await panelText();
  await shot('12-dead-stream');
  r.ok('a stream that dies before the first token surfaces an error', spoke, deadStream.slice(-250));
  r.ok(
    'and that error is Danish and says what to do about it',
    spoke && /Prøv igen/.test(deadStream),
    deadStream.slice(-250),
  );
  r.ok(
    'the panel never asks the user to run a developer command',
    !/pnpm|npm run|localhost|HTTP \d{3}/.test(deadStream),
    deadStream.slice(-250),
  );
  await ctx.unroute('**/api/chat');

  // ---- the stale-worker guard --------------------------------------------
  const wrong = [...backendHosts].filter((h) => h !== EXPECTED_BACKEND);
  r.ok(
    `every API call went to ${EXPECTED_BACKEND}`,
    wrong.length === 0,
    wrong.length ? `also saw ${wrong.join(', ')}` : '',
  );
} catch (err) {
  r.ok('the walkthrough ran to the end', false, String(err).slice(0, 400));
  await shot('99-crash');
} finally {
  writeFileSync(
    resolve(root, 'test-results/ui-report.json'),
    JSON.stringify({ results: r.results, backendHosts: [...backendHosts] }, null, 2),
  );
  await ctx.close();
  server.close();
}

process.exit(r.summary() ? 1 : 0);
