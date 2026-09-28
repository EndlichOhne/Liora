import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageBody, PageHead } from "@/components/app-frame";
import { DiscoveryPanel } from "@/components/discovery-panel";
import { Button, Empty, Field, Panel, TextArea, inputClass } from "@/components/ui";
import {
  CASE_STATUSES,
  CASE_TYPE_LABEL,
  EVIDENCE,
  EVIDENCE_LABEL,
  PERSON_LABEL,
  PERSON_ROLES,
  REGION_LABEL,
  STATUS_LABEL,
  isCaseStatus,
  isCaseType,
  isEvidence,
  isPersonRole,
  isRegion,
  personLine,
  type CaseStatus,
  type EvidenceClass,
  type PersonRole,
} from "@/lib/cases/engine";
import {
  addCaseEdge,
  addCaseEvent,
  addCaseHypothesis,
  addCaseItem,
  addCasePerson,
  archiveEntry,
  loadCase,
  reviewCase,
  saveCaseMeta,
} from "@/lib/cases/functions";
import { formatWhen } from "@/lib/domain";
import { loadResearch, startResearch } from "@/lib/research/functions";
import { RELATION_LABEL, isCaseRelation } from "@/lib/people/rules";

export const Route = createFileRoute("/cases/$id")({ component: CaseRoute });

type File = NonNullable<Awaited<ReturnType<typeof loadCase>>>;
type Form = "event" | "item" | "person" | "hypothesis" | "edge" | "meta" | null;

const ITEM_KINDS = [
  ["source", "Quelle"],
  ["evidence", "Beweismittel"],
  ["statement", "Öffentliche Aussage"],
  ["document", "Dokument"],
  ["question", "Offene Frage"],
  ["forensic", "Forensik, nur aus der Quelle"],
  ["update", "Neue Information"],
] as const;

const RELATIONS = ["Person", "Ereignis", "Ort", "Dokument", "Aussage", "Beleg", "Quelle", "Datum"];

function labelEvidence(value: string) {
  return isEvidence(value) ? EVIDENCE_LABEL[value] : "Unbekannt";
}

function CaseRoute() {
  const { id } = Route.useParams();
  return <CasePage id={id} />;
}

