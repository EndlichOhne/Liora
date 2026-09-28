import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, Panel, TextArea, inputClass } from "@/components/ui";
import {
  CASE_STATUSES,
  CASE_TYPES,
  CASE_TYPE_LABEL,
  EVIDENCE_LABEL,
  REGIONS,
  REGION_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  isEvidence,
  isRegion,
  type CaseStatus,
  type CaseType,
  type Region,
} from "@/lib/cases/engine";
import { bindLead, dropLead, keepLead, loadDesk, openCase, researchCases, reviewCandidates, seeAlert, settleCandidate, stepDesk } from "@/lib/cases/functions";
import { DiscoveryPanel } from "@/components/discovery-panel";
import { formatWhen } from "@/lib/domain";

export const Route = createFileRoute("/cases")({ component: CasesRoute });

type Desk = Awaited<ReturnType<typeof loadDesk>>;

const AGENTS: Record<string, string> = {
  web_research: "Webrecherche",
  source_hunter: "Quellen",
  fact_checker: "Prüfung",
  cold_case: "Cold Case",
  contradiction: "Widersprüche",
  evaluation: "Auswertung",
  orchestrator: "Orchestrierung",
  deep_research: "Tiefenrecherche",
  disconfirmation: "Gegenprüfung",
};

const KINDS: Record<string, string> = {
  scan_region: "Region",
  recheck_source: "Quelle erneut",
  gap_review: "Lücke",
  contradiction_scan: "Widerspruch",
  cold_review: "Cold Case",
  discovery: "Vergleich",
  benchmark: "Test",
  idle: "Ruhe",
  deep_case: "Akte",
  public_cases: "Öffentliche Fälle",
};

function sourceLabel(kind: string) {
  return isSourceKind(kind) ? SOURCE_LABEL[kind] : kind;
}

function evidenceLabel(value: string) {
  return isEvidence(value) ? EVIDENCE_LABEL[value] : "Unbekannt";
}

const CANDIDATE_LABEL: Record<string, string> = {
  candidate: "Kandidat",
  verified_public: "Öffentlich übernommen",
  duplicate: "Dublette",
  rejected: "Verworfen",
  needs_review: "Prüfung nötig",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  low: "gering",
  limited: "begrenzt",
  notable: "auffällig, nicht belegt",
};

function CasesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const child = pathname.startsWith("/cases/") && pathname !== "/cases";
  return <AppFrame>{child ? <Outlet /> : <CasesPage />}</AppFrame>;
}

function stateFor(region: Region) {
  return region === "de" ? "" : "Baden-Württemberg";
}

function CasesPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState<Region | "">("");
  const [status, setStatus] = useState<CaseStatus | "">("");
  const [caseType, setCaseType] = useState<CaseType | "">("");
  const [open, setOpen] = useState(false);
  const [bind, setBind] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [formRegion, setFormRegion] = useState<Region>("karlsruhe");
  const [stateName, setStateName] = useState("Baden-Württemberg");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("Karlsruhe");
  const [place, setPlace] = useState("");
  const [formType, setFormType] = useState<CaseType>("unsolved");
  const [formStatus, setFormStatus] = useState<CaseStatus>("open");
  const [investigation, setInvestigation] = useState("");
  const [authority, setAuthority] = useState("");
  const [court, setCourt] = useState("");
  const [openedOn, setOpenedOn] = useState("");
  const [summary, setSummary] = useState("");
  const [abroad, setAbroad] = useState(false);
  const running = useRef(false);

  function load() {
    return loadDesk()
      .then((next) => {
        setDesk(next);
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Fälle konnten nicht geladen werden."));
  }

  useEffect(() => {
    void load();
  }, []);

  async function runResearch() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await researchCases();
      setNote(result.note);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Die Recherche ist fehlgeschlagen.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function runReview() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await reviewCandidates();
      setNote(result.note);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Die Prüfung ist fehlgeschlagen.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function runStep() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await stepDesk();
      setNote(result.note);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Der Schritt ist fehlgeschlagen.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const stepRef = useRef(runStep);
  stepRef.current = runStep;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void stepRef.current();
    }, 110_000);
    return () => window.clearInterval(id);
  }, []);

  const cases = (desk?.cases ?? []).filter((item) => {
    if (region && item.region !== region) return false;
    if (status && item.caseStatus !== status) return false;
    if (caseType && item.caseType !== caseType) return false;
    return true;
  });

  return (
    <div className="desk min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Deutschland"
        title="Fälle"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
              {open ? "Schließen" : "Akte"}
            </Button>
            <Button disabled={busy} onClick={() => void runStep()}>
              {busy ? "Arbeitet" : "Ein Schritt"}
            </Button>
          </div>
        }
      />
      <PageBody wide>
        <p className="max-w-2xl text-sm text-muted">
          Öffentliche Recherche. Keine Polizei, kein Gericht, keine Beschuldigung. Zuerst Karlsruhe, dann Stuttgart, Mannheim, Rastatt, Baden-Württemberg, Deutschland. Ausland nur, wenn ein deutscher Fall es braucht.
        </p>
        <p className="mt-2 text-sm text-muted">Solange diese Seite offen ist, läuft höchstens alle 110 Sekunden ein Schritt. Websuche höchstens sechsmal am Tag. Unveränderte Quellen werden nicht neu analysiert.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void runResearch()}>{busy ? "Arbeitet" : "Öffentliche Fälle recherchieren"}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void runReview()}>Neue Fälle prüfen</Button>
        </div>
        {desk?.board.lastResearch ? (
          <p className="mt-3 text-sm">Letzte Recherche: {desk.board.lastResearch.result}{desk.board.lastResearch.at ? ` · ${formatWhen(desk.board.lastResearch.at)}` : ""}</p>
        ) : (
          <p className="mt-3 text-sm text-muted">Letzte Recherche: noch keine.</p>
        )}
        {note ? <p className="mt-3 text-sm">{note}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-6">
          {REGIONS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRegion((current) => (current === key ? "" : key))}
              className={`rounded-lg border px-3 py-3 text-left ${region === key ? "border-foreground bg-subtle" : "border-border bg-card"}`}
            >
              <p className="font-display text-2xl tracking-tight">{desk?.board.regions[key] ?? 0}</p>
              <p className="text-xs text-muted">{REGION_LABEL[key]}</p>
            </button>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label="Cold Cases" value={desk?.board.cold ?? 0} onClick={() => setStatus((value) => (value === "cold" ? "" : "cold"))} active={status === "cold"} />
          <Metric label="Vermisst" value={desk?.board.missing ?? 0} onClick={() => setCaseType((value) => (value === "missing" ? "" : "missing"))} active={caseType === "missing"} />
          <Metric label="Hinweise" value={desk?.board.leads ?? 0} />
          <Metric label="Fallkandidaten" value={desk?.board.candidates ?? 0} />
          <Metric label="Übernommen" value={desk?.board.adopted ?? 0} />
          <Metric label="Meldungen" value={desk?.board.alerts ?? 0} />
          <Metric label="Widersprüche" value={desk?.board.contradictions ?? 0} />
          <Metric label="Quellen" value={desk?.board.sources ?? 0} />
          <Metric label="Offiziell oder Gericht" value={desk?.board.verified ?? 0} />
        </div>

        {open ? (
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              void openCase({
                data: {
                  title,
                  region: formRegion,
                  stateName,
                  district,
                  city,
                  place,
                  caseType: formType,
                  caseStatus: formStatus,
                  investigationStatus: investigation,
                  authority,
                  courtName: court,
                  summary,
                  abroadRelevant: abroad,
                  openedOn,
                },
              })
                .then(() => {
                  setTitle("");
                  setSummary("");
                  setOpen(false);
                  return load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Akte wurde nicht angelegt."));
            }}
          >
            <Panel>
              <p className="text-sm text-muted">Nur eintragen, was du aus einer Quelle hast. Leere Felder bleiben leer.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Titel">
                  <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required minLength={4} />
                </Field>
                <Field label="Datum oder Zeitraum">
                  <input className={inputClass} value={openedOn} onChange={(event) => setOpenedOn(event.target.value)} placeholder="2024-05-12" />
                </Field>
                <Field label="Region">
                  <select
                    className={inputClass}
                    value={formRegion}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!isRegion(next)) return;
                      setFormRegion(next);
                      setStateName(stateFor(next));
                      if (!city || REGIONS.some((key) => REGION_LABEL[key] === city)) setCity(next === "bw" || next === "de" ? "" : REGION_LABEL[next]);
                    }}
                  >
                    {REGIONS.map((key) => (
                      <option key={key} value={key}>{REGION_LABEL[key]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Land">
                  <input className={inputClass} value={stateName} onChange={(event) => setStateName(event.target.value)} />
                </Field>
                <Field label="Kreis">
                  <input className={inputClass} value={district} onChange={(event) => setDistrict(event.target.value)} />
                </Field>
                <Field label="Stadt">
                  <input className={inputClass} value={city} onChange={(event) => setCity(event.target.value)} />
                </Field>
                <Field label="Ort, öffentlich">
                  <input className={inputClass} value={place} onChange={(event) => setPlace(event.target.value)} />
                </Field>
                <Field label="Art">
                  <select className={inputClass} value={formType} onChange={(event) => setFormType(event.target.value as CaseType)}>
                    {CASE_TYPES.map((key) => (
                      <option key={key} value={key}>{CASE_TYPE_LABEL[key]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select className={inputClass} value={formStatus} onChange={(event) => setFormStatus(event.target.value as CaseStatus)}>
                    {CASE_STATUSES.map((key) => (
                      <option key={key} value={key}>{STATUS_LABEL[key]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Ermittlungsstand laut Quelle">
                  <input className={inputClass} value={investigation} onChange={(event) => setInvestigation(event.target.value)} />
                </Field>
                <Field label="Behörde">
                  <input className={inputClass} value={authority} onChange={(event) => setAuthority(event.target.value)} />
                </Field>
                <Field label="Gericht">
                  <input className={inputClass} value={court} onChange={(event) => setCourt(event.target.value)} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Kurz, mit Quelle im Text">
                  <TextArea value={summary} onChange={(event) => setSummary(event.target.value)} />
                </Field>
              </div>
              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={abroad} onChange={(event) => setAbroad(event.target.checked)} />
                Ausland nur, weil es zu diesem deutschen Fall gehört
              </label>
              <div className="mt-3">
                <Button type="submit">Speichern</Button>
              </div>
            </Panel>
          </form>
        ) : null}

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Hinweise</h2>
          <p className="mt-1 text-sm text-muted">Ein allgemeiner Suchtreffer bleibt ein Hinweis. Nur ein konkreter öffentlicher Fall kann in die Fallbank.</p>
          {desk && desk.leads.length === 0 ? <div className="mt-3"><Empty title="Keine offenen Hinweise" body="Eine Suche legt nur dann etwas an, wenn eine öffentliche deutsche Quelle zurückkommt." /></div> : null}
          <div className="mt-3 grid gap-2">
            {desk?.leads.map((lead) => (
              <article key={lead.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{isRegion(lead.region) ? REGION_LABEL[lead.region] : lead.region}</span>
                  <span>{sourceLabel(lead.kind)}</span>
                  <span>{evidenceLabel(lead.evidence)}</span>
                </div>
                <h3 className="mt-1 text-base">{lead.title}</h3>
                {lead.snippet ? <p className="mt-1 text-sm text-muted">{lead.snippet}</p> : null}
                {lead.url ? <a className="mt-1 block truncate text-sm underline" href={lead.url} target="_blank" rel="noreferrer">{lead.url}</a> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => {
                      void keepLead({ data: { id: lead.id } })
                        .then(() => load())
                        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Hinweis nicht übernommen."));
                    }}
                  >
                    Als Akte
                  </Button>
                  <select
                    className={`${inputClass} sm:w-56`}
                    value={bind[lead.id] ?? ""}
                    onChange={(event) => setBind((current) => ({ ...current, [lead.id]: event.target.value }))}
                  >
                    <option value="">Bestehende Akte</option>
                    {desk.cases.map((item) => (
                      <option key={item.id} value={item.id}>{item.code} {item.title}</option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    disabled={!bind[lead.id]}
                    onClick={() => {
                      void bindLead({ data: { leadId: lead.id, caseId: bind[lead.id] } })
                        .then(() => load())
                        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Hinweis nicht zugeordnet."));
                    }}
                  >
                    Zuordnen
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void dropLead({ data: { id: lead.id } }).then(() => load());
                    }}
                  >
                    Verwerfen
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Fallkandidaten</h2>
          <p className="mt-1 text-sm text-muted">Eine Quelle wird erst ein Fall, wenn sie einen konkreten öffentlichen Vorfall beschreibt. Medienberichte bleiben zur Prüfung. Fehlende Angaben bleiben leer.</p>
          {desk && desk.candidates.length === 0 ? <div className="mt-3"><Empty title="Keine Fallkandidaten" body="Keine neuen öffentlichen Fälle gefunden." /></div> : null}
          <div className="mt-3 grid gap-2">
            {desk?.candidates.map((item) => (
              <article key={item.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted">
                  {CANDIDATE_LABEL[item.status] ?? item.status}
                  {" · "}
                  {isRegion(item.region) ? REGION_LABEL[item.region] : item.region}
                  {item.city ? ` · ${item.city}` : " · CITY MISSING"}
                  {" · "}
                  {evidenceLabel(item.evidence)}
                  {" · "}
                  {CONFIDENCE_LABEL[item.confidence] ?? item.confidence}
                </p>
                <h3 className="mt-1 text-base">{item.title}</h3>
                {item.summary ? <p className="mt-1 text-sm text-muted">{item.summary}</p> : null}
                {item.missing ? <p className="mt-1 text-xs text-muted">{item.missing}</p> : null}
                {item.openedOn ? <p className="mt-1 text-xs text-muted">{item.openedOn}</p> : <p className="mt-1 text-xs text-muted">DATE MISSING</p>}
                {item.sourceUrl ? <a className="mt-1 block truncate text-sm underline" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a> : <p className="mt-1 text-sm text-muted">SOURCE MISSING</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.caseId ? <Link to="/cases/$id" params={{ id: item.caseId }} className="inline-flex min-h-11 items-center text-sm underline">Akte</Link> : null}
                  {!item.caseId && item.status !== "rejected" && item.status !== "duplicate" ? (
                    <Button
                      onClick={() => {
                        void settleCandidate({ data: { id: item.id, accept: true } })
                          .then(() => load())
                          .catch((err: unknown) => setError(err instanceof Error ? err.message : "Kandidat nicht übernommen."));
                      }}
                    >
                      In die Fallbank
                    </Button>
                  ) : null}
                  {item.status !== "rejected" && item.status !== "verified_public" && !item.caseId ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        void settleCandidate({ data: { id: item.id, accept: false } }).then(() => load());
                      }}
                    >
                      Verwerfen
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Meldungen</h2>
          {desk && desk.alerts.length === 0 ? <div className="mt-3"><Empty title="Keine neue Meldung" body="Eine Meldung entsteht nur, wenn eine Quelle sich ändert oder zu einer bestehenden Akte passt." /></div> : null}
          <div className="mt-3 grid gap-2">
            {desk?.alerts.map((alert) => (
              <article key={alert.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted">{formatWhen(alert.createdAt)} · {evidenceLabel(alert.evidence)}</p>
                <h3 className="mt-1 text-base">{alert.title}</h3>
                <p className="mt-1 text-sm">{alert.body}</p>
                {alert.source ? <p className="mt-1 truncate text-sm text-muted">{alert.source}</p> : null}
                <div className="mt-3 flex gap-2">
                  {alert.caseId ? <Link to="/cases/$id" params={{ id: alert.caseId }} className="inline-flex min-h-11 items-center text-sm underline">Akte</Link> : null}
                  <Button variant="ghost" onClick={() => void seeAlert({ data: { id: alert.id } }).then(() => load())}>Gelesen</Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-2xl tracking-tight">Akten</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value as CaseStatus | "")}>
                <option value="">Jeder Status</option>
                {CASE_STATUSES.map((key) => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
              </select>
              <select className={inputClass} value={caseType} onChange={(event) => setCaseType(event.target.value as CaseType | "")}>
                <option value="">Jede Art</option>
                {CASE_TYPES.map((key) => <option key={key} value={key}>{CASE_TYPE_LABEL[key]}</option>)}
              </select>
              <Button variant="ghost" onClick={() => { setRegion(""); setStatus(""); setCaseType(""); }}>Filter aus</Button>
            </div>
          </div>
          {desk && cases.length === 0 ? <div className="mt-3"><Empty title="Keine Akte" body={desk.cases.length === 0 ? "Die Fallbank ist leer, bis eine konkrete öffentliche Quelle übernommen wird. Es wird kein Fall erfunden." : "Es ist nichts gespeichert, das zu diesem Filter passt. Es wird kein Fall erfunden."} /></div> : null}
          <div className="mt-3 grid gap-2">
            {cases.map((item) => (
              <Link key={item.id} to="/cases/$id" params={{ id: item.id }} className="rounded-lg border border-border bg-card px-4 py-3 transition-colors duration-150 hover:bg-subtle">
                <p className="font-mono text-xs text-muted">{item.code}</p>
                <p className="mt-1 text-base">{item.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {isRegion(item.region) ? REGION_LABEL[item.region] : item.region}
                  {item.city ? ` · ${item.city}` : ""}
                  {item.place ? ` · ${item.place}` : ""}
                  {" · "}
                  {isCaseType(item.caseType) ? CASE_TYPE_LABEL[item.caseType] : item.caseType}
                  {" · "}
                  {isCaseStatus(item.caseStatus) ? STATUS_LABEL[item.caseStatus] : item.caseStatus}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl tracking-tight">Orte</h2>
            <p className="mt-1 text-sm text-muted">Nur Orte aus den Akten. Keine Karte, keine privaten Adressen.</p>
            {desk && desk.board.places.length === 0 ? <div className="mt-3"><Empty title="Noch kein Ort" body="Stadt oder Ort erscheinen hier, sobald eine Akte sie nennt." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {desk?.board.places.map((item) => (
                <li key={`${item.region}-${item.city}-${item.place}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <span>{isRegion(item.region) ? REGION_LABEL[item.region] : item.region}</span>
                  {item.city ? <span> · {item.city}</span> : null}
                  {item.place ? <span> · {item.place}</span> : null}
                  <span className="text-muted"> · {item.n}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-2xl tracking-tight">Ähnlichkeit</h2>
            <p className="mt-1 text-sm text-muted">Gemeinsamer Typ oder Ort ist kein belegter Zusammenhang.</p>
            {desk && desk.board.patterns.length === 0 ? <div className="mt-3"><Empty title="Kein Vergleich" body="Dafür braucht es mindestens zwei Akten mit gleichem Typ oder gleicher Stadt." /></div> : null}
            <ul className="mt-3 grid gap-2">
              {desk?.board.patterns.map((item) => (
                <li key={`${item.left}-${item.right}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p>{item.left}</p>
                  <p className="text-muted">{item.right}</p>
                  <p className="mt-2 text-muted">{item.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <DiscoveryPanel />

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Beobachtete Quellen</h2>
          <div className="mt-3 grid gap-2">
            {desk?.watches.map((watch) => (
              <article key={watch.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base">{watch.title}</h3>
                  <p className="text-xs text-muted">{isRegion(watch.region) ? REGION_LABEL[watch.region] : watch.region}</p>
                </div>
                <a className="mt-1 block truncate text-sm underline" href={watch.url} target="_blank" rel="noreferrer">{watch.url}</a>
                <p className="mt-2 text-sm text-muted">
                  {watch.checkedAt ? `Geprüft ${formatWhen(watch.checkedAt)}` : "Noch nicht geprüft"}
                  {watch.changedAt ? ` · Änderung ${formatWhen(watch.changedAt)}` : ""}
                  {watch.hash ? " · Hash liegt vor" : ""}
                </p>
                {watch.note ? <p className="mt-1 text-sm">{watch.note}</p> : null}
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Letzte Schritte</h2>
          {desk && desk.board.jobs.length === 0 ? <div className="mt-3"><Empty title="Noch kein Schritt" body="Ein Schritt prüft eine fällige Aufgabe. Wenn nichts fällig ist, bleibt er still." /></div> : null}
          <ol className="mt-3 grid gap-2">
            {desk?.board.jobs.map((job) => (
              <li key={job.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted">
                  {formatWhen(job.at)} · {AGENTS[job.agent] ?? job.agent} · {KINDS[job.kind] ?? job.kind}
                  {job.region && isRegion(job.region) ? ` · ${REGION_LABEL[job.region]}` : ""}
                  {job.web ? " · Web" : ""}
                </p>
                <p className="mt-1 text-sm">{job.result || job.reason}</p>
              </li>
            ))}
          </ol>
        </section>
      </PageBody>
    </div>
  );
}

function Metric({ label, value, onClick, active = false }: { label: string; value: number; onClick?: () => void; active?: boolean }) {
  const className = `rounded-lg border px-3 py-3 text-left ${active ? "border-foreground bg-subtle" : "border-border bg-card"}`;
  const body = (
    <>
      <p className="font-display text-2xl tracking-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </>
  );
  if (!onClick) return <div className={className}>{body}</div>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  );
}

function isCaseType(value: string): value is CaseType {
  return (CASE_TYPES as readonly string[]).includes(value);
}

function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

function isSourceKind(value: string): value is keyof typeof SOURCE_LABEL {
  return value in SOURCE_LABEL;
}
