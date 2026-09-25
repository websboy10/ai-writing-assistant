// node --test scripts/motor.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { check, learn, measureNext, pick, topicScores } from "./motor.mjs";

const today = "2026-10-20";
const questions = [
  { id: "crm-1", q: "Hvad er et CRM?", topic: "crm", volume: 3 },
  { id: "crm-2", q: "Hvad koster et CRM?", topic: "crm", volume: 2 },
  { id: "dia-1", q: "Hvad er en dialer?", topic: "dialer", volume: 2 },
];
const m = (id, date, extra) => ({ id, date, cited: false, position: null, competitors: [], ...extra });

test("the widest gap wins, and within it the weakest open question", () => {
  const measurements = [
    m("crm-1", "2026-10-19", { competitors: ["Acme"] }),
    m("crm-2", "2026-10-19", { competitors: ["Acme"] }),
    m("dia-1", "2026-10-19", { position: 2, competitors: ["Acme"] }),
  ];
  const r = pick({ questions, measurements, articles: [], today });
  assert.equal(r.topic, "crm"); // we are 0 vs 100 on crm, 100 vs 100 on dialer
  assert.equal(r.questionId, "crm-1"); // higher volume breaks the tie
  assert.equal(r.baseline, 0);
});

test("answered questions are never picked again", () => {
  const articles = [{ date: "2026-10-19", questionId: "crm-1", topic: "crm", baseline: 0 }];
  const r = pick({ questions, measurements: [], articles, today });
  assert.notEqual(r.questionId, "crm-1");
});

test("measurements older than the window are ignored", () => {
  const scores = topicScores(questions, [m("crm-1", "2026-08-01", { position: 1 })], today);
  assert.equal(scores.length, 0);
});

test("learning compares today's topic score with the article's baseline", () => {
  const scores = [{ topic: "crm", ourScore: 50 }];
  const young = { date: "2026-10-18", topic: "crm", baseline: 0 };
  const old = { date: "2026-10-01", topic: "crm", baseline: 0 };
  assert.equal(learn([young], scores, today).size, 0); // too new to judge
  assert.equal(learn([old], scores, today).get("crm").avgDelta, 50);
});

test("a topic whose articles backfired is deprioritised", () => {
  const measurements = [
    m("crm-2", "2026-10-19", { competitors: ["Acme"] }), // crm gap 100, but articles hurt
    m("dia-1", "2026-10-19", { position: 5, competitors: ["Acme"] }), // dialer gap 50
  ];
  const articles = [{ date: "2026-10-01", questionId: "crm-1", topic: "crm", baseline: 20 }];
  assert.equal(pick({ questions, measurements, articles, today }).topic, "dialer");
});

test("measure-next starts with questions never measured", () => {
  assert.deepEqual(measureNext(questions, [m("crm-1", "2026-10-19")], 2), ["crm-2", "dia-1"]);
});

const ok = "ChatBot Skriv er en dansk Chrome-udvidelse. " + "ord ".repeat(45);
const entry = (answer, extra = {}) => [
  {
    slug: "x",
    h1: "X?",
    metaTitle: "X",
    metaDescription: "x",
    intro: "x",
    datePublished: "2026-10-20",
    answer,
    bestFor: ["a"],
    sections: [{ heading: "h", body: "b" }],
    faq: [{ q: "q", a: "a" }],
    ...extra,
  },
];
const rules = { bannedTerms: ["Acme"], entityPhrase: "ChatBot Skriv" };

test("the gate passes a clean article", () => {
  assert.deepEqual(check(entry(ok), rules), []);
});

test("the gate blocks banned terms, dashes, prices and a missing entity sentence", () => {
  assert.match(check(entry(ok + " Acme"), rules).join(), /banned term: Acme/);
  assert.match(check(entry(ok + " a — b"), rules).join(), /dash/);
  assert.match(check(entry(ok + " koster 99 kr"), rules).join(), /price/);
  assert.match(check(entry("ord ".repeat(50)), rules).join(), /lacks/);
  assert.match(check([...entry(ok), ...entry(ok)], rules).join(), /duplicate/);
  assert.match(check(entry(ok, { slug: "Æble" }), rules).join(), /slug/);
  assert.deepEqual(check(entry(ok + " Acmes"), rules), []); // whole words only
});
