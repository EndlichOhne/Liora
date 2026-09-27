import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changePolicy,
  compareMeasurements,
  detectGap,
  evaluateAnswer,
  findDuplicate,
  parseFeedback,
  routeTask,
  runBenchmarks,
} from "./engine.ts";

describe("intelligence engine", () => {
  it("routes a definition fast and a long comparison deep", () => {
    const fast = routeTask("Was bedeutet dieses Wort?");
    assert.equal(fast.mode, "fast");
    assert.equal(fast.tier, "simple");
    const deep = routeTask("Analysiere dieses 200-seitige Dokument und vergleiche es mit drei anderen Quellen.");
    assert.equal(deep.mode, "deep");
    assert.equal(deep.tier, "extreme");
  });

  it("does not store a duplicate as new knowledge", () => {
    const hit = findDuplicate("Die Hauptstadt von Frankreich ist Paris.", [
      { id: "a", statement: "Die Hauptstadt von Frankreich ist Paris.", status: "current" },
    ]);
    assert.equal(hit?.id, "a");
  });

  it("treats an explicit preference separately from a dispute", () => {
    assert.equal(parseFeedback("Mach das zukünftig immer so.")?.kind, "preference");
    assert.equal(parseFeedback("Das stimmt nicht.")?.kind, "dispute");
    assert.equal(parseFeedback("Das war falsch, richtig ist 12.")?.kind, "correction");
  });

  it("flags an unsupported number and a research answer without sources", () => {
    const flags = evaluateAnswer({
      answer: "Es waren 48 Fälle und das ist immer so.",
      userText: "Wie viele?",
      citations: [],
      mode: "research",
      conflicted: [],
    });
    assert.ok(flags.some((flag) => flag.code === "ohne_quelle"));
    assert.ok(flags.some((flag) => flag.code === "zahl_ohne_beleg"));
  });

  it("refuses to promote a failing candidate", () => {
    const result = compareMeasurements({ passed: true, latencyMs: 100 }, { passed: false, latencyMs: 50 });
    assert.notEqual(result.winner, "b");
    assert.equal(changePolicy("security").mutatesProduction, false);
  });

  it("opens a gap instead of inventing a fact", () => {
    const gap = detectGap("Bitte den aktuellen Stand der europäischen Fusionsforschung ausführlich erklären.", []);
    assert.equal(gap.open, true);
    assert.match(gap.missing, /nicht mit einer Vermutung/);
  });

  it("passes its own fixed checks", () => {
    const results = runBenchmarks();
    const failed = results.filter((item) => !item.pass);
    assert.deepEqual(
      failed.map((item) => item.id),
      [],
    );
  });
});
