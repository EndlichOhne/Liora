import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GAP_SENTENCE,
  discover,
  disconfirmPair,
  extractCaseFeatures,
  featureFingerprint,
  originMatchesEvidence,
  rejectDiscoveryClaim,
  type FeatureInput,
} from "./discovery.ts";

function feat(patch: Partial<FeatureInput> & Pick<FeatureInput, "caseId" | "value">): FeatureInput {
  return {
    caseTitle: patch.caseId === "a" ? "Akte A" : patch.caseId === "b" ? "Akte B" : "Akte C",
    key: "merkmal",
    origin: "media_report",
    evidence: "reported",
    sourceUrl: `https://example.de/${patch.caseId}/${patch.value}`,
    auto: false,
    ...patch,
  };
}

describe("cross-case discovery", () => {
  it("rejects claims about hidden police knowledge and suspect naming", () => {
    assert.match(rejectDiscoveryClaim("Die Polizei weiß das nicht") ?? "", /Unzulässig/);
    assert.match(rejectDiscoveryClaim("Wir haben den Täter gefunden") ?? "", /Unzulässig/);
    assert.equal(rejectDiscoveryClaim("Merkmal aus einer Zeitung"), null);
    assert.match(GAP_SENTENCE, /intern/);
    assert.equal(/polizei weiß das nicht/i.test(GAP_SENTENCE), false);
  });

  it("folds spelling and keeps a calendar day out of the pattern priority", () => {
    const spelled = discover([
      feat({ caseId: "a", value: "blauer Koffer" }),
      feat({ caseId: "b", value: "Blauer-Koffer", sourceUrl: "https://archiv.example/k" }),
    ]);
    const hit = spelled.insights.find((item) => item.kind === "pattern" || item.kind === "crossover");
    assert.ok(hit);
    assert.equal(hit?.priority, "low");
    assert.match(hit?.featureNote ?? "", /Koffer/i);
    assert.ok(spelled.derived.some((point) => point.kind === "spelling"));

    const timed = discover([
      feat({ caseId: "a", caseTitle: "Akte A", key: "zeit", value: "2026-03-01", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
      feat({ caseId: "b", caseTitle: "Akte B", key: "zeit", value: "2026-03-11", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
      feat({ caseId: "c", caseTitle: "Akte C", key: "zeit", value: "2026-03-21", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
    ]);
    assert.equal(timed.insights.filter((item) => item.kind === "pattern" || item.kind === "crossover").length, 0);
    const gap = timed.derived.find((point) => point.kind === "time_gap" && point.value.includes("10 Tage"));
    assert.ok(gap);
    const order = timed.derived.find((point) => point.kind === "time_gap" && point.caseIds.length === 3);
    assert.match(order?.value ?? "", /Reihenfolge/);
    assert.ok(timed.graph.some((edge) => edge.relation === "zeitliche Reihenfolge berechnet"));
    assert.equal(/polizei weiß das nicht|denselben täter/i.test(timed.derived.map((point) => point.value).join(" ")), false);
  });

  it("does not turn a shared city or a hypothesis into a pattern", () => {
    const weak = discover([
      feat({ caseId: "a", key: "ort", value: "Karlsruhe", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
      feat({ caseId: "b", key: "ort", value: "Karlsruhe", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
    ]);
    assert.equal(weak.insights.length, 0);
    assert.ok(weak.derived.some((point) => point.kind === "place_relation"));
    assert.match(weak.derived.map((point) => point.value).join(" "), /keine Kilometer/i);
    assert.doesNotMatch(weak.derived.map((point) => point.value).join(" "), /\bkm\b|\d+\s*%/);
    const extracted = extractCaseFeatures({
      id: "a",
      title: "Akte A",
      region: "karlsruhe",
      city: "Karlsruhe",
      place: "",
      caseType: "unsolved",
      caseStatus: "open",
      openedOn: "",
      events: [],
      items: [
        { kind: "feature", body: "Max ist der Täter", evidence: "hypothesis", sourceUrl: "" },
        { kind: "feature", body: "blauer Koffer", evidence: "reported", sourceUrl: "https://example.de/koffer" },
        { kind: "note", body: "wird nicht zum Merkmal", evidence: "reported", sourceUrl: "https://example.de/note" },
      ],
    });
    assert.equal(extracted.some((feature) => /täter/i.test(feature.value)), false);
    assert.equal(extracted.some((feature) => feature.value === "blauer Koffer"), true);
    assert.equal(extracted.some((feature) => feature.value === "wird nicht zum Merkmal"), false);
  });

  it("keeps a single rare detail from becoming a suspect marker", () => {
    const result = discover([
      feat({ caseId: "a", value: "blauer Koffer" }),
      feat({ caseId: "b", value: "blauer Koffer", sourceUrl: "https://archiv.example/koffer" }),
    ]);
    const hit = result.insights.find((item) => item.kind === "pattern" || item.kind === "crossover");
    assert.ok(hit);
    assert.equal(hit?.priority, "low");
    assert.equal(hit?.status, "held");
    assert.match(hit?.reason ?? "", /kein Tätermerkmal/);
    assert.equal(/täter gefunden|denselben täter|polizei weiß das nicht/i.test(`${hit?.reason} ${hit?.officialNote}`), false);
  });

  it("raises a sourced combination without calling it proven, and records the chain", () => {
    const rows: FeatureInput[] = [
      feat({ caseId: "a", key: "merkmal", value: "blauer Koffer", origin: "media_report", sourceUrl: "https://zeitung.example/a" }),
      feat({ caseId: "b", key: "merkmal", value: "blauer Koffer", origin: "public_archive", sourceUrl: "https://archiv.example/b" }),
      feat({ caseId: "a", key: "gegenstand", value: "Seil", origin: "academic", sourceUrl: "https://uni.example/seil" }),
      feat({ caseId: "b", key: "gegenstand", value: "Seil", origin: "media_report", sourceUrl: "https://zeitung.example/seil" }),
      feat({ caseId: "a", key: "ablauf", value: "Nacht am Hafen", origin: "police_publication", evidence: "official", sourceUrl: "https://polizei.example/1" }),
      feat({ caseId: "b", key: "ablauf", value: "Nacht am Hafen", origin: "police_publication", evidence: "official", sourceUrl: "https://polizei.example/2" }),
      feat({ caseId: "a", key: "formulierung", value: "gleiche Wortwahl", origin: "media_report", sourceUrl: "https://zeitung.example/wort" }),
      feat({ caseId: "b", key: "formulierung", value: "gleiche Wortwahl", origin: "public_archive", sourceUrl: "https://archiv.example/wort" }),
    ];
    const result = discover(rows);
    const hit = result.insights.find((item) => item.caseIds.includes("a") && item.caseIds.includes("b") && item.kind !== "negative");
    assert.ok(hit);
    assert.equal(hit?.priority, "high");
    assert.equal(hit?.kind, "crossover");
    assert.equal(hit?.status, "open");
    assert.equal(hit?.dataClass, "ai_derived");
    assert.match(hit?.marks ?? "", /Aus dem Vergleich abgeleitet/);
    assert.match(hit?.marks ?? "", /Nicht genug Daten/);
    assert.match(hit?.rarity ?? "", /INSUFFICIENT DATA/);
    assert.match(hit?.method ?? "", /stored-feature-compare-v2/);
    assert.doesNotMatch(`${hit?.rarity} ${(hit?.calculations ?? []).join(" ")}`, /\d+\s*%|\bkm\b/);
    assert.match(hit?.reason ?? "", /ohne offizielle Theorie/);
    assert.match(hit?.officialNote ?? "", /nicht erwähnt/);
    assert.equal(/polizei weiß das nicht|denselben täter|täter gefunden/i.test(`${hit?.reason} ${hit?.officialNote} ${hit?.disconfirmation}`), false);
    assert.ok((hit?.chain.length ?? 0) >= 5);
    assert.ok((hit?.sources.length ?? 0) >= 3);
    assert.match(hit?.chain.join(" ") ?? "", /Aus dem Vergleich abgeleitet/);
  });

  it("downgrades a link when a stored counter-feature exists", () => {
    const shared = [
      feat({ caseId: "a", key: "gegenstand", value: "Seil" }),
      feat({ caseId: "b", key: "gegenstand", value: "Seil" }),
    ];
    const left = [...shared, feat({ caseId: "a", key: "fehlt", value: "Seil", sourceUrl: "" })];
    const check = disconfirmPair(shared, left, shared);
    assert.equal(check.kill, true);
    const result = discover([
      feat({ caseId: "a", key: "merkmal", value: "blauer Koffer" }),
      feat({ caseId: "b", key: "merkmal", value: "blauer Koffer", sourceUrl: "https://archiv.example/k" }),
      feat({ caseId: "a", key: "gegenstand", value: "Seil" }),
      feat({ caseId: "b", key: "gegenstand", value: "Seil", sourceUrl: "https://archiv.example/s" }),
      feat({ caseId: "a", key: "fehlt", value: "Seil", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
    ]);
    const hit = result.insights.find((item) => (item.kind === "pattern" || item.kind === "crossover") && item.caseIds.length === 2);
    assert.equal(hit?.status, "downgraded");
    assert.match(hit?.disconfirmation ?? "", /Gegenmerkmal/);
  });

  it("records a comparable case that lacks the shared feature", () => {
    const result = discover([
      feat({ caseId: "a", caseTitle: "Akte A", key: "case_type", value: "unsolved", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
      feat({ caseId: "b", caseTitle: "Akte B", key: "case_type", value: "unsolved", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
      feat({ caseId: "c", caseTitle: "Akte C", key: "case_type", value: "unsolved", origin: "user_provided", evidence: "unknown", sourceUrl: "" }),
      feat({ caseId: "a", key: "merkmal", value: "blauer Koffer" }),
      feat({ caseId: "b", key: "merkmal", value: "blauer Koffer", sourceUrl: "https://archiv.example/k" }),
      feat({ caseId: "a", key: "gegenstand", value: "Seil" }),
      feat({ caseId: "b", key: "gegenstand", value: "Seil", sourceUrl: "https://archiv.example/s" }),
    ]);
    const negative = result.insights.find((item) => item.kind === "negative");
    assert.ok(negative);
    assert.match(negative?.reason ?? "", /Akte C/);
    assert.match(negative?.reason ?? "", /fehlt/);
  });

  it("marks a public detail that reviewed official features do not contain", () => {
    const result = discover([
      feat({ caseId: "a", key: "merkmal", value: "Pressetext", origin: "police_publication", evidence: "official", sourceUrl: "https://polizei.example/p" }),
      feat({ caseId: "a", key: "merkmal", value: "blauer Koffer", origin: "media_report", sourceUrl: "https://zeitung.example/k" }),
      feat({ caseId: "b", key: "merkmal", value: "anderes Merkmal", origin: "media_report", sourceUrl: "https://zeitung.example/x" }),
    ]);
    const gap = result.insights.find((item) => item.kind === "gap" && item.featureNote === "blauer Koffer");
    assert.ok(gap);
    assert.match(gap?.officialNote ?? "", /nicht erwähnt/);
    assert.equal(/weiß das nicht/i.test(gap?.officialNote ?? ""), false);
  });

  it("clusters only sourced features and leaves the fingerprint stable", () => {
    const result = discover([
      feat({ caseId: "a", caseTitle: "Akte A", key: "merkmal", value: "blauer Koffer" }),
      feat({ caseId: "b", caseTitle: "Akte B", key: "merkmal", value: "blauer Koffer" }),
      feat({ caseId: "c", caseTitle: "Akte C", key: "merkmal", value: "blauer Koffer" }),
      feat({ caseId: "a", key: "gegenstand", value: "Seil" }),
      feat({ caseId: "b", key: "gegenstand", value: "Seil" }),
      feat({ caseId: "c", key: "gegenstand", value: "Seil" }),
    ]);
    const cluster = result.insights.find((item) => item.kind === "cluster");
    assert.ok(cluster);
    assert.equal(cluster?.caseIds.length, 3);
    assert.match(cluster?.officialNote ?? "", /keine Täterfeststellung/i);
    const base = [feat({ caseId: "a", value: "x" })];
    assert.equal(featureFingerprint(base), featureFingerprint([...base]));
    assert.notEqual(featureFingerprint(base), featureFingerprint([feat({ caseId: "a", value: "y" })]));
  });

  it("does not treat a court label as a media class", () => {
    assert.match(originMatchesEvidence("court_publication", "reported") ?? "", /Gericht/);
    assert.equal(originMatchesEvidence("media_report", "reported"), null);
    assert.match(originMatchesEvidence("ai_derived", "unknown") ?? "", /Vergleich/);
  });
});
