import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowPerson,
  chooseWork,
  classifyContradiction,
  classifyHost,
  contentHash,
  detectRegion,
  independentOrigins,
  keepForeign,
  leadsFromCitations,
  originKey,
  regionRank,
  rejectAsFact,
  reviewPublicStatement,
  safePublicUrl,
  scanFocus,
  scanQuery,
  similarityNote,
  timelineGaps,
  watchDelta,
} from "./engine.ts";

describe("german case desk", () => {
  it("ranks Karlsruhe before Stuttgart, Mannheim, Rastatt, Baden-Württemberg and Germany", () => {
    assert.ok(regionRank("karlsruhe") < regionRank("stuttgart"));
    assert.ok(regionRank("stuttgart") < regionRank("mannheim"));
    assert.ok(regionRank("mannheim") < regionRank("rastatt"));
    assert.ok(regionRank("rastatt") < regionRank("bw"));
    assert.ok(regionRank("bw") < regionRank("de"));
  });

  it("reads the highest-priority place in a text", () => {
    assert.equal(detectRegion("Verfahren in Stuttgart und Karlsruhe"), "karlsruhe");
    assert.equal(detectRegion("Nur Baden-Württemberg"), "bw");
    assert.equal(detectRegion("A case in Lyon"), null);
  });

  it("drops foreign-only material unless a German place is also named", () => {
    assert.equal(keepForeign("Vermisst in Lyon", false), false);
    assert.equal(keepForeign("Person aus Karlsruhe möglicherweise in Ungarn", false), true);
  });

  it("counts one police wire even when three sites repeat it", () => {
    const key = originKey({ url: "https://www.presseportal.de/blaulicht/pm/110972/5950874", title: "POL-KA: Karlsruhe" });
    const rows = [
      { originKey: key },
      { originKey: originKey({ url: "https://example.de/kopie", title: "POL-KA: Karlsruhe" }) },
      { originKey: key },
    ];
    assert.equal(key, "pm:110972/5950874");
    assert.equal(independentOrigins([rows[0], rows[2]]), 1);
    assert.equal(independentOrigins(rows), 2);
  });

  it("does not treat a police wire as an unverified media fact or a court ruling", () => {
    const police = classifyHost("https://ppkarlsruhe.polizei-bw.de/", "Meldung");
    assert.equal(police.kind, "police");
    assert.equal(police.evidence, "official");
    const wire = classifyHost("https://www.presseportal.de/blaulicht/pm/110972/1", "POL-KA: Rastatt");
    assert.equal(wire.kind, "press_release");
    assert.equal(wire.evidence, "documented");
    const paper = classifyHost("https://www.swr.de/nachrichten", "Bericht");
    assert.equal(paper.evidence, "reported");
    assert.match(paper.note, /nicht unabhängig/);
    const social = classifyHost("https://x.com/someone/status/1", "Hinweis");
    assert.equal(social.evidence, "alleged");
  });

  it("refuses accusations and hypotheses dressed up as facts", () => {
    assert.match(rejectAsFact("Die KI findet den Täter.", "reported") ?? "", /niemand/);
    assert.equal(rejectAsFact("Das Urteil stellt die Tat fest.", "court"), null);
    assert.match(rejectAsFact("Es steht fest, dass Hypothese A bewiesen ist.", "hypothesis") ?? "", /Hypothese/);
    assert.match(allowPerson("convicted", "reported") ?? "", /gericht/);
    assert.equal(allowPerson("named", "reported"), null);
  });

  it("separates contradiction kinds", () => {
    const direct = classifyContradiction(
      { text: "Die Polizei teilte mit, dass die Person in Karlsruhe festgenommen wurde.", evidence: "official" },
      { text: "Die Polizei teilte mit, dass die Person in Karlsruhe nicht festgenommen wurde.", evidence: "official" },
    );
    assert.equal(direct.kind, "direct");
    const possible = classifyContradiction(
      { text: "Die Zeitung schreibt, der Zeuge sei vor Ort gewesen am Abend.", evidence: "reported" },
      { text: "Die Zeitung schreibt, der Zeuge sei vor Ort nicht gewesen am Abend.", evidence: "reported" },
    );
    assert.equal(possible.kind, "possible");
    assert.equal(classifyContradiction({ text: "Kurz.", evidence: "unknown" }, { text: "Auch kurz.", evidence: "unknown" }).kind, "insufficient");
  });

  it("finds timeline gaps and refuses a proven link from mere similarity", () => {
    assert.equal(timelineGaps(["2024-01-01", "2024-03-15"]).length, 1);
    assert.match(similarityNote(true, true, false), /kein belegter Zusammenhang/i);
    assert.match(similarityNote(true, true, true), /ausdrücklich/);
  });

  it("does not invent a lie from wording", () => {
    const review = reviewPublicStatement("Zuvor sagte sie nein, später sagte sie doch.");
    assert.equal(review.refusesDiagnosis, true);
    assert.equal(review.notes.join(" ").toLowerCase().includes("lügt"), false);
  });

  it("scans Karlsruhe before it repeats a fresh region, and idles when nothing is due", () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const first = chooseWork({
      now,
      lastScan: {},
      staleWatches: 0,
      casesMissingSource: 0,
      hoursSinceContradiction: 1,
      hoursSinceCold: 1,
      hoursSinceBenchmark: 1,
      coldCases: 0,
      webAllowed: true,
    });
    assert.equal(first.kind, "scan_region");
    assert.equal(first.region, "karlsruhe");
    assert.match(scanQuery("karlsruhe", "new"), /Karlsruhe/);

    const idle = chooseWork({
      now,
      lastScan: {
        karlsruhe: "2026-09-27T10:00:00.000Z",
        stuttgart: "2026-09-27T10:00:00.000Z",
        mannheim: "2026-09-27T10:00:00.000Z",
        rastatt: "2026-09-27T10:00:00.000Z",
        bw: "2026-09-27T10:00:00.000Z",
        de: "2026-09-27T10:00:00.000Z",
      },
      staleWatches: 0,
      casesMissingSource: 0,
      hoursSinceContradiction: 1,
      hoursSinceCold: 1,
      hoursSinceBenchmark: 1,
      coldCases: 0,
      webAllowed: true,
    });
    assert.equal(idle.kind, "idle");
    assert.equal(idle.web, false);
    const discovery = chooseWork({
      now,
      lastScan: {
        karlsruhe: "2026-09-27T10:00:00.000Z",
        stuttgart: "2026-09-27T10:00:00.000Z",
        mannheim: "2026-09-27T10:00:00.000Z",
        rastatt: "2026-09-27T10:00:00.000Z",
        bw: "2026-09-27T10:00:00.000Z",
        de: "2026-09-27T10:00:00.000Z",
      },
      staleWatches: 0,
      casesMissingSource: 0,
      hoursSinceContradiction: 1,
      hoursSinceCold: 1,
      hoursSinceBenchmark: 1,
      coldCases: 0,
      webAllowed: true,
      comparableCases: 2,
      hoursSinceDiscovery: null,
    });
    assert.equal(discovery.kind, "discovery");
    assert.equal(discovery.web, false);
  });

  it("does not search the web when the quota is closed, and skips unchanged pages", () => {
    const local = chooseWork({
      now: new Date("2026-09-27T12:00:00.000Z"),
      lastScan: {},
      staleWatches: 0,
      casesMissingSource: 2,
      hoursSinceContradiction: 1,
      hoursSinceCold: 1,
      hoursSinceBenchmark: 1,
      coldCases: 1,
      webAllowed: false,
    });
    assert.equal(local.web, false);
    assert.equal(local.kind, "gap_review");
    assert.equal(contentHash("gleiche seite"), contentHash("gleiche seite"));
    assert.notEqual(contentHash("gleiche seite"), contentHash("neue fassung"));
    assert.equal(safePublicUrl("http://example.de/a"), null);
    assert.equal(safePublicUrl("https://127.0.0.1/a"), null);
  });

  it("creates no lead from an empty search and drops hits that name no German place", () => {
    assert.deepEqual(leadsFromCitations([]), { kept: [], dropped: 0 });
    const result = leadsFromCitations([
      { url: "https://www.example.com/lyon", title: "Fall in Lyon", snippet: "Ausland ohne deutschen Ort" },
      { url: "https://ppkarlsruhe.polizei-bw.de/meldung", title: "POL-KA: Karlsruhe Festnahme", snippet: "Polizei Karlsruhe" },
      { url: "https://ppkarlsruhe.polizei-bw.de/meldung", title: "POL-KA: Karlsruhe Festnahme", snippet: "Polizei Karlsruhe" },
    ]);
    assert.equal(result.kept.length, 1);
    assert.equal(result.kept[0].region, "karlsruhe");
    assert.equal(result.dropped, 2);
  });

  it("rotates the daily search and stores a first page hash without calling it a change", () => {
    assert.equal(scanFocus(0), "new");
    assert.equal(scanFocus(1), "court");
    assert.equal(scanFocus(2), "missing");
    assert.equal(scanFocus(-1), "missing");
    const first = watchDelta("", "abc");
    assert.equal(first.baseline, true);
    assert.equal(first.changed, false);
    assert.equal(first.hash, "abc");
    assert.equal(watchDelta("abc", "abc").changed, false);
    assert.equal(watchDelta("abc", "def").changed, true);
  });
});
