import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, Panel, TextArea, inputClass } from "@/components/ui";
import { askIntelligence, loadIntelligence, saveLinks, versionFinding } from "@/lib/intelligence/core-functions";
import { NOT_A_TRUTH } from "@/lib/intelligence/core";
import { GRAPH_EDGE_NOTE } from "@/lib/intelligence/hardening";

export const Route = createFileRoute("/intelligence")({ component: IntelligenceRoute });

type Desk = Awaited<ReturnType<typeof loadIntelligence>>;
type Run = Awaited<ReturnType<typeof askIntelligence>>;

function IntelligenceRoute() {
  return (
    <AppFrame>
      <IntelligencePage />
    </AppFrame>
  );
}

function IntelligencePage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [text, setText] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [findingId, setFindingId] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");

  function load() {
    return loadIntelligence()
      .then(setDesk)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Intelligence konnte nicht geladen werden."));
  }

  useEffect(() => {
    let cancelled = false;
    void loadIntelligence()
      .then((next) => {
        if (!cancelled) setDesk(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Intelligence konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const context = run?.context ?? desk?.context;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead kicker="Nur gespeicherte Daten" title="Intelligence" />
      <PageBody wide>
        <p className="max-w-2xl text-sm text-muted">
          Die Auswertung liest den eigenen Bestand. Sie startet keine Websuche und erfindet keine Quelle. {NOT_A_TRUTH}
        </p>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            setNote("");
            void askIntelligence({ data: { text } })
              .then((next) => {
                setRun(next);
                setNote(next.memory.durable ? next.memory.reason : "");
                return load();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Auswertung ist fehlgeschlagen."))
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Frage an den Bestand">
            <TextArea value={text} onChange={(event) => setText(event.target.value)} placeholder="Was weißt du über Fall …" />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Prüft" : "Auswerten"}</Button>
            <Button type="button" variant="ghost" onClick={() => setShow((value) => !value)}>{show ? "Analyse schließen" : "Analyse anzeigen"}</Button>
            <Link to="/research" className="inline-flex min-h-11 items-center text-sm underline">Websuche nur in der Recherche</Link>
          </div>
        </form>
        {note ? <p className="mt-3 text-sm">{note}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel>
            <h2 className="font-display text-2xl tracking-tight">Speicher</h2>
            {desk?.storage ? (
              <ul className="mt-3 space-y-1 text-sm">
                <li>DATABASE MODE: {desk.storage.mode === "neon" ? "Neon" : "Lokale Datenbank"}</li>
                <li>STORAGE LOCATION: {desk.storage.locationLabel}</li>
                <li>PERSISTENCE STATUS: {desk.storage.persistence}</li>
                <li>BACKUP STATUS: {desk.storage.backup}</li>
                <li className="text-muted">{desk.storage.backupNote}</li>
              </ul>
            ) : <p className="mt-3 text-sm text-muted">Speicherstatus noch nicht gelesen.</p>}
          </Panel>
          <Panel>
            <h2 className="font-display text-2xl tracking-tight">Datenbestand</h2>
            <p className="mt-3 text-sm">{desk?.dataset.phrase ?? "NICHT VERFÜGBAR"}</p>
            {run?.datasetPhrase ? <p className="mt-2 text-sm">Diese Frage: {run.datasetPhrase}</p> : null}
            {run && run.semanticOnly > 0 ? <p className="mt-2 text-sm text-muted">Semantische Treffer: {run.semanticOnly}. Sie werden nicht als Fakt gespeichert.</p> : null}
          </Panel>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel>
            <h2 className="font-display text-2xl tracking-tight">Aktueller Kontext</h2>
            {context ? (
              <ul className="mt-3 space-y-1 text-sm">
                <li>Akte: {context.activeCase || "keine"}</li>
                <li>Person: {context.activePerson || "keine"}</li>
                <li>Thema: {context.activeTopic || "keins"}</li>
                <li>Gebiet: {context.activeGeography || "keins"}</li>
                <li>Zeit: {context.activeTimeRange || "DATE MISSING"}</li>
                <li>Gespräch: {context.recentTurns.length ? `${context.recentTurns.length} gespeicherte Beiträge` : "noch keine Beiträge"}</li>
                <li>Anweisung: {context.activeInstruction || "keine"}</li>
              </ul>
            ) : <p className="mt-3 text-sm text-muted">Noch kein Kontext.</p>}
          </Panel>
          <Panel>
            <h2 className="font-display text-2xl tracking-tight">Letzte Aufgabe</h2>
            {desk && desk.runs.length === 0 ? <div className="mt-3"><Empty title="Keine Aufgabe" body="Eine Auswertung erscheint hier erst nach dem Start." /></div> : null}
            <ul className="mt-3 space-y-2 text-sm">
              {(desk?.runs ?? []).map((item) => (
                <li key={item.id}>
                  <p>{item.summary || "Ohne Zusammenfassung"}</p>
                  <p className="text-xs text-muted">{item.status}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </section>

        {run ? (
          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <List title="Bekannt" items={run.known} empty="Keine passende gespeicherte Aussage." />
            <List title="Unbekannt" items={run.unknown} empty="Keine benannte Lücke aus dieser Frage." />
            <List title="Quellen" items={run.sources.map((source) => `${source.title} · ${source.independence}`)} empty="Keine passende gespeicherte Quelle." />
            <List title="Widersprüche" items={run.conflicts} empty="Kein gespeicherter Widerspruch." />
            <List title="Schlussfolgerung" items={run.conclusion ? [run.conclusion] : []} empty="Keine Schlussfolgerung." />
            <List title="Nächster Schritt" items={run.nextSteps} empty="Kein nächster Schritt aus einer Lücke." />
          </section>
        ) : null}

        {show && run ? (
          <section className="mt-6">
            <h2 className="font-display text-2xl tracking-tight">Analyse</h2>
            <ol className="mt-3 grid gap-2">
              {run.stages.map((stage) => (
                <li key={stage.name} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p className="font-medium">{stage.name}</p>
                  <p className="text-muted">{stage.note}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm">{run.reply}</p>
            <p className="mt-2 text-xs text-muted">{run.confidence.level}: {run.confidence.reason}</p>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Fallvergleich</h2>
          <p className="mt-1 text-sm text-muted">{GRAPH_EDGE_NOTE} Ein Widerspruch bleibt sichtbar. Mögliche Treffer werden nicht gespeichert.</p>
          {desk && desk.links.length === 0 ? <div className="mt-3"><Empty title="Keine Verknüpfung aus Merkmalen" body="Nur gleiche gespeicherte Merkmale erzeugen einen Vergleich." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {(desk?.links ?? []).map((link) => (
              <li key={`${link.leftCaseId}-${link.rightCaseId}-${link.linkKind}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p>{link.linkKind} · {link.linkStrength}</p>
                <p>{link.leftCaseId} · {link.rightCaseId}</p>
                <p className="text-muted">{link.note}</p>
                <p className="text-xs text-muted">Quellen {link.sourceCount} · unabhängig {link.independentSourceCount === 0 ? "NICHT VERFÜGBAR" : link.independentSourceCount}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError("");
                void saveLinks()
                  .then((res) => {
                    setNote(res.note);
                    return load();
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Verknüpfung wurde nicht gespeichert."));
              }}
            >Dokumentierte Verknüpfungen speichern</Button>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Verknüpfungen</h2>
          <p className="mt-1 text-sm text-muted">{GRAPH_EDGE_NOTE}</p>
          {desk && desk.graph.length === 0 ? <div className="mt-3"><Empty title="Keine Verknüpfung" body="Personen, Fälle und Quellen erscheinen hier erst, wenn sie gespeichert sind." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {(desk?.graph ?? []).map((edge, index) => (
              <li key={`${edge.fromId}-${edge.toId}-${index}`} className="text-sm">
                {edge.from} {edge.fromId} · {edge.relation} · {edge.to} {edge.toId}
                <span className="block text-xs text-muted">Quelle {edge.sourceId || "SOURCE MISSING"}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Versionen</h2>
          {desk && desk.versions.length === 0 ? <div className="mt-3"><Empty title="Keine Version" body="Eine Erkenntnis wird nicht überschrieben. Eine neue Fassung braucht Text und Grund." /></div> : null}
          <ul className="mt-3 grid gap-2">
            {(desk?.versions ?? []).map((item) => (
              <li key={`${item.findingId}-${item.version}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p>{item.change ? `${item.change} · ` : ""}{item.status === "current" ? "CURRENT" : "OLDER VERSION"} · v{item.version}</p>
                {item.previousValue ? <p className="text-muted">Vorher: {item.previousValue}</p> : null}
                <p>Neu: {item.newValue}</p>
                <p className="text-xs text-muted">{item.reason} · {item.source || "SOURCE MISSING"}</p>
              </li>
            ))}
          </ul>
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              void versionFinding({ data: { findingId, value, reason, source } })
                .then((res) => {
                  setNote(res.note);
                  return load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Version wurde nicht gespeichert."));
            }}
          >
            <Panel>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Erkenntnis-ID"><input className={inputClass} value={findingId} onChange={(event) => setFindingId(event.target.value)} /></Field>
                <Field label="Quelle"><input className={inputClass} value={source} onChange={(event) => setSource(event.target.value)} placeholder="https:// oder leer" /></Field>
              </div>
              <div className="mt-3"><Field label="Neuer Text"><TextArea value={value} onChange={(event) => setValue(event.target.value)} /></Field></div>
              <div className="mt-3"><Field label="Grund"><TextArea value={reason} onChange={(event) => setReason(event.target.value)} /></Field></div>
              <div className="mt-3"><Button type="submit">Version speichern</Button></div>
            </Panel>
          </form>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-2xl tracking-tight">Nicht eingerichtet</h2>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {(desk?.notConfigured ?? []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      </PageBody>
    </div>
  );
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <Panel>
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      {items.length === 0 ? <p className="mt-3 text-sm text-muted">{empty}</p> : null}
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </Panel>
  );
}
