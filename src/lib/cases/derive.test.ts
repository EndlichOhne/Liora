import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveDataset, explainInsight, easterSunday, germanHoliday, normalizeToken, placeRelation, rarityOf, relationEdges, timeGap } from "./derive.ts";

describe("stored-data calculations", () => {
  it("treats spelling variants as the same token without inventing a new fact", () => {
    assert.equal(normalizeToken("Blauer  Koffer"), normalizeToken("blauer-koffer"));
    assert.equal(normalizeToken("München"), normalizeToken("Muenchen"));
  });

  it("computes a time gap only from readable timestamps", () => {
    const gap = timeGap("2026-03-01T00:00:00.000Z", "2026-03-11T00:00:00.000Z");
    assert.equal(gap.days, 10);
    assert.match(gap.text, /10 Tage/);
    const missing = timeGap("unbekannt", "2026-03-11");
    assert.equal(missing.days, null);
    assert.match(missing.text, /INSUFFICIENT DATA/);
    assert.doesNotMatch(missing.text, /\d+ Tage/);
  });

  it("never invents kilometres", () => {
    const same = placeRelation({ city: "Karlsruhe", region: "karlsruhe" }, { city: "karlsruhe ", region: "karlsruhe" });
    assert.equal(same.kind, "same_place");
    assert.match(same.text, /keine Kilometer/);
    const far = placeRelation({ city: "Karlsruhe", region: "karlsruhe" }, { city: "Stuttgart", region: "stuttgart" });
    assert.equal(far.kind, "different");
    assert.match(far.text, /keine Koordinaten/);
    assert.doesNotMatch(`${same.text} ${far.text}`, /\bkm\b|Kilometerzahl|Entfernung: \d/i);
    const empty = placeRelation({ city: "", region: "karlsruhe" }, { city: "Rastatt", region: "rastatt" });
    assert.equal(empty.kind, "insufficient");
  });

  it("knows national holidays and refuses a rarity claim on a tiny set", () => {
    assert.equal(easterSunday(2026).toISOString().slice(0, 10), "2026-04-05");
    assert.equal(germanHoliday("2026-10-03"), "Tag der Deutschen Einheit");
    assert.equal(germanHoliday("2026-04-03"), "Karfreitag");
    assert.equal(germanHoliday("2026-01-06", "karlsruhe"), "Heilige Drei Könige");
    assert.equal(germanHoliday("2026-01-06", "de"), null);
    const small = rarityOf(2, 2);
    assert.equal(small.label, "insufficient");
    assert.match(small.text, /INSUFFICIENT DATA/);
    assert.match(small.text, /Keine Wahrscheinlichkeit/);
    assert.doesNotMatch(small.text, /\d+\s*%/);
    const rare = rarityOf(1, 8);
    assert.equal(rare.label, "rare_in_set");
    assert.match(rare.text, /1 von 8/);
  });

  it("orders several timestamps, refuses kilometres, and labels a small combination", () => {
    const features = [
      { caseId: "a", caseTitle: "Akte A", key: "zeit", value: "2026-04-03", origin: "user_provided", sourceUrl: "" },
      { caseId: "b", caseTitle: "Akte B", key: "zeit", value: "2026-04-05T21:30:00.000Z", origin: "media_report", sourceUrl: "https://zeitung.example/b" },
      { caseId: "c", caseTitle: "Akte C", key: "zeit", value: "2026-04-08", origin: "public_archive", sourceUrl: "https://archiv.example/c" },
      { caseId: "a", caseTitle: "Akte A", key: "region", value: "karlsruhe", origin: "user_provided", sourceUrl: "" },
      { caseId: "a", caseTitle: "Akte A", key: "ort", value: "Karlsruhe", origin: "user_provided", sourceUrl: "" },
      { caseId: "b", caseTitle: "Akte B", key: "ort", value: "Stuttgart", origin: "user_provided", sourceUrl: "" },
      { caseId: "a", caseTitle: "Akte A", key: "merkmal", value: "blauer Koffer", origin: "media_report", sourceUrl: "https://zeitung.example/a" },
      { caseId: "b", caseTitle: "Akte B", key: "merkmal", value: "blauer-Koffer", origin: "public_archive", sourceUrl: "https://archiv.example/b" },
      { caseId: "c", caseTitle: "Akte C", key: "merkmal", value: "blauer Koffer", origin: "media_report", sourceUrl: "https://blatt.example/c" },
    ];
    const points = deriveDataset(features);
    assert.ok(points.some((point) => point.kind === "time_gap" && point.caseIds.length === 3 && /Reihenfolge/.test(point.value)));
    assert.ok(points.some((point) => point.kind === "holiday" && /Karfreitag/.test(point.value)));
    assert.equal(points.some((point) => point.kind === "holiday" && /Ostersonntag/.test(point.value)), false);
    const place = points.find((point) => point.kind === "place_relation");
    assert.match(place?.value ?? "", /keine Koordinaten|keine Kilometer/i);
    assert.doesNotMatch(points.map((point) => point.value).join(" "), /\bkm\b|\d+\s*%/);
    assert.ok(points.some((point) => point.kind === "spelling"));
    const explained = explainInsight(
      { caseIds: ["a", "b", "c"], sources: ["https://zeitung.example/a", "https://archiv.example/b", "https://blatt.example/c"], status: "open" },
      features,
      3,
    );
    assert.equal(explained.dataClass, "ai_derived");
    assert.match(explained.rarity, /INSUFFICIENT DATA/);
    assert.match(explained.marks, /Nicht genug Daten/);
    assert.match(explained.marks, /abgeleitet/);
    assert.doesNotMatch(explained.rarity, /\d+\s*%/);
    assert.ok(explained.unknown.some((line) => /Kilometern/.test(line)));
    const edges = relationEdges(features);
    assert.ok(edges.some((edge) => edge.relation === "Kette über mehrere Akten, nicht belegt" || edge.relation === "zeitliche Reihenfolge berechnet"));
    assert.equal(edges.some((edge) => /belegt$/.test(edge.relation) && !/nicht belegt/.test(edge.relation) && /Fallverbindung/.test(edge.relation)), false);
  });
});
