import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, Panel, inputClass } from "@/components/ui";
import { EVIDENCE_LABEL, REGION_LABEL, isEvidence, isRegion } from "@/lib/cases/engine";
import { formatWhen } from "@/lib/domain";
import { addPersonCase, addPersonLink, loadPerson, reviewPersonFile } from "@/lib/people/functions";
import { startResearch } from "@/lib/research/functions";
import {
  CASE_RELATIONS,
  CONFLICT_NOTE,
  LINK_NOTE,
  PEOPLE_STATUS_LABEL,
  RELATION_LABEL,
  ROLE_LABEL,
  SOURCE_RELATIONS,
  VERIFIED_MEANS,
  isCaseRelation,
  isPeopleRole,
  isPeopleStatus,
  isSourceRelation,
  type CaseRelation,
  type SourceRelation,
} from "@/lib/people/rules";

export const Route = createFileRoute("/people/$id")({ component: PersonRoute });

type File = NonNullable<Awaited<ReturnType<typeof loadPerson>>>;
const PUBLIC_EVIDENCE = ["official", "court", "documented", "reported"] as const;

const SOURCE_RELATION_LABEL: Record<SourceRelation, string> = {
  identifies: "Benennt die Person",
  supports_role: "Trägt die Rolle",
  mentions: "Erwähnt die Person",
};

function evidenceLine(value: string) {
  return isEvidence(value) ? `${value} · ${EVIDENCE_LABEL[value]}` : value;
}

function originLine(value: string) {
  if (value === "independent") return "Originalquelle";
  if (value === "copied" || value === "derived") return "Sekundärquelle";
  return "Unbekannt, ob Original oder Sekundärquelle";
}

function PersonRoute() {
  const { id } = Route.useParams();
  return <PersonPage id={id} />;
}

