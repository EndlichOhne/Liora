import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlan,
  datasetCountLabel,
  detectScope,
  scopeFor,
  independentCount,
  isDuplicateRequest,
  isFollowUp,
  markIndependence,
  nextStatus,
  normalizeValue,
  openQuestions,
  priorityFor,
  reevaluateDecision,
  scanRequest,
  sessionFor,
  timelineFromEvents,
  type PriorTask,
} from "./engine.ts";

describe("research scanner", () => {
  it("builds a plan without inventing hits", () => {
    const plan = buildPlan("Untersuche diesen Fall in Karlsruhe", "karlsruhe", false, "case-1");
    assert.ok(plan.length >= 5);
    assert.equal(plan[0]?.name, "Fall im Bestand suchen");
    const web = plan.find((step) => step.name === "Öffentliche Suche");
    assert.equal(web?.status, "skipped");
    assert.match(web?.note ?? "", /nicht freigegeben/);
    assert.equal(plan.some((step) => /gefunden|Treffer \d/.test(step.note)), false);
  });

  it("extracts context and never stores a fact", () => {
    const items = scanRequest("Untersuche den Fall in Karlsruhe am 2026-04-03 um 22 Uhr 30. Person: Ada Klein. War ein Mercedes-Benz beteiligt?");
    assert.ok(items.some((item) => item.kind === "city" && item.normalizedValue === "karlsruhe"));
    assert.ok(items.some((item) => item.kind === "time" && item.normalizedValue === "22:30"));
    assert.ok(items.some((item) => item.kind === "vehicle" && item.normalizationMethod === "brand-fold"));
    assert.ok(items.some((item) => item.kind === "person" && item.status === "unknown"));
    assert.ok(items.some((item) => item.kind === "question"));
    assert.equal(items.some((item) => item.status === "fact"), false);
    assert.equal(scanRequest("Täter: Max Mustermann").some((item) => item.kind === "person"), false);
  });

  it("keeps a follow-up in the previous session", () => {
    const previous: PriorTask[] = [
      {
        id: "t1",
        sessionId: "s1",
        caseId: "c1",
        normalized: "untersuche fall x",
        status: "completed",
        updatedAt: "2026-04-03T10:00:00.000Z",
        scope: "karlsruhe",
      },
    ];
    assert.equal(isFollowUp("Such noch nach dem Fahrzeug"), true);
    assert.equal(sessionFor(previous, true, "c1"), "s1");
    assert.equal(sessionFor(previous, false, "c1"), null);
    assert.equal(detectScope("Jetzt ganz Deutschland"), "de");
    assert.equal(scopeFor("Such noch nach dem Fahrzeug", true, "karlsruhe"), "karlsruhe");
    assert.equal(scopeFor("Jetzt ganz Deutschland", true, "karlsruhe"), "de");
    assert.equal(isDuplicateRequest(previous, "untersuche fall x", true), false);
  });

  it("counts one origin when copies share a police wire", () => {
    const rows = markIndependence([
      { id: "a", url: "https://www.presseportal.de/blaulicht/pm/123/456", title: "Polizeimeldung" },
      { id: "b", url: "https://www.presseportal.de/blaulicht/pm/123/456", title: "Presseportal übernimmt Polizeimeldung", note: "übernimmt" },
      { id: "c", url: "https://zeitung.example/artikel", title: "Zeitung übernimmt dieselbe Meldung", note: "laut Polizei" },
    ]);
    assert.equal(rows[0]?.independenceStatus, "independent");
    assert.equal(rows[1]?.independenceStatus, "copied");
    assert.equal(rows[1]?.parentSourceId, "a");
    assert.equal(rows[2]?.independenceStatus, "derived");
    assert.equal(independentCount(rows), 1);
  });

  it("folds brand and clock spellings without merging different times", () => {
    const a = normalizeValue("Mercedes-Benz");
    const b = normalizeValue("Mercedes Benz.");
    assert.equal(a.normalizedValue, b.normalizedValue);
    assert.equal(a.normalizationMethod, "brand-fold");
    assert.equal(normalizeValue("22:30").normalizedValue, "22:30");
    assert.equal(normalizeValue("22.30 Uhr").normalizedValue, "22:30");
    assert.equal(normalizeValue("um 22 Uhr 30").normalizedValue, "22:30");
    assert.notEqual(normalizeValue("22:00").normalizedValue, normalizeValue("22:30").normalizedValue);
  });

  it("stores a denied vehicle as negative evidence", () => {
    const items = scanRequest("Fahrzeug ausdrücklich ausgeschlossen, kein Fahrzeug.");
    const vehicle = items.find((item) => item.kind === "vehicle");
    assert.equal(vehicle?.polarity, "negative");
    assert.equal(vehicle?.status, "claim");
    assert.notEqual(vehicle?.status, "fact");
  });

  it("labels missing timeline fields and does not invent a clock", () => {
    const rows = timelineFromEvents("c1", [
      { occurredOn: "2026-04-03", label: "Fund", detail: "", sourceUrl: "" },
    ]);
    assert.equal(rows[0]?.date, "2026-04-03");
    assert.equal(rows[0]?.time, "TIME MISSING");
    assert.equal(rows[0]?.location, "LOCATION MISSING");
    assert.equal(rows[0]?.sourceId, "SOURCE MISSING");
    const empty = timelineFromEvents("c1", [{ occurredOn: "", label: "", detail: "", sourceUrl: "" }]);
    assert.equal(empty[0]?.date, "DATE MISSING");
  });

  it("does not start a new insight version when the fingerprint is unchanged", () => {
    assert.equal(reevaluateDecision("abc", "abc"), "NO NEW DATA");
    assert.equal(reevaluateDecision("abc", "abd"), "neu bewertet");
    assert.equal(reevaluateDecision("", ""), "neu bewertet");
  });

  it("opens questions only from missing stored fields", () => {
    const questions = openQuestions({
      events: [{ occurredOn: "", label: "Fund", detail: "", sourceUrl: "", place: "" }],
      hasCourtSource: false,
      hasVehicle: false,
      askedVehicle: true,
      askedCourt: true,
      askedTime: true,
    });
    const text = questions.map((item) => item.question).join(" | ");
    assert.match(text, /DATE MISSING/);
    assert.match(text, /SOURCE MISSING/);
    assert.match(text, /TIME MISSING/);
    assert.match(text, /VEHICLE INFORMATION MISSING/);
    assert.match(text, /COURT SOURCE MISSING/);
    assert.match(text, /LOCATION MISSING/);
  });

  it("refuses a rare-feature count that was not measured", () => {
    assert.equal(datasetCountLabel(3, 47), "3 von 47 analysierten Fällen in diesem Bestand. Keine Aussage über alle deutschen Fälle.");
    assert.equal(datasetCountLabel(3, 0), "INSUFFICIENT DATA");
    assert.equal(datasetCountLabel(-1, 4), "INSUFFICIENT DATA");
  });

  it("treats the same completed request as a duplicate, not a follow-up", () => {
    const previous = [{ normalized: "untersuche diesen fall", status: "completed" }];
    assert.equal(isDuplicateRequest(previous, "untersuche diesen fall", false), true);
    assert.equal(isDuplicateRequest(previous, "untersuche diesen fall", true), false);
    assert.equal(isDuplicateRequest([{ normalized: "untersuche diesen fall", status: "failed" }], "untersuche diesen fall", false), false);
  });

  it("moves a task only along allowed statuses", () => {
    assert.equal(nextStatus("queued", "start"), "running");
    assert.equal(nextStatus("running", "finish"), "completed");
    assert.equal(nextStatus("running", "fail"), "failed");
    assert.equal(nextStatus("running", "pause"), "paused");
    assert.equal(nextStatus("paused", "resume"), "running");
    assert.equal(nextStatus("completed", "start"), "completed");
    assert.equal(priorityFor("Das eilt sofort"), "high");
  });
});
