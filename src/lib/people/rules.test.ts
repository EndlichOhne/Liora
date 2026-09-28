import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONVICTED_ONLY,
  NEEDS_SOURCE,
  NOT_A_PATTERN,
  NOT_DOCUMENTED,
  NOT_VERIFIED,
  NO_EVALUATION,
  OTHER_ACCOUNT,
  RELATION_NEEDS_SOURCE,
  SAME_NAME,
  WANTED_ONLY,
  draftPerson,
  findMerge,
  linkCase,
  linkSource,
  missingNotes,
  normalizeName,
  reviewPerson,
  sameNameNotice,
  visibleTo,
  type KnownPerson,
} from "./rules.ts";

const known = (patch: Partial<KnownPerson> = {}): KnownPerson => ({
  userId: "user-a",
  id: "person-1",
  displayName: "Max Mustermann",
  normalizedName: "max mustermann",
  birthYear: 1970,
  nationality: null,
  region: null,
  sourceUrls: ["https://www.bundesgerichtshof.de/urteil/1"],
  ...patch,
});

describe("person files", () => {
  it("creates a person only from a public source and keeps it under review", () => {
    const created = draftPerson({
      displayName: "Ada Beispiel",
      aliases: [],
      role: "publicly_named",
      birthYear: null,
      nationality: null,
      region: "karlsruhe",
      summary: "In einer Pressemitteilung genannt.",
      sourceUrl: "https://ppkarlsruhe.polizei-bw.de/meldung/1",
      evidence: "official",
      sourceRelation: "identifies",
      origin: "public_source",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.draft.status, "needs_review");
    assert.equal(created.draft.role, "publicly_named");
    assert.equal(created.draft.evidence, "official");
    assert.equal(created.draft.region, "karlsruhe");
    assert.deepEqual(created.draft.missing, ["BIRTH YEAR MISSING", "NATIONALITY MISSING"]);
    const empty = draftPerson({
      displayName: "Ada Beispiel",
      aliases: [],
      role: "publicly_named",
      birthYear: null,
      nationality: null,
      region: null,
      summary: "",
      sourceUrl: "",
      evidence: "reported",
      sourceRelation: "identifies",
      origin: "public_source",
    });
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.equal(empty.error, NEEDS_SOURCE);
  });

  it("normalizes spacing and case without treating a different name as the same", () => {
    assert.equal(normalizeName("Max Mustermann"), normalizeName("Max Mustermann "));
    assert.equal(normalizeName("MAX MUSTERMANN"), normalizeName("Max   Mustermann"));
    assert.notEqual(normalizeName("Max M. Mustermann"), normalizeName("Max Mustermann"));
    assert.notEqual(normalizeName("Max Mustermann"), normalizeName("Erika Mustermann"));
  });

  it("merges only the same name plus another matching feature, and only inside one account", () => {
    const incoming = {
      userId: "user-a",
      displayName: "MAX MUSTERMANN",
      birthYear: 1970,
      nationality: null,
      region: null,
      sourceUrl: "https://example.test/andere",
    };
    assert.equal(findMerge("user-a", incoming, [known()])?.reason, "gleiches Geburtsjahr");
    assert.equal(findMerge("user-a", { ...incoming, birthYear: null }, [known()]), null);
    assert.equal(findMerge("user-a", { ...incoming, birthYear: 1981 }, [known()]), null);
    assert.equal(
      findMerge("user-a", { ...incoming, displayName: "Max M. Mustermann", birthYear: 1970 }, [known()]),
      null,
    );
    assert.equal(findMerge("user-a", incoming, [known({ userId: "user-b" })]), null);
    assert.equal(findMerge("user-b", { ...incoming, userId: "user-b" }, [known()]), null);
    const notice = sameNameNotice("user-a", { userId: "user-a", displayName: "max mustermann" }, [known({ birthYear: null, sourceUrls: [] })], false);
    assert.equal(notice, SAME_NAME);
    assert.equal(sameNameNotice("user-a", { userId: "user-a", displayName: "max mustermann" }, [known()], true), "");
  });

  it("links a person to a case only with a source and the fitting evidence class", () => {
    const ok = linkCase({
      actorId: "user-a",
      personOwnerId: "user-a",
      caseOwnerId: "user-a",
      sourceOwnerId: "user-a",
      sourceId: "source-1",
      relation: "named_in",
      evidence: "reported",
    });
    assert.equal(ok.ok, true);
    const noSource = linkCase({
      actorId: "user-a",
      personOwnerId: "user-a",
      caseOwnerId: "user-a",
      sourceOwnerId: "user-a",
      sourceId: " ",
      relation: "mentioned_in",
      evidence: "reported",
    });
    assert.equal(noSource.ok, false);
    if (noSource.ok) return;
    assert.equal(noSource.error, RELATION_NEEDS_SOURCE);
    const convicted = linkCase({
      actorId: "user-a",
      personOwnerId: "user-a",
      caseOwnerId: "user-a",
      sourceOwnerId: "user-a",
      sourceId: "source-1",
      relation: "convicted_in",
      evidence: "official",
    });
    assert.equal(convicted.ok, false);
    if (convicted.ok) return;
    assert.equal(convicted.error, CONVICTED_ONLY);
  });

  it("keeps a media source from becoming an official person fact", () => {
    const media = linkSource({
      actorId: "user-a",
      personOwnerId: "user-a",
      sourceOwnerId: "user-a",
      sourceId: "source-1",
      relation: "mentions",
      evidence: "reported",
    });
    assert.equal(media.ok, true);
    if (!media.ok) return;
    assert.equal(media.evidence, "reported");
    const review = reviewPerson("user-a", "user-a", [{ evidence: "reported", ownerId: "user-a" }]);
    assert.equal(review.ok, true);
    if (!review.ok) return;
    assert.equal(review.status, "needs_review");
    assert.equal(review.note, NOT_VERIFIED);
    const strong = reviewPerson("user-a", "user-a", [{ evidence: "documented", ownerId: "user-a" }]);
    assert.equal(strong.ok, true);
    if (!strong.ok) return;
    assert.equal(strong.status, "verified_public");
  });

  it("refuses a pattern, a conviction without a court, and an evaluation", () => {
    const pattern = draftPerson({
      displayName: "Ada Beispiel",
      aliases: [],
      role: "convicted",
      birthYear: null,
      nationality: null,
      region: null,
      summary: "",
      sourceUrl: "https://www.justiz.baden-wuerttemberg.de/urteil/1",
      evidence: "court",
      sourceRelation: "supports_role",
      origin: "pattern",
    });
    assert.equal(pattern.ok, false);
    if (pattern.ok) return;
    assert.equal(pattern.error, NOT_A_PATTERN);
    const reported = draftPerson({
      displayName: "Ada Beispiel",
      aliases: [],
      role: "convicted",
      birthYear: null,
      nationality: null,
      region: null,
      summary: "Das Urteil liegt vor.",
      sourceUrl: "https://www.justiz.baden-wuerttemberg.de/urteil/1",
      evidence: "reported",
      sourceRelation: "supports_role",
      origin: "public_source",
    });
    assert.equal(reported.ok, false);
    if (reported.ok) return;
    assert.equal(reported.error, CONVICTED_ONLY);
    const wanted = draftPerson({
      displayName: "Ada Beispiel",
      aliases: [],
      role: "wanted_public",
      birthYear: null,
      nationality: null,
      region: null,
      summary: "Eine Zeitung berichtet.",
      sourceUrl: "https://www.swr.de/nachrichten/1",
      evidence: "reported",
      sourceRelation: "supports_role",
      origin: "public_source",
    });
    assert.equal(wanted.ok, false);
    if (wanted.ok) return;
    assert.equal(wanted.error, WANTED_ONLY);
    const insult = draftPerson({
      displayName: "Ada Beispiel",
      aliases: [],
      role: "publicly_named",
      birthYear: null,
      nationality: null,
      region: null,
      summary: "Die Quelle nennt die Person gefährlich.",
      sourceUrl: "https://www.swr.de/nachrichten/1",
      evidence: "reported",
      sourceRelation: "mentions",
      origin: "public_source",
    });
    assert.equal(insult.ok, false);
    if (insult.ok) return;
    assert.equal(insult.error, NO_EVALUATION);
    const alleged = linkCase({
      actorId: "user-a",
      personOwnerId: "user-a",
      caseOwnerId: "user-a",
      sourceOwnerId: "user-a",
      sourceId: "source-1",
      relation: "mentioned_in",
      evidence: "alleged",
    });
    assert.equal(alleged.ok, false);
    if (alleged.ok) return;
    assert.equal(alleged.error, NOT_DOCUMENTED);
  });

  it("labels missing fields and does not invent them", () => {
    assert.deepEqual(missingNotes({ birthYear: null, nationality: null, region: null }), [
      "BIRTH YEAR MISSING",
      "NATIONALITY MISSING",
      "REGION MISSING",
    ]);
    const created = draftPerson(
      {
        displayName: "Ada Beispiel",
        aliases: ["Ada B."],
        role: "historical",
        birthYear: 1890,
        nationality: "deutsch",
        region: null,
        summary: "",
        sourceUrl: "https://www.deutsche-digitale-bibliothek.de/item/1",
        evidence: "documented",
        sourceRelation: "identifies",
        origin: "public_source",
      },
      2026,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.draft.birthYear, 1890);
    assert.deepEqual(created.draft.missing, ["REGION MISSING"]);
    assert.equal(created.draft.status, "needs_review");
  });

  it("refuses another account when linking a source or a case", () => {
    const source = linkSource({
      actorId: "user-a",
      personOwnerId: "user-a",
      sourceOwnerId: "user-b",
      sourceId: "source-1",
      relation: "identifies",
      evidence: "official",
    });
    assert.equal(source.ok, false);
    if (source.ok) return;
    assert.equal(source.error, OTHER_ACCOUNT);
    const foreign = linkCase({
      actorId: "user-a",
      personOwnerId: "user-a",
      caseOwnerId: "user-b",
      sourceOwnerId: "user-a",
      sourceId: "source-1",
      relation: "named_in",
      evidence: "reported",
    });
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.equal(foreign.error, OTHER_ACCOUNT);
    const review = reviewPerson("user-a", "user-b", [{ evidence: "court", ownerId: "user-b" }]);
    assert.equal(review.ok, false);
  });

  it("shows one account only its own people", () => {
    const rows = visibleTo(
      [
        { userId: "user-a", id: "a1" },
        { userId: "user-b", id: "b1" },
        { userId: "user-a", id: "a2" },
      ],
      "user-a",
    );
    assert.deepEqual(rows.map((row) => row.id), ["a1", "a2"]);
    assert.deepEqual(visibleTo(rows, ""), []);
    assert.equal(findMerge("user-a", {
      userId: "user-a",
      displayName: "Max Mustermann",
      birthYear: 1970,
      nationality: null,
      region: null,
      sourceUrl: "",
    }, [known({ userId: "user-b", id: "foreign" })]), null);
  });
});