function CasePage({ id }: { id: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [form, setForm] = useState<Form>(null);
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState(false);
  const [researchId, setResearchId] = useState("");
  const [researchFile, setResearchFile] = useState<Awaited<ReturnType<typeof loadResearch>>>(null);

  function load() {
    return loadCase({ data: { id } })
      .then((next) => {
        setFile(next);
        if (!next) setError("Akte nicht gefunden.");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Akte konnte nicht geladen werden."));
  }

  useEffect(() => {
    void load();
  }, [id]);

  if (!file) {
    return (
      <div className="desk min-h-0 flex-1 overflow-y-auto p-6 text-sm">
        <p>{error || "Wird geladen"}</p>
        <Link to="/cases" className="mt-3 inline-flex min-h-11 items-center underline">Alle Fälle</Link>
      </div>
    );
  }

  const entry = file.case;
  const region = isRegion(entry.region) ? REGION_LABEL[entry.region] : entry.region;
  const kind = isCaseType(entry.caseType) ? CASE_TYPE_LABEL[entry.caseType] : entry.caseType;
  const status = isCaseStatus(entry.caseStatus) ? STATUS_LABEL[entry.caseStatus] : entry.caseStatus;

  return (
    <div className="desk min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker={entry.code}
        title={entry.title}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void reviewCase({ data: { id } })
                  .then((result) => {
                    setNote(result.note);
                    return load();
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Prüfung ist fehlgeschlagen."))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Prüft" : "Lokal prüfen"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void startResearch({
                  data: {
                    request: `Untersuche diesen Fall öffentlich: ${entry.title}. ${entry.city || region}.`,
                    web,
                    caseId: id,
                  },
                })
                  .then((result) => {
                    setNote(result.summary);
                    if (result.task) {
                      setResearchId(result.task.id);
                      return loadResearch({ data: { id: result.task.id } }).then(setResearchFile);
                    }
                    return undefined;
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Recherche ist fehlgeschlagen."))
                  .finally(() => setBusy(false));
              }}
            >
              Öffentlich recherchieren
            </Button>
          </div>
        }
      />
      <PageBody wide>
        <Link to="/cases" className="text-sm text-muted underline">Alle Fälle</Link>
        <p className="mt-3 text-sm text-muted">
          {region}
          {entry.stateName ? ` · ${entry.stateName}` : ""}
          {entry.district ? ` · ${entry.district}` : ""}
          {entry.city ? ` · ${entry.city}` : ""}
          {entry.place ? ` · ${entry.place}` : ""}
          {" · "}
          {kind}
          {" · "}
          {status}
          {entry.openedOn ? ` · ${entry.openedOn}` : ""}
        </p>
        <p className="mt-1 text-sm text-muted">Zuletzt geändert {formatWhen(entry.updatedAt)}. Alte Einträge bleiben erhalten und können historisch markiert werden.</p>
        {entry.abroadRelevant ? <p className="mt-2 text-sm">Ausländische Angaben sind nur markiert, weil sie zu diesem deutschen Fall gehören.</p> : null}
        {entry.authority ? <p className="mt-2 text-sm">Behörde: {entry.authority}</p> : null}
        {entry.courtName ? <p className="text-sm">Gericht: {entry.courtName}</p> : null}
        {entry.investigationStatus ? <p className="text-sm">Ermittlungsstand laut Quelle: {entry.investigationStatus}</p> : null}
        {entry.summary ? <p className="mt-3 max-w-3xl text-base leading-relaxed">{entry.summary}</p> : <p className="mt-3 text-sm text-muted">Keine Zusammenfassung.</p>}
        {note ? <p className="mt-3 max-w-3xl text-sm">{note}</p> : null}
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
          Websuche für „Öffentlich recherchieren“ erlauben
        </label>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {(["event", "item", "person", "hypothesis", "edge", "meta"] as const).map((key) => (
            <Button key={key} variant={form === key ? "primary" : "ghost"} onClick={() => setForm((current) => (current === key ? null : key))}>
              {key === "event" ? "Zeit" : key === "item" ? "Eintrag" : key === "person" ? "Person" : key === "hypothesis" ? "Hypothese" : key === "edge" ? "Beziehung" : "Akte"}
            </Button>
          ))}
        </div>

        {form === "event" ? <EventForm id={id} onDone={() => { setForm(null); return load(); }} onError={setError} /> : null}
        {form === "item" ? <ItemForm id={id} onDone={() => { setForm(null); return load(); }} onError={setError} /> : null}
        {form === "person" ? <PersonForm id={id} onDone={() => { setForm(null); return load(); }} onError={setError} /> : null}
        {form === "hypothesis" ? <HypothesisForm id={id} onDone={() => { setForm(null); return load(); }} onError={setError} /> : null}
        {form === "edge" ? <EdgeForm id={id} onDone={() => { setForm(null); return load(); }} onError={setError} /> : null}
        {form === "meta" ? <MetaForm file={file} onDone={() => { setForm(null); return load(); }} onError={setError} /> : null}

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Zeit</h2>
          {file.events.length === 0 ? <div className="mt-3"><Empty title="Keine Zeitpunkte" body="Jedes Ereignis braucht eine Quelle. Lücken werden nur aus vorhandenen Daten berechnet." /></div> : null}
          <ol className="mt-3 grid gap-2">
            {file.events.map((event) => (
              <li key={event.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="font-mono text-xs text-muted">{event.occurredOn || "ohne Datum"} · {labelEvidence(event.evidence)}{event.historical ? " · historisch" : " · aktuell"}</p>
                <p className="mt-1">{event.label}</p>
                {event.detail ? <p className="mt-1 text-sm text-muted">{event.detail}</p> : null}
                {event.sourceUrl ? <a className="mt-1 block truncate text-sm underline" href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceUrl}</a> : <p className="mt-1 text-sm text-muted">Keine Quellen-URL</p>}
                {event.historical ? null : (
                  <Button className="mt-2" variant="ghost" onClick={() => void archiveEntry({ data: { kind: "event", id: event.id } }).then(() => load())}>Historisch</Button>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Einträge</h2>
          <p className="mt-1 text-sm text-muted">Klassen bleiben getrennt. Ein Medienbericht ist kein unabhängiger Beleg.</p>
          {file.items.length === 0 ? <div className="mt-3"><Empty title="Keine Einträge" body="Belege, Aussagen und offene Fragen stehen hier, jeweils mit Klasse." /></div> : null}
          <div className="mt-3 grid gap-2">
            {file.items.map((item) => (
              <article key={item.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted">{item.kind} · {labelEvidence(item.evidence)}{item.historical ? " · historisch" : " · aktuell"}</p>
                <p className="mt-1 text-sm leading-relaxed">{item.body}</p>
                {item.sourceUrl ? <a className="mt-1 block truncate text-sm underline" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a> : <p className="mt-1 text-sm text-muted">Ohne URL bleibt das unbelegt.</p>}
                {item.historical ? null : (
                  <Button className="mt-2" variant="ghost" onClick={() => void archiveEntry({ data: { kind: "item", id: item.id } }).then(() => load())}>Historisch</Button>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl tracking-tight">Personen</h2>
            <p className="mt-1 text-sm text-muted">Genannt ist nicht verurteilt. Die Akte beschuldigt niemanden.</p>
            {file.people.length === 0 ? <div className="mt-3"><Empty title="Keine Person" body="Nur Namen aus einer öffentlichen Quelle. Verurteilt nur mit Gerichtsklasse." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {file.people.map((person) => (
                <li key={person.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  {person.personId ? (
                    <Link to="/people/$id" params={{ id: person.personId }} className="underline">{person.name}</Link>
                  ) : (
                    <p>{person.name}</p>
                  )}
                  <p className="text-muted">{isPersonRole(person.role) ? PERSON_LABEL[person.role] : person.role} · {labelEvidence(person.evidence)}</p>
                  {person.relation && isCaseRelation(person.relation) ? <p className="mt-1 text-muted">{person.relation} · {RELATION_LABEL[person.relation]}</p> : null}
                  <p className="mt-1 text-muted">{isPersonRole(person.role) ? personLine(person.role) : ""}</p>
                  {person.note ? <p className="mt-1">{person.note}</p> : null}
                  {person.sourceUrl ? <a className="mt-1 block truncate underline" href={person.sourceUrl} target="_blank" rel="noreferrer">{person.sourceUrl}</a> : null}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-2xl tracking-tight">Hypothesen</h2>
            <p className="mt-1 text-sm text-muted">Eine Hypothese ist keine Tatsache.</p>
            {file.hypotheses.length === 0 ? <div className="mt-3"><Empty title="Keine Hypothese" body="Stützendes, Widersprechendes, Unbekanntes und Alternativen bleiben getrennt." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {file.hypotheses.map((item) => (
                <li key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p>{item.title}</p>
                  {item.support ? <p className="mt-2"><span className="text-muted">Dafür. </span>{item.support}</p> : null}
                  {item.contradict ? <p className="mt-1"><span className="text-muted">Dagegen. </span>{item.contradict}</p> : null}
                  {item.unknown ? <p className="mt-1"><span className="text-muted">Unbekannt. </span>{item.unknown}</p> : null}
                  {item.alternatives ? <p className="mt-1"><span className="text-muted">Alternativen. </span>{item.alternatives}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl tracking-tight">Widersprüche</h2>
            {file.contradictions.length === 0 ? <div className="mt-3"><Empty title="Kein Widerspruch" body="Zu wenig Text bleibt zu wenig Text. Es wird keiner erfunden." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {file.contradictions.map((item) => (
                <li key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p className="text-xs text-muted">{item.kind}</p>
                  <p className="mt-1">{item.left}</p>
                  <p className="mt-1 text-muted">{item.right}</p>
                  {item.note ? <p className="mt-2 text-muted">{item.note}</p> : null}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-2xl tracking-tight">Beziehungen</h2>
            <p className="mt-1 text-sm text-muted">Ähnlichkeit und belegte Verbindung sind getrennt.</p>
            {file.edges.length === 0 ? <div className="mt-3"><Empty title="Keine Beziehung" body="Eine belegte Verbindung braucht eine Begründung aus der Quelle." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {file.edges.map((edge) => (
                <li key={edge.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p>{edge.from} → {edge.relation} → {edge.to}</p>
                  <p className="mt-1 text-muted">{edge.proven ? "Als belegt markiert, nur wegen der Notiz." : "Nicht als Zusammenhang belegt."}</p>
                  {edge.note ? <p className="mt-1">{edge.note}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <DiscoveryPanel caseId={id} />

        {researchFile ? (
          <section className="mt-6">
            <h2 className="font-display text-2xl tracking-tight">Recherche</h2>
            <p className="mt-1 text-sm text-muted">{researchFile.task.status} · {researchFile.task.scope} · {researchId}</p>
            {researchFile.task.resultSummary ? <p className="mt-2 text-sm">{researchFile.task.resultSummary}</p> : null}
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Panel>
                <h3 className="text-sm">Quellen</h3>
                {researchFile.sources.length === 0 ? <p className="mt-2 text-sm text-muted">Keine neue öffentliche Quelle.</p> : null}
                <ul className="mt-2 space-y-1 text-sm">
                  {researchFile.sources.map((source) => (
                    <li key={source.id}>{source.title || source.url} · {source.independenceStatus}</li>
                  ))}
                </ul>
              </Panel>
              <Panel>
                <h3 className="text-sm">Offene Fragen</h3>
                {researchFile.questions.length === 0 ? <p className="mt-2 text-sm text-muted">Keine offene Frage aus den gespeicherten Angaben.</p> : null}
                <ul className="mt-2 space-y-1 text-sm">
                  {researchFile.questions.map((item) => (
                    <li key={item.id}>{item.question} · {item.status}</li>
                  ))}
                </ul>
              </Panel>
              <Panel>
                <h3 className="text-sm">Timeline</h3>
                {researchFile.timeline.length === 0 ? <p className="mt-2 text-sm text-muted">Keine Ereignisse. Nichts geschätzt.</p> : null}
                <ul className="mt-2 space-y-1 text-sm">
                  {researchFile.timeline.map((event, index) => (
                    <li key={`${event.event}-${index}`}>{event.date} · {event.time} · {event.location}</li>
                  ))}
                </ul>
              </Panel>
              <Panel>
                <h3 className="text-sm">Verlauf</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {researchFile.session.map((item) => (
                    <li key={item.id}>{item.title} · {item.status}</li>
                  ))}
                </ul>
              </Panel>
            </div>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Meldungen zu dieser Akte</h2>
          {file.alerts.length === 0 ? <div className="mt-3"><Empty title="Keine Meldung" body="Neue Quellen zu dieser Akte erscheinen hier, ohne die alte Information zu löschen." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {file.alerts.map((alert) => (
              <li key={alert.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p className="text-xs text-muted">{formatWhen(alert.createdAt)} · {labelEvidence(alert.evidence)}{alert.seen ? " · gelesen" : ""}</p>
                <p className="mt-1">{alert.title}</p>
                <p className="text-muted">{alert.body}</p>
                {alert.source ? <p className="mt-1 truncate text-muted">{alert.source}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      </PageBody>
    </div>
  );
}

function EvidenceSelect({ value, onChange }: { value: EvidenceClass; onChange: (value: EvidenceClass) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value as EvidenceClass)}>
      {EVIDENCE.map((key) => <option key={key} value={key}>{EVIDENCE_LABEL[key]}</option>)}
    </select>
  );
}

function EventForm({ id, onDone, onError }: { id: string; onDone: () => void; onError: (value: string) => void }) {
  const [occurredOn, setOccurredOn] = useState("");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [evidence, setEvidence] = useState<EvidenceClass>("unknown");
  const [sourceUrl, setSourceUrl] = useState("");
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void addCaseEvent({ data: { caseId: id, occurredOn, label, detail, evidence, sourceUrl, historical: false } })
          .then(onDone)
          .catch((err: unknown) => onError(err instanceof Error ? err.message : "Ereignis nicht gespeichert."));
      }}
    >
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Datum"><input className={inputClass} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} placeholder="2024-05-12" /></Field>
          <Field label="Klasse"><EvidenceSelect value={evidence} onChange={setEvidence} /></Field>
          <Field label="Ereignis"><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} required /></Field>
          <Field label="Quelle"><input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" /></Field>
        </div>
        <div className="mt-3"><Field label="Detail"><TextArea value={detail} onChange={(event) => setDetail(event.target.value)} /></Field></div>
        <div className="mt-3"><Button type="submit">Ereignis speichern</Button></div>
      </Panel>
    </form>
  );
}

function ItemForm({ id, onDone, onError }: { id: string; onDone: () => void; onError: (value: string) => void }) {
  const [kind, setKind] = useState("source");
  const [body, setBody] = useState("");
  const [evidence, setEvidence] = useState<EvidenceClass>("reported");
  const [sourceUrl, setSourceUrl] = useState("");
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void addCaseItem({ data: { caseId: id, kind, body, evidence, sourceUrl, historical: false } })
          .then(onDone)
          .catch((err: unknown) => onError(err instanceof Error ? err.message : "Eintrag nicht gespeichert."));
      }}
    >
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Art">
            <select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value)}>
              {ITEM_KINDS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </Field>
          <Field label="Klasse"><EvidenceSelect value={evidence} onChange={setEvidence} /></Field>
          <Field label="Quelle"><input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" /></Field>
        </div>
        <div className="mt-3"><Field label="Text aus der Quelle"><TextArea value={body} onChange={(event) => setBody(event.target.value)} required /></Field></div>
        <div className="mt-3"><Button type="submit">Eintrag speichern</Button></div>
      </Panel>
    </form>
  );
}

function PersonForm({ id, onDone, onError }: { id: string; onDone: () => void; onError: (value: string) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<PersonRole>("named");
  const [evidence, setEvidence] = useState<EvidenceClass>("reported");
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void addCasePerson({ data: { caseId: id, name, role, evidence, note, sourceUrl } })
          .then(onDone)
          .catch((err: unknown) => onError(err instanceof Error ? err.message : "Person nicht gespeichert."));
      }}
    >
      <Panel>
        <p className="text-sm text-muted">{personLine(role)} Eine öffentliche https-Quelle legt dazu eine Personenakte zur Prüfung an.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Name aus der Quelle"><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
          <Field label="Rolle">
            <select className={inputClass} value={role} onChange={(event) => setRole(event.target.value as PersonRole)}>
              {PERSON_ROLES.map((key) => <option key={key} value={key}>{PERSON_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Klasse"><EvidenceSelect value={evidence} onChange={setEvidence} /></Field>
          <Field label="Quelle"><input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" /></Field>
        </div>
        <div className="mt-3"><Field label="Notiz"><TextArea value={note} onChange={(event) => setNote(event.target.value)} /></Field></div>
        <div className="mt-3"><Button type="submit">Person speichern</Button></div>
      </Panel>
    </form>
  );
}

function HypothesisForm({ id, onDone, onError }: { id: string; onDone: () => void; onError: (value: string) => void }) {
  const [title, setTitle] = useState("");
  const [support, setSupport] = useState("");
  const [contradict, setContradict] = useState("");
  const [unknown, setUnknown] = useState("");
  const [alternatives, setAlternatives] = useState("");
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void addCaseHypothesis({ data: { caseId: id, title, support, contradict, unknown, alternatives } })
          .then(onDone)
          .catch((err: unknown) => onError(err instanceof Error ? err.message : "Hypothese nicht gespeichert."));
      }}
    >
      <Panel>
        <p className="text-sm text-muted">Bleibt eine Hypothese. Nicht als Tatsache formulieren.</p>
        <div className="mt-3 grid gap-3">
          <Field label="Titel"><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required /></Field>
          <Field label="Dafür"><TextArea value={support} onChange={(event) => setSupport(event.target.value)} /></Field>
          <Field label="Dagegen"><TextArea value={contradict} onChange={(event) => setContradict(event.target.value)} /></Field>
          <Field label="Unbekannt"><TextArea value={unknown} onChange={(event) => setUnknown(event.target.value)} /></Field>
          <Field label="Alternativen"><TextArea value={alternatives} onChange={(event) => setAlternatives(event.target.value)} /></Field>
        </div>
        <div className="mt-3"><Button type="submit">Hypothese speichern</Button></div>
      </Panel>
    </form>
  );
}

function EdgeForm({ id, onDone, onError }: { id: string; onDone: () => void; onError: (value: string) => void }) {
  const [from, setFrom] = useState("");
  const [relation, setRelation] = useState("Aussage");
  const [to, setTo] = useState("");
  const [proven, setProven] = useState(false);
  const [note, setNote] = useState("");
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void addCaseEdge({ data: { caseId: id, from, relation, to, proven, note } })
          .then(onDone)
          .catch((err: unknown) => onError(err instanceof Error ? err.message : "Beziehung nicht gespeichert."));
      }}
    >
      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Von"><input className={inputClass} value={from} onChange={(event) => setFrom(event.target.value)} required /></Field>
          <Field label="Beziehung">
            <select className={inputClass} value={relation} onChange={(event) => setRelation(event.target.value)}>
              {RELATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Nach"><input className={inputClass} value={to} onChange={(event) => setTo(event.target.value)} required /></Field>
        </div>
        <div className="mt-3"><Field label="Begründung"><TextArea value={note} onChange={(event) => setNote(event.target.value)} /></Field></div>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={proven} onChange={(event) => setProven(event.target.checked)} />
          Ausdrücklich belegt, nicht nur ähnlich
        </label>
        <div className="mt-3"><Button type="submit">Beziehung speichern</Button></div>
      </Panel>
    </form>
  );
}

function MetaForm({ file, onDone, onError }: { file: File; onDone: () => void; onError: (value: string) => void }) {
  const entry = file.case;
  const [caseStatus, setCaseStatus] = useState<CaseStatus>(isCaseStatus(entry.caseStatus) ? entry.caseStatus : "open");
  const [investigationStatus, setInvestigationStatus] = useState(entry.investigationStatus);
  const [authority, setAuthority] = useState(entry.authority);
  const [courtName, setCourtName] = useState(entry.courtName);
  const [city, setCity] = useState(entry.city);
  const [district, setDistrict] = useState(entry.district);
  const [place, setPlace] = useState(entry.place);
  const [summary, setSummary] = useState(entry.summary);
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void saveCaseMeta({ data: { id: entry.id, caseStatus, investigationStatus, authority, courtName, city, district, place, summary } })
          .then(onDone)
          .catch((err: unknown) => onError(err instanceof Error ? err.message : "Akte nicht gespeichert."));
      }}
    >
      <Panel>
        <p className="text-sm text-muted">Bestehende Einträge bleiben. Hier änderst du nur den Rahmen der Akte.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Status">
            <select className={inputClass} value={caseStatus} onChange={(event) => setCaseStatus(event.target.value as CaseStatus)}>
              {CASE_STATUSES.map((key) => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Ermittlungsstand laut Quelle"><input className={inputClass} value={investigationStatus} onChange={(event) => setInvestigationStatus(event.target.value)} /></Field>
          <Field label="Behörde"><input className={inputClass} value={authority} onChange={(event) => setAuthority(event.target.value)} /></Field>
          <Field label="Gericht"><input className={inputClass} value={courtName} onChange={(event) => setCourtName(event.target.value)} /></Field>
          <Field label="Kreis"><input className={inputClass} value={district} onChange={(event) => setDistrict(event.target.value)} /></Field>
          <Field label="Stadt"><input className={inputClass} value={city} onChange={(event) => setCity(event.target.value)} /></Field>
          <Field label="Ort"><input className={inputClass} value={place} onChange={(event) => setPlace(event.target.value)} /></Field>
        </div>
        <div className="mt-3"><Field label="Zusammenfassung"><TextArea value={summary} onChange={(event) => setSummary(event.target.value)} /></Field></div>
        <div className="mt-3"><Button type="submit">Rahmen speichern</Button></div>
      </Panel>
    </form>
  );
}
