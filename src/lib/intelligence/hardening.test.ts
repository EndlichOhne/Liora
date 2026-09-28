import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyUtterance, emptyContext } from "./core.ts";
import {
  assignProvenance,
  blindAnalysis,
  buildEvidenceChain,
  countPresence,
  datasetPhrase,
  edgeStatement,
  extractFeatures,
  forbiddenLinkClaim,
  independentOrigins,
  linksFromFeatures,
  matchTexts,
  missingLabels,
  reanalysis,
  searchPipeline,
  versionChange,
} from "./hardening.ts";

describe("case intelligence hardening", () => {
  it("keeps the whole follow-up chain, including the vehicle and Germany", () => {
    const first = applyUtterance(emptyContext(), "Untersuche den Fall Karlsruhe-2024.");
    const second = applyUtterance(first.state, "Such noch nach dem Fahrzeug.");
    const third = applyUtterance(second.state, "Jetzt ganz Deutschland.");
    assert.equal(third.state.activeCase, "Karlsruhe-2024");
    assert.equal(third.state.activeTopic, "vehicle");
    assert.equal(third.state.activeGeography, "de");
    assert.equal(third.state.recentTurns.length, 3);
    assert.match(third.state.recentTurns[1].text, /Fahrzeug/);
  });

  it("does not treat spelling, paraphrase, extra model or a darker color as the same fact", () => {
    assert.equal(matchTexts("schwarzer BMW", "schwarzer BMW").level, "EXACT");
    assert.equal(matchTexts("Schwarzer BMW", "schwarzer bmw").level, "NORMALIZED");
    const semantic = matchTexts("schwarzer BMW", "BMW in schwarzer Farbe");
    assert.equal(semantic.level, "SEMANTIC");
    assert.equal(semantic.identical, false);
    assert.equal(semantic.mayStoreAsFact, false);
    assert.equal(matchTexts("schwarzer BMW", "schwarzer BMW 3er").level, "POSSIBLE");
    assert.equal(matchTexts("schwarzer BMW", "dunkler BMW").level, "POSSIBLE");
    assert.equal(matchTexts("Apfel", "Hausdach").level, "UNKNOWN");
    assert.equal(extractFeatures("schwarzer BMW", "").every((row) => row.storable === false), true);
    assert.equal(extractFeatures("schwarzer BMW", "src-1").some((row) => row.feature === "vehicle.make" && row.storable), true);
  });

  it("keeps a semantic hit out of the fact store and counts copies as one origin", () => {
    const steps = searchPipeline("schwarzer BMW", [
      { id: "1", text: "schwarzer BMW" },
      { id: "2", text: "BMW in schwarzer Farbe" },
    ]);
    assert.equal(steps.flatMap((step) => step.hits).every((hit) => hit.mayStoreAsFact === false), true);
    const sources = assignProvenance([
      { id: "a", url: "https://polizei.example/pm/2024/1", title: "Polizeimeldung", kind: "official", note: "" },
      { id: "b", url: "https://zeitung.example/a", title: "Bericht", kind: "reported", note: "laut Polizei https://polizei.example/pm/2024/1" },
      { id: "c", url: "https://blog.example/c", title: "Blog", kind: "reported", note: "übernimmt https://polizei.example/pm/2024/1" },
      { id: "d", url: "https://andere.example/d", title: "Weiterer Bericht", kind: "reported", note: "zitiert /pm/2024/1" },
    ]);
    assert.equal(independentOrigins(sources), 1);
    assert.equal(sources.filter((row) => row.sourceRelationship === "ORIGINAL").length, 1);
    assert.equal(sources.find((row) => row.id === "c")?.independenceStatus, "copied");
  });

  it("states n of n only for a named dataset and names missing data", () => {
    assert.equal(datasetPhrase(3, { size: 47, name: "Auswertung" }), "3 von 47 aktuell ausgewerteten Fällen");
    assert.equal(datasetPhrase(3, null), "NICHT VERFÜGBAR");
    assert.equal(datasetPhrase(3, { size: 47, name: "Auswertung" }).includes("häufig"), false);
    assert.deepEqual(missingLabels({ date: false, location: false, sourceCount: 1, vehicleMentioned: true, vehicleModel: false, originalKnown: false }), [
      "DATE MISSING",
      "LOCATION MISSING",
      "SECOND SOURCE MISSING",
      "VEHICLE MODEL UNKNOWN",
      "ORIGINAL SOURCE UNKNOWN",
    ]);
    const chain = buildEvidenceChain({
      feature: "vehicle.color",
      matching: 3,
      datasetSize: 47,
      rows: [
        { caseId: "A", sourceId: "1", origin: "pm:1" },
        { caseId: "B", sourceId: "7", origin: "pm:2" },
        { caseId: "C", sourceId: "12", origin: "pm:3" },
      ],
    });
    assert.ok(!("error" in chain));
    if ("error" in chain) return;
    assert.match(chain.finding, /3 von 47/);
    assert.equal(chain.inputFacts.length, 3);
    assert.match(chain.alternativeExplanation, /zusammenhängen/);
  });

  it("does not mint a new conclusion from the same data, and a graph edge is not guilt", () => {
    const same = reanalysis({ beforeFingerprint: "fp", afterFingerprint: "fp", conclusion: "anders" });
    assert.equal(same.data, "NO NEW DATA");
    assert.equal(same.conclusion, "NO NEW CONCLUSION");
    const fresh = reanalysis({ beforeFingerprint: "fp", afterFingerprint: "fp2", conclusion: "neu" });
    assert.equal(fresh.data, "NEW DATA");
    assert.equal(fresh.conclusion, "neu");
    assert.equal(forbiddenLinkClaim("Person X ist der wahrscheinliche Täter"), true);
    assert.equal(forbiddenLinkClaim("Es existiert eine dokumentierte Beziehung."), false);
    assert.match(edgeStatement(), /keine Schuldzuweisung/);
    const links = linksFromFeatures([
      { caseId: "A", feature: "vehicle.make", normalizedValue: "bmw", sourceId: "s1" },
      { caseId: "A", feature: "vehicle.color", normalizedValue: "schwarz", sourceId: "s1" },
      { caseId: "B", feature: "vehicle.make", normalizedValue: "bmw", sourceId: "s2" },
      { caseId: "B", feature: "vehicle.color", normalizedValue: "weiss", sourceId: "s2" },
    ]);
    assert.equal(links.length, 1);
    assert.equal(links[0].storable, false);
    assert.ok(links[0].contradicting.includes("vehicle.color"));
    assert.match(links[0].note, /Schuldzuweisung/);
  });

  it("versions changes and keeps official hypotheses out of the early blind steps", () => {
    assert.equal(versionChange("", "neu"), "ADDED");
    assert.equal(versionChange("alt", ""), "REMOVED");
    assert.equal(versionChange("alt", "neu"), "CHANGED");
    assert.equal(versionChange("alt", "alt"), "CONFIRMED");
    assert.equal(versionChange("schwarz", "nicht schwarz"), "CONTRADICTED");
    const steps = blindAnalysis();
    assert.equal(steps.length, 5);
    assert.equal(steps.slice(0, 4).every((step) => step.comparesOfficialHypothesis === false), true);
    assert.equal(steps[4].comparesOfficialHypothesis, true);
    const presence = countPresence("schwarzer BMW", [
      { caseId: "A", value: "schwarzer BMW" },
      { caseId: "B", value: "BMW in schwarzer Farbe" },
      { caseId: "C", value: "Haus" },
    ]);
    assert.equal(presence.present, 1);
    assert.equal(presence.semanticOnly, 1);
    assert.equal(presence.analyzed, 3);
  });
});
