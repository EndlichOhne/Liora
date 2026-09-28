import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, Panel, TextArea, inputClass } from "@/components/ui";
import { EVIDENCE_LABEL, REGIONS, REGION_LABEL, isRegion } from "@/lib/cases/engine";
import { formatWhen } from "@/lib/domain";
import { loadPeople, openPerson } from "@/lib/people/functions";
import {
  NONE_PEOPLE,
  PEOPLE_ROLES,
  PEOPLE_STATUSES,
  PEOPLE_STATUS_LABEL,
  ROLE_LABEL,
  SOURCE_RELATIONS,
  caseCountPhrase,
  isPeopleRole,
  isPeopleStatus,
  type PeopleRole,
  type SourceRelation,
} from "@/lib/people/rules";

export const Route = createFileRoute("/people")({ component: PeopleRoute });

type Desk = Awaited<ReturnType<typeof loadPeople>>;

const FILTERS = [
  { id: "", label: "Alle" },
  { id: "verified_public", label: "Verifiziert" },
  { id: "needs_review", label: "Zu prüfen" },
  { id: "wanted_public", label: "Öffentlich gesucht" },
  { id: "historical", label: "Historisch" },
  { id: "missing", label: "Vermisst" },
  { id: "court", label: "Gerichtlich dokumentiert" },
] as const;
const PUBLIC_EVIDENCE = ["official", "court", "documented", "reported"] as const;
const SOURCE_RELATION_LABEL: Record<SourceRelation, string> = {
  identifies: "Benennt die Person",
  supports_role: "Trägt die Rolle",
  mentions: "Erwähnt die Person",
};

function PeopleRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const child = pathname.startsWith("/people/") && pathname !== "/people";
  return <AppFrame>{child ? <Outlet /> : <PeoplePage />}</AppFrame>;
}

