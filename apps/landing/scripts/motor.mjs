// The article engine's deterministic half. The daily routine (a Claude cloud
// agent) does the parts that need judgement - searching, reading answers,
// writing - and calls this for the parts that must not drift from day to day:
// which questions to measure, which gap to attack, whether earlier articles
// worked, and whether an article is allowed to ship.
//
//   node scripts/motor.mjs measure-next   ids of the questions to measure today
//   node scripts/motor.mjs pick           today's target question, as JSON
//   node scripts/motor.mjs learn          per-topic before/after for articles
//   node scripts/motor.mjs check          content gate; exits 1 on a violation
//
// State is plain files in data/motor/, committed with the article, so every
// decision the engine made can be read back in git.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data/motor");
const OWN_DOMAIN = "chatbotskriv.dk";
const WINDOW_DAYS = 21; // measurements older than this no longer describe the present
const LEARN_AFTER_DAYS = 7; // an article needs time to be indexed before we judge it

const readJson = (f) => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));
const readJsonl = (f) =>
  existsSync(path.join(DATA, f))
    ? readFileSync(path.join(DATA, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5;

// 100 if we are named in the answer or rank top 3, 50 for the rest of page one.
export function ownScore(m) {
  if (m.cited || (m.position && m.position <= 3)) return 100;
  if (m.position && m.position <= 10) return 50;
  return 0;
}

// Latest measurement per question inside the window.
export function latestByQuestion(measurements, today) {
  const latest = new Map();
  for (const m of measurements) {
    if (daysBetween(m.date, today) > WINDOW_DAYS) continue;
    const prev = latest.get(m.id);
    if (!prev || prev.date < m.date) latest.set(m.id, m);
  }
  return latest;
}

// Per topic: our average score, the strongest competitor's share of the
// questions (named or top 3), and the question volume behind it.
export function topicScores(questions, measurements, today) {
  const latest = latestByQuestion(measurements, today);
  const topics = new Map();
  for (const q of questions) {
    const m = latest.get(q.id);
    if (!m) continue;
    const t = topics.get(q.topic) || { topic: q.topic, n: 0, own: 0, volume: 0, comp: new Map() };
    t.n += 1;
    t.own += ownScore(m);
    t.volume += q.volume;
    for (const c of new Set(m.competitors || [])) t.comp.set(c, (t.comp.get(c) || 0) + 1);
    topics.set(q.topic, t);
  }
  return [...topics.values()].map((t) => {
    const [competitor, hits] = [...t.comp.entries()].sort((a, b) => b[1] - a[1])[0] || ["", 0];
    return {
      topic: t.topic,
      ourScore: Math.round(t.own / t.n),
      competitor,
      competitorScore: Math.round((hits / t.n) * 100),
      volume: t.volume,
    };
  });
}

// Did the articles we wrote move their topic? Baseline is the topic score on
// the day the article was written; current is today's.
export function learn(articles, scores, today) {
  const byTopic = new Map(scores.map((s) => [s.topic, s.ourScore]));
  const stats = new Map();
  for (const a of articles) {
    if (a.baseline == null || daysBetween(a.date, today) < LEARN_AFTER_DAYS) continue;
    const current = byTopic.get(a.topic);
    if (current == null) continue;
    const s = stats.get(a.topic) || { topic: a.topic, count: 0, delta: 0 };
    s.count += 1;
    s.delta += current - a.baseline;
    stats.set(a.topic, s);
  }
  return new Map([...stats].map(([k, s]) => [k, { ...s, avgDelta: s.delta / s.count }]));
}

// Same multipliers as the LeadFactory engine: double down where articles
// moved the score, back off where they did not.
function multiplier(stat) {
  if (!stat) return 1;
  if (stat.avgDelta > 1) return 1.5;
  if (stat.avgDelta < 0) return 0.5;
  return 0.85;
}

export function pick({ questions, measurements, articles, today }) {
  const answered = new Set(articles.map((a) => a.questionId));
  const open = questions.filter((q) => !answered.has(q.id));
  if (!open.length) return null;

  const scores = topicScores(questions, measurements, today);
  const stats = learn(articles, scores, today);
  const recent = new Set(articles.filter((a) => daysBetween(a.date, today) < 3).map((a) => a.topic));

  const ranked = scores
    .filter((s) => open.some((q) => q.topic === s.topic))
    .map((s) => {
      const gap = Math.max(0, s.competitorScore - s.ourScore);
      // +1 keeps a topic we have never measured a competitor on in play
      const severity = (gap + 1) * Math.log10(s.volume + 10) * multiplier(stats.get(s.topic));
      return { ...s, severity: recent.has(s.topic) ? severity * 0.3 : severity };
    })
    .sort((a, b) => b.severity - a.severity);

  const latest = latestByQuestion(measurements, today);
  // Unmeasured topics fall back to question order: the list is hand-prioritised.
  const topic = ranked[0]?.topic ?? open[0].topic;
  const target = open
    .filter((q) => q.topic === topic)
    .sort((a, b) => {
      const sa = latest.has(a.id) ? ownScore(latest.get(a.id)) : 0;
      const sb = latest.has(b.id) ? ownScore(latest.get(b.id)) : 0;
      return sa - sb || b.volume - a.volume || questions.indexOf(a) - questions.indexOf(b);
    })[0];

  const topicScore = scores.find((s) => s.topic === topic);
  return {
    questionId: target.id,
    question: target.q,
    topic,
    baseline: topicScore ? topicScore.ourScore : null,
    competitor: topicScore?.competitor || null,
    competitorScore: topicScore?.competitorScore ?? null,
    ranking: ranked.slice(0, 5),
  };
}

// Least recently measured first, never-measured before everything.
export function measureNext(questions, measurements, n) {
  const last = new Map();
  for (const m of measurements) if (!last.has(m.id) || last.get(m.id) < m.date) last.set(m.id, m.date);
  return [...questions]
    .sort((a, b) => (last.get(a.id) || "").localeCompare(last.get(b.id) || ""))
    .slice(0, n)
    .map((q) => q.id);
}

// The publish gate. Runs before the Vercel build, so a violation fails the
// deploy and nothing ships - the prompt's rules are a request, this is the check.
// Competitors may be named on this site; bannedTerms is for anything that may not.
export function check(articles, { bannedTerms, entityPhrase }) {
  const problems = [];
  const lower = JSON.stringify(articles).toLowerCase();
  for (const term of bannedTerms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "u");
    if (re.test(lower)) problems.push(`banned term: ${term}`);
  }
  const slugs = new Set();
  for (const a of articles) {
    const slug = a.slug ?? "?";
    const text = JSON.stringify(a);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) problems.push(`${slug}: slug must be lowercase ascii and hyphens`);
    if (slugs.has(slug)) problems.push(`${slug}: duplicate slug`);
    slugs.add(slug);
    if (text.includes("—") || text.includes("–")) problems.push(`${slug}: em/en dash (hyphens only)`);
    if (/\d+(?:[.,]\d+)?\s?(%|procent|kr\b|kroner|dollar|\$|€|euro)/iu.test(text))
      problems.push(`${slug}: a price or percentage - the articles may not state figures that go stale`);
    const answer = a.answer ?? "";
    if (!answer.includes(entityPhrase)) problems.push(`${slug}: answer lacks "${entityPhrase}"`);
    const words = answer.split(/\s+/).filter(Boolean).length;
    if (words < 40 || words > 80) problems.push(`${slug}: answer is ${words} words (40-80)`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.datePublished ?? "")) problems.push(`${slug}: missing datePublished`);
    if (!a.bestFor?.length) problems.push(`${slug}: missing bestFor`);
    for (const f of ["h1", "metaTitle", "metaDescription", "intro"]) if (!a[f]) problems.push(`${slug}: missing ${f}`);
    if (a.metaTitle?.length > 60) problems.push(`${slug}: metaTitle over 60 chars`);
    if (!a.sections?.length || !a.faq?.length) problems.push(`${slug}: needs sections and faq`);
  }
  return problems;
}

function main() {
  const [cmd] = process.argv.slice(2);
  const today = new Date().toISOString().slice(0, 10);
  const config = readJson("config.json");
  const questions = readJson("spoergsmaal.json");
  const measurements = readJsonl("maalinger.jsonl");
  const articles = readJsonl("artikler.jsonl");

  if (cmd === "measure-next") {
    console.log(measureNext(questions, measurements, config.measurePerRun).join("\n"));
  } else if (cmd === "pick") {
    console.log(JSON.stringify(pick({ questions, measurements, articles, today }), null, 2));
  } else if (cmd === "learn") {
    const scores = topicScores(questions, measurements, today);
    console.log(JSON.stringify({ scores, learned: [...learn(articles, scores, today).values()] }, null, 2));
  } else if (cmd === "check") {
    const source = JSON.parse(readFileSync(path.join(ROOT, "content/artikler.json"), "utf8"));
    const problems = check(source, { bannedTerms: config.bannedTerms, entityPhrase: config.entityPhrase });
    if (problems.length) {
      console.error("Article gate failed:\n- " + problems.join("\n- "));
      process.exit(1);
    }
    console.log("Article gate: ok");
  } else {
    console.error("usage: motor.mjs measure-next | pick | learn | check");
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
