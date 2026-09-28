import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leadsFromCitations, originKey } from "./engine.ts";
import {
  NONE_FOUND,
  draftFromHit,
  matchDuplicate,
  nextScanRegion,
  researchOutcome,
  type KnownRecord,
  type PublicHit,
} from "./intake.ts";

function hit(patch: Partial<PublicHit> = {}): PublicHit {
  return {
    url: "https://ppkarlsruhe.polizei-bw.de/meldung/1",
    title: "POL-KA: Festnahme nach Raub in Karlsruhe",
    snippet: "Die Polizei Karlsruhe meldet eine Festnahme am 3.4.2024.",
    region: "karlsruhe",
    evidence: "official",
    kind: "police",
    originKey: "ppkarlsruhe.polizei-bw.de|pol ka festnahme nach raub in karlsruhe",
    ...patch,
  };
}

const known = (patch: Partial<KnownRecord> = {}): KnownRecord => ({
  id: "case-1",
  kind: "case",
  title: "POL-KA: Festnahme nach Raub in Karlsruhe",
  city: "Karlsruhe",
  openedOn: "2024-04-03",
  caseType: "robbery",
  sourceUrls: ["https://ppkarlsruhe.polizei-bw.de/meldung/1"],
  originKeys: ["pm:110972/5950874"],
  ...patch,
});

describe("public case intake", () => {
  it("does not turn an empty search or a portal page into a case", () => {
    assert.equal(researchOutcome({ citations: 0, adopted: 0, waiting: 0, duplicates: 0 }), NONE_FOUND);
    assert.equal(draftFromHit(hit({ title: "Polizeipräsidium Karlsruhe", snippet: "Startseite mit Pressemitteilungen" })), null);
    assert.equal(draftFromHit(hit({ title: "Kurz", snippet: "Festnahme" })), null);
  });

  it("adopts an official incident and keeps a media report for review", () => {
    const police = draftFromHit(hit());
    assert.ok(police);
    assert.equal(police?.adoptable, true);
    assert.equal(police?.evidence, "official");
    assert.equal(police?.city, "Karlsruhe");
    assert.equal(police?.openedOn, "2024-04-03");
    assert.equal(police?.caseType, "robbery");
    assert.equal(police?.missing.includes("DATE MISSING"), false);
    const media = draftFromHit(hit({
      url: "https://www.swr.de/nachrichten/festnahme",
      evidence: "reported",
      kind: "media",
      originKey: "swr.de|festnahme",
      snippet: "Ein Medium berichtet über eine Festnahme.",
    }));
    assert.equal(media?.adoptable, false);
    assert.equal(media?.status, "needs_review");
    assert.equal(media?.evidence, "reported");
  });

  it("labels a missing date and does not invent a city outside the named region", () => {
    const draft = draftFromHit(hit({
      region: "bw",
      title: "Polizei meldet eine Festnahme in Baden-Württemberg",
      snippet: "Keine Uhrzeit und kein Datum im Text.",
      originKey: "bw-festnahme",
    }));
    assert.ok(draft);
    assert.equal(draft?.openedOn, "");
    assert.equal(draft?.city, "");
    assert.deepEqual(draft?.missing, ["DATE MISSING", "CITY MISSING"]);
  });

  it("collapses the same police wire and similar spellings into one case", () => {
    const copies = leadsFromCitations([
      { url: "https://www.presseportal.de/blaulicht/pm/110972/5950874", title: "POL-KA: Festnahme Karlsruhe", snippet: "Festnahme" },
      { url: "https://mirror.example/blaulicht/pm/110972/5950874", title: "POL-KA: Festnahme Karlsruhe", snippet: "Festnahme" },
    ]);
    assert.equal(copies.kept.length, 1);
    const lead = copies.kept[0];
    const draft = draftFromHit({
      url: lead.url,
      title: lead.title ?? "",
      snippet: lead.snippet ?? "",
      region: lead.region,
      evidence: lead.evidence,
      kind: lead.kind,
      originKey: lead.originKey,
    });
    assert.equal(draft?.adoptable, true);
    assert.equal(draft?.evidence, "documented");
    const key = originKey({ url: "https://www.presseportal.de/blaulicht/pm/110972/5950874", title: "POL-KA: Festnahme Karlsruhe" });
    const duplicate = matchDuplicate(
      { title: "Festnahme in Karlsruhe", city: "Karlsruhe", openedOn: "2024-04-03", caseType: "robbery", sourceUrl: "https://other.example/a", originKey: key },
      [known()],
    );
    assert.equal(duplicate?.reason, "gleiche Herkunft");
    const spelling = matchDuplicate(
      { title: "Festnahme nach Raub Karlsruhe", city: "", openedOn: "", caseType: "unsolved", sourceUrl: "https://other.example/b", originKey: "other" },
      [known({ originKeys: [], sourceUrls: [] })],
    );
    assert.equal(spelling?.reason, "ähnliche Schreibweise");
  });

  it("does not store a claim about hidden police knowledge or a named perpetrator", () => {
    assert.equal(draftFromHit(hit({ snippet: "Die Polizei weiß das nicht, aber es gab eine Festnahme." })), null);
    assert.equal(draftFromHit(hit({ title: "Festnahme: die KI findet den Täter in Karlsruhe", snippet: "Festnahme gemeldet." })), null);
  });

  it("says when nothing concrete was found and prefers an unscanned region", () => {
    assert.equal(researchOutcome({ citations: 4, adopted: 0, waiting: 0, duplicates: 2 }), NONE_FOUND);
    assert.equal(researchOutcome({ citations: 2, adopted: 1, waiting: 1, duplicates: 0 }), "1 in die Fallbank übernommen, 1 zur Prüfung. Nichts erfunden.");
    const now = new Date("2026-09-28T12:00:00.000Z");
    assert.equal(nextScanRegion({}, now), "karlsruhe");
    assert.equal(nextScanRegion({ karlsruhe: "2026-09-28T11:00:00.000Z" }, now), "stuttgart");
  });
});