function PeoplePage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load(next?: { query?: string; role?: string; region?: string; status?: string; filter?: string; page?: number }) {
    const data = { query, role, region, status, filter, page, ...next };
    return loadPeople({ data })
      .then(setDesk)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Personen konnten nicht geladen werden."));
  }

  useEffect(() => {
    let cancelled = false;
    void loadPeople({ data: { query: "", role: "", region: "", status: "", filter: "", page: 1 } })
      .then((next) => {
        if (!cancelled) setDesk(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Personen konnten nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Öffentlich dokumentiert"
        title="Personen"
        action={
          <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? "Schließen" : "Person"}
          </Button>
        }
      />
      <PageBody wide>
        <p className="max-w-2xl text-sm text-muted">
          Nur Angaben aus einer öffentlichen Quelle. Keine Bewertung, keine Täterfeststellung aus einem Muster. Ein gleicher Name wird nicht automatisch zusammengeführt.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id || "all"}
              type="button"
              className={`min-h-11 rounded-full border px-3 text-sm ${filter === item.id ? "border-accent bg-accent text-accent-foreground" : "border-border bg-card"}`}
              onClick={() => {
                setFilter(item.id);
                setPage(1);
                void load({ filter: item.id, page: 1 });
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className={inputClass}
            value={query}
            placeholder="Name suchen"
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              void load({ query: next });
            }}
          />
          <select className={inputClass} value={role} onChange={(event) => { setRole(event.target.value); void load({ role: event.target.value }); }}>
            <option value="">Alle Rollen</option>
            {PEOPLE_ROLES.map((key) => <option key={key} value={key}>{ROLE_LABEL[key]}</option>)}
          </select>
          <select className={inputClass} value={region} onChange={(event) => { setRegion(event.target.value); void load({ region: event.target.value }); }}>
            <option value="">Alle Regionen</option>
            {REGIONS.map((key) => <option key={key} value={key}>{REGION_LABEL[key]}</option>)}
          </select>
          <select className={inputClass} value={status} onChange={(event) => { setStatus(event.target.value); void load({ status: event.target.value }); }}>
            <option value="">Alle Status</option>
            {PEOPLE_STATUSES.map((key) => <option key={key} value={key}>{PEOPLE_STATUS_LABEL[key]}</option>)}
          </select>
        </div>
        {note ? <p className="mt-3 text-sm">{note}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {desk ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric label="Personen" value={desk.count} />
            <Metric label="Zuletzt geprüft" value={desk.verified.length} />
            <Metric label="Neu" value={desk.added.length} />
          </div>
        ) : null}
        {open ? (
          <PersonForm
            busy={busy}
            onSubmit={(data) => {
              setBusy(true);
              setError("");
              setNote("");
              void openPerson({
                data: {
                  ...data,
                  aliases: data.aliases.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
                  birthYear: data.birthYear.trim() ? Number(data.birthYear) : null,
                  nationality: data.nationality.trim() || null,
                  region: data.region || null,
                },
              })
                .then((res) => {
                  setNote(res.note);
                  setOpen(false);
                  return load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Person wurde nicht angelegt."))
                .finally(() => setBusy(false));
            }}
          />
        ) : null}
        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Akten</h2>
          {desk && desk.people.length === 0 ? (
            <div className="mt-3">
              <Empty title={NONE_PEOPLE} body="Es wird niemand erfunden. Ein Filter zeigt nur gespeicherte Akten." />
            </div>
          ) : null}
          <ul className="mt-3 grid gap-2">
            {(desk?.people ?? []).map((person) => (
              <li key={person.id}>
                <Link to="/people/$id" params={{ id: person.id }} className="block rounded-lg border border-border bg-card px-4 py-3">
                  <p className="font-medium">{person.displayName}</p>
                  <p className="mt-1 text-sm text-muted">
                    {isPeopleRole(person.role) ? ROLE_LABEL[person.role] : person.role}
                    {" · "}
                    {isPeopleStatus(person.status) ? PEOPLE_STATUS_LABEL[person.status] : person.status}
                    {person.region && isRegion(person.region) ? ` · ${REGION_LABEL[person.region]}` : ""}
                  </p>
                  <p className="mt-1 text-sm">{caseCountPhrase(person.caseCount)}</p>
                  <p className="mt-1 text-xs text-muted">Letzte Verifizierung: {person.lastVerifiedAt ? formatWhen(person.lastVerifiedAt) : "noch keine"}</p>
                  {person.missing.length ? <p className="mt-1 text-xs text-muted">{person.missing.join(" · ")}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
          {desk && desk.pages > 1 ? (
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={desk.page <= 1}
                onClick={() => {
                  const next = desk.page - 1;
                  setPage(next);
                  void load({ page: next });
                }}
              >
                Zurück
              </Button>
              <p className="text-sm text-muted">Seite {desk.page} von {desk.pages}</p>
              <Button
                variant="ghost"
                disabled={desk.page >= desk.pages}
                onClick={() => {
                  const next = desk.page + 1;
                  setPage(next);
                  void load({ page: next });
                }}
              >
                Weiter
              </Button>
            </div>
          ) : null}
        </section>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section>
            <h2 className="font-display text-2xl tracking-tight">Zuletzt geprüft</h2>
            {desk && desk.verified.length === 0 ? <div className="mt-3"><Empty title="Noch keine Prüfung" body="Eine Person bleibt zur Prüfung, bis eine ausreichende Quelle bestätigt wurde." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {(desk?.verified ?? []).map((person) => (
                <li key={person.id} className="text-sm">
                  <Link to="/people/$id" params={{ id: person.id }} className="underline">{person.displayName}</Link>
                  <span className="text-muted"> · {person.lastVerifiedAt ? formatWhen(person.lastVerifiedAt) : "ohne Zeitpunkt"}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="font-display text-2xl tracking-tight">Neu hinzugefügt</h2>
            {desk && desk.added.length === 0 ? <div className="mt-3"><Empty title="Noch keine Akte" body="Neue Personen erscheinen hier erst nach dem Speichern." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {(desk?.added ?? []).map((person) => (
                <li key={person.id} className="text-sm">
                  <Link to="/people/$id" params={{ id: person.id }} className="underline">{person.displayName}</Link>
                  <span className="text-muted"> · {person.createdAt ? formatWhen(person.createdAt) : "DATE MISSING"}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </PageBody>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <p className="font-display text-2xl tracking-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function PersonForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (data: {
    displayName: string;
    aliases: string;
    role: PeopleRole;
    birthYear: string;
    nationality: string;
    region: string;
    summary: string;
    sourceUrl: string;
    evidence: (typeof PUBLIC_EVIDENCE)[number];
    sourceRelation: SourceRelation;
  }) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [aliases, setAliases] = useState("");
  const [role, setRole] = useState<PeopleRole>("publicly_named");
  const [birthYear, setBirthYear] = useState("");
  const [nationality, setNationality] = useState("");
  const [region, setRegion] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [evidence, setEvidence] = useState<(typeof PUBLIC_EVIDENCE)[number]>("reported");
  const [sourceRelation, setSourceRelation] = useState<SourceRelation>("identifies");
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ displayName, aliases, role, birthYear, nationality, region, summary, sourceUrl, evidence, sourceRelation });
      }}
    >
      <Panel>
        <p className="text-sm text-muted">Leere Felder bleiben leer. Verurteilt nur mit Gericht, Fahndung nur mit behördlicher oder dokumentierter Quelle.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Name aus der Quelle"><input className={inputClass} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} /></Field>
          <Field label="Weitere Schreibweisen"><input className={inputClass} value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="durch Komma getrennt" /></Field>
          <Field label="Rolle">
            <select className={inputClass} value={role} onChange={(event) => { if (isPeopleRole(event.target.value)) setRole(event.target.value); }}>
              {PEOPLE_ROLES.map((key) => <option key={key} value={key}>{ROLE_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Status"><input className={inputClass} value={PEOPLE_STATUS_LABEL.needs_review} readOnly /></Field>
          <Field label="Geburtsjahr"><input className={inputClass} value={birthYear} onChange={(event) => setBirthYear(event.target.value)} placeholder="nur wenn belegt" inputMode="numeric" /></Field>
          <Field label="Herkunft"><input className={inputClass} value={nationality} onChange={(event) => setNationality(event.target.value)} placeholder="nur wenn belegt" /></Field>
          <Field label="Region">
            <select className={inputClass} value={region} onChange={(event) => setRegion(event.target.value)}>
              <option value="">Keine Angabe</option>
              {REGIONS.map((key) => <option key={key} value={key}>{REGION_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Quellenbeziehung">
            <select className={inputClass} value={sourceRelation} onChange={(event) => { const next = event.target.value; if (next === "identifies" || next === "supports_role" || next === "mentions") setSourceRelation(next); }}>
              {SOURCE_RELATIONS.map((key) => <option key={key} value={key}>{SOURCE_RELATION_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Klasse">
            <select className={inputClass} value={evidence} onChange={(event) => { const next = event.target.value; if (next === "official" || next === "court" || next === "documented" || next === "reported") setEvidence(next); }}>
              {PUBLIC_EVIDENCE.map((key) => <option key={key} value={key}>{EVIDENCE_LABEL[key]}</option>)}
            </select>
          </Field>
          <Field label="Quelle"><input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" required /></Field>
        </div>
        <div className="mt-3"><Field label="Was die Quelle sagt"><TextArea value={summary} onChange={(event) => setSummary(event.target.value)} /></Field></div>
        <div className="mt-3"><Button type="submit" disabled={busy}>{busy ? "Speichert" : "Person speichern"}</Button></div>
      </Panel>
    </form>
  );
}
