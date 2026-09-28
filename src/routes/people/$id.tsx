import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, Panel, inputClass } from "@/components/ui";
import { EVIDENCE_LABEL, REGION_LABEL, isEvidence, isRegion } from "@/lib/cases/engine";
import { formatWhen } from "@/lib/domain";
import { addPersonCase, addPersonLink, loadPerson, reviewPersonFile } from "@/lib/people/functions";
import {
  CASE_RELATIONS,
  PEOPLE_STATUS_LABEL,
  RELATION_LABEL,
  ROLE_LABEL,
  SOURCE_RELATIONS,
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

function PersonRoute() {
  const { id } = Route.useParams();
  return <PersonPage id={id} />;
}

function PersonPage({ id }: { id: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

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
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void reviewPersonFile({ data: { id } })
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
        <p className="mt-3 max-w-2xl text-sm leading-relaxed">{person.summary || "Keine Zusammenfassung gespeichert."}</p>
        {person.missing.length ? <p className="mt-2 text-xs text-muted">{person.missing.join(" · ")}</p> : null}
        <p className="mt-2 text-sm text-muted">
          Letzte Überprüfung: {person.lastVerifiedAt ? formatWhen(person.lastVerifiedAt) : "noch keine"}
        </p>
        {note ? <p className="mt-3 text-sm">{note}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Quellen</h2>
          {file.sources.length === 0 ? <div className="mt-3"><Empty title="Keine Quelle" body="Ohne Quelle bleibt die Person unbelegt." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.sources.map((source) => (
              <li key={source.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p>{source.title || "Ohne Titel"}</p>
                <p className="text-muted">{isSourceRelation(source.relation) ? SOURCE_RELATION_LABEL[source.relation] : source.relation} · {isEvidence(source.evidence) ? EVIDENCE_LABEL[source.evidence] : source.evidence}</p>
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
          <h2 className="font-display text-2xl tracking-tight">Fälle</h2>
          {file.cases.length === 0 ? <div className="mt-3"><Empty title="Kein Fall" body="Eine Beziehung wird nur mit einer bereits gespeicherten Quelle angelegt." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.cases.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <Link to="/cases/$id" params={{ id: item.caseId }} className="underline">{item.code ? `${item.code} · ` : ""}{item.title}</Link>
                <p className="text-muted">{isCaseRelation(item.relation) ? RELATION_LABEL[item.relation] : item.relation} · {isEvidence(item.evidence) ? EVIDENCE_LABEL[item.evidence] : item.evidence}</p>
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

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl tracking-tight">Timeline</h2>
            {file.timeline.length === 0 ? <div className="mt-3"><Empty title="Keine datierte Timeline" body="Es gibt noch keinen gespeicherten Zeitpunkt." /></div> : null}
            <ol className="mt-3 grid gap-2">
              {file.timeline.map((point, index) => (
                <li key={`${point.label}-${index}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p className="font-mono text-xs text-muted">{point.at === "DATE MISSING" ? "DATE MISSING" : formatWhen(point.at)} · {point.label}</p>
                  <p className="mt-1">{point.detail}</p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="font-display text-2xl tracking-tight">Öffentliche Dokumente</h2>
            {file.documents.length === 0 ? <div className="mt-3"><Empty title="Kein Dokument" body="Dokumente sind die gespeicherten Quellen-URLs. Es wird keins erfunden." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {file.documents.map((source) => (
                <li key={source.id} className="text-sm">
                  <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
                </li>
              ))}
            </ul>
          </div>
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