function PersonPage({ id }: { id: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState(false);

  function load() {
    return loadPerson({ data: { id } })
      .then((next) => {
        setFile(next);
        if (!next) setError("Person nicht gefunden.");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Akte konnte nicht geladen werden."));
  }

  useEffect(() => {
    let cancelled = false;
    void loadPerson({ data: { id } })
      .then((next) => {
        if (cancelled) return;
        setFile(next);
        if (!next) setError("Person nicht gefunden.");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Die Akte konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!file) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-6 text-sm">
        <p>{error || "Wird geladen"}</p>
        <Link to="/people" className="mt-3 inline-flex min-h-11 items-center underline">Alle Personen</Link>
      </div>
    );
  }

  const person = file.person;
  const role = isPeopleRole(person.role) ? ROLE_LABEL[person.role] : person.role;
  const status = isPeopleStatus(person.status) ? PEOPLE_STATUS_LABEL[person.status] : person.status;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker={status}
        title={person.displayName}
        action={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void reviewPersonFile({ data: { id, outdated: true } })
                  .then((res) => {
                    setNote(res.note);
                    return load();
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Markierung ist fehlgeschlagen."))
                  .finally(() => setBusy(false));
              }}
            >
              Veraltet
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void reviewPersonFile({ data: { id, outdated: false } })
                  .then((res) => {
                    setNote(res.note);
                    return load();
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Prüfung ist fehlgeschlagen."))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Prüft" : "Quellen geprüft"}
            </Button>
          </div>
        }
      />
      <PageBody wide>
        <p className="text-sm text-muted">
          <Link to="/people" className="underline">Alle Personen</Link>
          {" · "}
          {role}
          {person.region && isRegion(person.region) ? ` · ${REGION_LABEL[person.region]}` : " · REGION MISSING"}
        </p>
        {person.aliases.length ? <p className="mt-2 text-sm">Weitere Schreibweisen: {person.aliases.join(", ")}</p> : null}
        <section>
          <h2 className="font-display text-2xl tracking-tight">Übersicht</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed">{person.summary || "Keine Zusammenfassung gespeichert."}</p>
        {person.missing.length ? <p className="mt-2 text-xs text-muted">{person.missing.join(" · ")}</p> : null}
        <p className="mt-2 text-sm">Geburtsjahr: {person.birthYear ?? "BIRTH YEAR MISSING"}</p>
        <p className="mt-1 text-sm text-muted">
          Letzte Verifizierung: {person.lastVerifiedAt ? formatWhen(person.lastVerifiedAt) : "noch keine"}
        </p>
        {file.duplicates.length ? (
          <ul className="mt-3 grid gap-2">
            {file.duplicates.map((item) => (
              <li key={item.id} className="text-sm">
                POSSIBLE DUPLICATE · <Link to="/people/$id" params={{ id: item.otherId }} className="underline">{item.name}</Link>
                <span className="text-muted"> · {item.reason}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {note ? <p className="mt-3 text-sm">{note}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Zugeordnete Fälle</h2>
          <p className="mt-1 text-sm">{file.casePhrase}</p>
          {file.cases.length === 0 ? <div className="mt-3"><Empty title="Kein Fall" body="Eine Beziehung wird nur mit einer bereits gespeicherten Quelle angelegt." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.cases.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <Link to="/cases/$id" params={{ id: item.caseId }} className="underline">{item.code ? `${item.code} · ` : ""}{item.title}</Link>
                <p className="text-muted">Fall-ID {item.caseId}</p>
                <p className="text-muted">Ort: {item.place || item.city || "CITY MISSING"} · Datum: {item.openedOn || "DATE MISSING"} · {item.caseType || "Falltyp fehlt"}</p>
                <p className="text-muted">{isCaseRelation(item.relation) ? RELATION_LABEL[item.relation] : item.relation} · {item.relation}</p>
                <p className="text-muted">{evidenceLine(item.evidence)}</p>
                {item.sourceUrl ? <a className="mt-1 block truncate underline" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a> : <p className="text-muted">Quelle fehlt</p>}
                <p className="text-xs text-muted">Letzte Prüfung der Quelle: {item.checkedAt ? formatWhen(item.checkedAt) : "noch keine"} · Akte {item.updatedAt ? formatWhen(item.updatedAt) : "DATE MISSING"}</p>
              </li>
            ))}
          </ul>
          <CaseForm
            options={file.caseOptions}
            sources={file.sources}
            onSubmit={(data) => {
              setError("");
              void addPersonCase({ data: { personId: id, ...data } })
                .then(() => load())
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Der Fall wurde nicht verknüpft."));
            }}
          />
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Quellen</h2>
          {file.sources.length === 0 ? <div className="mt-3"><Empty title="Keine Quelle" body="Ohne Quelle bleibt die Person unbelegt." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.sources.map((source) => (
              <li key={source.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p>{source.title || "Ohne Titel"}</p>
                <p className="text-muted">{source.publisher || "Publisher fehlt"} · {source.kind}</p>
                <p className="text-muted">Source-ID {source.sourceId}</p>
                <p className="text-muted">Veröffentlicht: {source.publishedAt || "DATE MISSING"} · Abgerufen: {source.checkedAt ? formatWhen(source.checkedAt) : "DATE MISSING"}</p>
                <p className="text-muted">{isSourceRelation(source.relation) ? SOURCE_RELATION_LABEL[source.relation] : source.relation} · {evidenceLine(source.evidence)}</p>
                <p className="text-muted">{originLine(source.independence)} · {status}</p>
                {source.evidence === "reported" ? <p className="text-muted">Ein Medienbericht ist kein offizieller Fakt.</p> : null}
                {source.url ? <a className="mt-1 block truncate underline" href={source.url} target="_blank" rel="noreferrer">{source.url}</a> : <p className="mt-1 text-muted">Keine URL</p>}
              </li>
            ))}
          </ul>
          <SourceForm
            onSubmit={(data) => {
              setError("");
              void addPersonLink({ data: { personId: id, ...data } })
                .then(() => load())
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Quelle wurde nicht gespeichert."));
            }}
          />
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Timeline</h2>
          {file.timeline.length === 0 ? <div className="mt-3"><Empty title="Keine Timeline" body="Ohne belegtes Datum steht DATE MISSING. Es wird keins geraten." /></div> : null}
          <ol className="mt-3 grid gap-2">
            {file.timeline.map((point) => (
              <li key={point.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p className="font-mono text-xs text-muted">{point.at === "DATE MISSING" ? "DATE MISSING" : point.at} · {point.label}</p>
                <p className="mt-1">{point.detail}</p>
                <p className="mt-1 text-muted">{evidenceLine(point.evidence)} · {point.confidence} · Quelle {point.sourceId || "fehlt"}{point.caseId ? ` · Fall ${point.caseId}` : ""}</p>
                <p className="text-xs text-muted">Gespeichert {point.createdAt ? formatWhen(point.createdAt) : "DATE MISSING"} · Geändert {point.updatedAt ? formatWhen(point.updatedAt) : "DATE MISSING"}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Dokumente</h2>
          {file.documents.length === 0 ? <div className="mt-3"><Empty title="Kein Dokument" body="Dokumente sind die gespeicherten Quellen-URLs. Es wird keins erfunden." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.documents.map((source) => (
              <li key={source.id} className="text-sm">
                <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Beziehungen</h2>
          <p className="mt-1 text-sm text-muted">{LINK_NOTE}</p>
          {file.links.length === 0 ? <div className="mt-3"><Empty title="Keine Beziehung" body="Eine Verbindung wird nur gezeigt, wenn sie gespeichert ist." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.links.map((link) => (
              <li key={`${link.kind}-${link.id}-${link.relation}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p>Person → {link.kind} · {link.label}</p>
                <p className="text-muted">{link.relation} · {evidenceLine(link.evidence)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Recherche</h2>
          <p className="mt-1 text-sm text-muted">Die Anfrage legt keine Person an. Websuche bleibt aus, bis sie eingeschaltet wird.</p>
          {file.hints.length === 0 ? <p className="mt-2 text-sm text-muted">Keine ungeprüfte Namensnennung.</p> : null}
          <ul className="mt-3 grid gap-2">
            {file.hints.map((hint) => (
              <li key={hint.id} className="text-sm">
                {hint.note}
                <span className="block text-muted">{hint.title || hint.url} · {hint.status}</span>
              </li>
            ))}
          </ul>
          <form
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              void startResearch({ data: { request: `Recherchiere Person ${person.displayName}`, web, caseId: "" } })
                .then((res) => setNote(res.summary))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Recherche wurde nicht gestartet."));
            }}
          >
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
              Websuche für diese Anfrage
            </label>
            <Button type="submit" className="mt-2">Recherchiere Person</Button>
          </form>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Verifizierung</h2>
          <p className="mt-1 text-sm">{status}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{file.verifiedMeans || VERIFIED_MEANS}</p>
          {file.conflicts.length ? <p className="mt-2 text-sm">{CONFLICT_NOTE}</p> : null}
          <ul className="mt-3 grid gap-2">
            {file.conflicts.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                CONFLICT · {item.field}
                <p>Quelle {item.leftSourceId} → {item.left}</p>
                <p>Quelle {item.rightSourceId} → {item.right}</p>
              </li>
            ))}
          </ul>
          {file.claims.length ? (
            <ul className="mt-3 grid gap-1">
              {file.claims.map((claim) => (
                <li key={claim.id} className="text-sm text-muted">{claim.field}: {claim.value} · {evidenceLine(claim.evidence)} · {claim.sourceId}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Änderungsverlauf</h2>
          {file.changes.length === 0 ? <div className="mt-3"><Empty title="Keine Änderung" body="Gespeicherte Aktionen erscheinen hier." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.changes.map((change) => (
              <li key={change.id} className="text-sm">
                {change.action} · {change.createdAt ? formatWhen(change.createdAt) : "DATE MISSING"}
                <span className="block text-muted">{change.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </PageBody>
    </div>
  );
}

function SourceForm({ onSubmit }: { onSubmit: (data: { title: string; sourceUrl: string; relation: SourceRelation; evidence: (typeof PUBLIC_EVIDENCE)[number] }) => void }) {
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [relation, setRelation] = useState<SourceRelation>("mentions");
  const [evidence, setEvidence] = useState<(typeof PUBLIC_EVIDENCE)[number]>("reported");
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ title, sourceUrl, relation, evidence });
        setTitle("");
        setSourceUrl("");
      }}
    >
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titel der Quelle"><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="URL"><input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" required /></Field>
          <Field label="Beziehung">
            <select className={inputClass} value={relation} onChange={(event) => { if (isSourceRelation(event.target.value)) setRelation(event.target.value); }}>
              {SOURCE_RELATIONS.map((key) => <option key={key} value={key}>{SOURCE_RELATION_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Klasse">
            <select className={inputClass} value={evidence} onChange={(event) => { const next = event.target.value; if (next === "official" || next === "court" || next === "documented" || next === "reported") setEvidence(next); }}>
              {PUBLIC_EVIDENCE.map((key) => <option key={key} value={key}>{EVIDENCE_LABEL[key]}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-3"><Button type="submit">Quelle speichern</Button></div>
      </Panel>
    </form>
  );
}

function CaseForm({
  options,
  sources,
  onSubmit,
}: {
  options: { id: string; title: string; code: string }[];
  sources: { sourceId: string; title: string; url: string }[];
  onSubmit: (data: { caseId: string; relation: CaseRelation; evidence: (typeof PUBLIC_EVIDENCE)[number]; sourceId: string }) => void;
}) {
  const [caseId, setCaseId] = useState(options[0]?.id ?? "");
  const [relation, setRelation] = useState<CaseRelation>("named_in");
  const [evidence, setEvidence] = useState<(typeof PUBLIC_EVIDENCE)[number]>("reported");
  const [sourceId, setSourceId] = useState(sources[0]?.sourceId ?? "");
  if (!options.length || !sources.length) {
    return <p className="mt-3 text-sm text-muted">{options.length ? "Zuerst eine Quelle speichern." : "Zuerst eine Akte unter Fälle anlegen."}</p>;
  }
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ caseId, relation, evidence, sourceId });
      }}
    >
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fall">
            <select className={inputClass} value={caseId} onChange={(event) => setCaseId(event.target.value)}>
              {options.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.title}</option>)}
            </select>
          </Field>
          <Field label="Quelle">
            <select className={inputClass} value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              {sources.map((item) => <option key={item.sourceId} value={item.sourceId}>{item.title || item.url}</option>)}
            </select>
          </Field>
          <Field label="Beziehung">
            <select className={inputClass} value={relation} onChange={(event) => { if (isCaseRelation(event.target.value)) setRelation(event.target.value); }}>
              {CASE_RELATIONS.map((key) => <option key={key} value={key}>{RELATION_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Klasse">
            <select className={inputClass} value={evidence} onChange={(event) => { const next = event.target.value; if (next === "official" || next === "court" || next === "documented" || next === "reported") setEvidence(next); }}>
              {PUBLIC_EVIDENCE.map((key) => <option key={key} value={key}>{EVIDENCE_LABEL[key]}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-3"><Button type="submit">Fall verknüpfen</Button></div>
      </Panel>
    </form>
  );
}
