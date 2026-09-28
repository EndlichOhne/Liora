import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Panel, TextArea, inputClass } from "@/components/ui";
import { formatWhen, hostOf } from "@/lib/domain";
import { loadClaims, loadSources } from "@/lib/intelligence/functions";
import type { ClaimDTO, SourceDTO } from "@/lib/intelligence/types";
import { loadResearch, loadResearchTasks, startResearch } from "@/lib/research/functions";
import { loadSourceNetwork } from "@/lib/people/functions";
import { LINK_NOTE } from "@/lib/people/rules";

export const Route = createFileRoute("/research")({ component: ResearchRoute });

type TaskList = Awaited<ReturnType<typeof loadResearchTasks>>;
type TaskFile = NonNullable<Awaited<ReturnType<typeof loadResearch>>>;

function ResearchRoute() {
  return (
    <AppFrame>
      <ResearchPage />
    </AppFrame>
  );
}

function ResearchPage() {
  const [task, setTask] = useState("");
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<TaskList>([]);
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<TaskFile | null>(null);
  const [sources, setSources] = useState<SourceDTO[]>([]);
  const [claims, setClaims] = useState<ClaimDTO[]>([]);
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState<Awaited<ReturnType<typeof loadSourceNetwork>>>({});

  function loadLibrary() {
    void Promise.all([loadSources(), loadClaims(), loadResearchTasks(), loadSourceNetwork()])
      .then(([nextSources, nextClaims, tasks, links]) => {
        setSources(nextSources);
        setClaims(nextClaims);
        setHistory(tasks);
        setNetwork(links);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Recherche konnte nicht geladen werden."));
  }

  useEffect(loadLibrary, []);

  useEffect(() => {
    if (!selected) {
      setFile(null);
      return;
    }
    void loadResearch({ data: { id: selected } })
      .then((next) => setFile(next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Die Aufgabe konnte nicht geladen werden."));
  }, [selected]);

  const visible = sources.filter((source) => {
    const hay = `${source.title} ${source.url} ${source.note} ${source.kind}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead kicker="Quellen" title="Recherche" />
      <PageBody wide>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                setNote("");
                void startResearch({ data: { request: task, web } })
                  .then((res) => {
                    setNote(res.summary);
                    if (res.task) setSelected(res.task.id);
                    setTask("");
                    loadLibrary();
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Recherche fehlgeschlagen."))
                  .finally(() => setBusy(false));
              }}
            >
              <TextArea value={task} onChange={(event) => setTask(event.target.value)} placeholder="Was soll öffentlich geprüft werden?" required minLength={8} />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
                Websuche erlauben
              </label>
              <Button type="submit" disabled={busy}>{busy ? "Läuft" : "Recherche starten"}</Button>
            </form>
            <p className="text-xs text-muted">Ohne Haken bleibt die Websuche aus. Es wird nichts erfunden. Eine Folgefrage wie „Such noch nach dem Fahrzeug“ bleibt in derselben Sitzung.</p>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {note ? <p className="text-sm">{note}</p> : null}
            {file ? <TaskDetail file={file} /> : null}
          </div>
          <aside className="space-y-3">
            <p className="text-xs text-muted">Research History</p>
            {history.length === 0 ? <p className="text-sm text-muted">Noch keine gespeicherte Recherche.</p> : null}
            <ul className="space-y-2">
              {history.map((item) => (
                <li key={item.id}>
                  <button type="button" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-sm" onClick={() => setSelected(item.id)}>
                    <span className="block font-medium">{item.title}</span>
                    <span className="text-xs text-muted">{item.status} · {item.scope}{item.caseId ? " · Akte" : ""} · {formatWhen(item.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="pt-3 text-xs text-muted">Gespeicherte Quellen</p>
            <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Quellen filtern" />
            <p className="text-xs text-muted">{visible.length} von {sources.length}</p>
          </aside>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {sources.length === 0 ? (
            <Empty title="Noch keine Quelle" body="Eine Recherche mit Websuche speichert nur zurückgegebene Quellen. Ohne Treffer bleibt die Liste leer." />
          ) : null}
          {visible.map((source) => (
            <SourceCard key={source.id} source={source} links={network[source.id]} />
          ))}
        </div>
        {claims.length ? (
          <section className="mt-8">
            <h2 className="font-display text-2xl tracking-tight">Prüfnotizen</h2>
            <ul className="mt-3 space-y-2">
              {claims.slice(0, 8).map((claim) => (
                <li key={claim.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p className="text-xs text-muted">{claim.status} · {formatWhen(claim.createdAt)}</p>
                  <p className="mt-1">{claim.claim}</p>
                  <p className="mt-1 text-muted">{claim.primaryNote}</p>
                  {claim.conflictNote ? <p className="text-muted">{claim.conflictNote}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PageBody>
    </div>
  );
}

function TaskDetail({ file }: { file: TaskFile }) {
  const facts = file.elements.filter((item) => item.status !== "question");
  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-xs text-muted">Research Status</p>
        <h2 className="mt-1 font-display text-2xl tracking-tight">{file.task.title}</h2>
        <p className="mt-2 text-sm">{file.task.status} · {file.task.scope} · {file.task.priority}</p>
        {file.task.lastError ? <p className="mt-2 text-sm text-danger">{file.task.lastError}</p> : null}
        {file.task.resultSummary ? <p className="mt-2 text-sm">{file.task.resultSummary}</p> : null}
        <p className="mt-2 text-xs text-muted">Cross-Case: {file.crossCase.note || "Noch keine Bewertung."}</p>
      </Panel>
      <Panel>
        <h3 className="font-display text-xl">Plan</h3>
        <ol className="mt-3 space-y-2">
          {file.steps.map((step) => (
            <li key={step.id} className="text-sm">
              <span className="text-muted">{step.position + 1}. {step.status}. </span>
              {step.name}
              <span className="block text-muted">{step.note}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel>
        <h3 className="font-display text-xl">Gelesener Kontext</h3>
        {facts.length === 0 ? <p className="mt-2 text-sm text-muted">Nichts extrahiert. Nichts als Fakt gespeichert.</p> : null}
        <ul className="mt-3 space-y-2">
          {file.elements.map((item) => (
            <li key={item.id} className="text-sm">
              {item.kind}: {item.rawValue} → {item.normalizedValue}
              <span className="block text-xs text-muted">{item.status} · {item.polarity} · {item.normalizationMethod} · {item.confidence}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h3 className="font-display text-xl">Quellen dieser Aufgabe</h3>
        {file.sources.length === 0 ? <p className="mt-2 text-sm text-muted">Keine Quelle zu dieser Aufgabe. Kopien zählen nicht als neue Bestätigung.</p> : null}
        <ul className="mt-3 space-y-2">
          {file.sources.map((source) => (
            <li key={source.id} className="text-sm">
              {source.title || hostOf(source.url) || "Ohne Titel"}
              <span className="block text-xs text-muted">{source.independenceStatus}{source.parentSourceId ? " · Kopie" : ""}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h3 className="font-display text-xl">Timeline</h3>
        {file.timeline.length === 0 ? <p className="mt-2 text-sm text-muted">Keine gespeicherten Ereignisse. Fehlende Angaben werden nicht geschätzt.</p> : null}
        <ul className="mt-3 space-y-2">
          {file.timeline.map((event, index) => (
            <li key={`${event.event}-${index}`} className="text-sm">
              {event.date} · {event.time} · {event.location}
              <span className="block text-muted">{event.event} · {event.sourceId}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h3 className="font-display text-xl">Widersprüche</h3>
        {file.contradictions.length === 0 ? <p className="mt-2 text-sm text-muted">Kein gespeicherter Widerspruch.</p> : null}
        <ul className="mt-3 space-y-2">
          {file.contradictions.map((item) => (
            <li key={`${item.left}-${item.right}`} className="text-sm">{item.left} / {item.right}</li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h3 className="font-display text-xl">Offene Fragen</h3>
        {file.questions.length === 0 ? <p className="mt-2 text-sm text-muted">Keine offene Frage aus den gespeicherten Angaben.</p> : null}
        <ul className="mt-3 space-y-2">
          {file.questions.map((item) => (
            <li key={item.id} className="text-sm">
              {item.question}
              <span className="block text-xs text-muted">{item.priority} · {item.status}{item.resolvedAt ? ` · ${formatWhen(item.resolvedAt)}` : ""}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h3 className="font-display text-xl">Sitzung</h3>
        <ul className="mt-3 space-y-1">
          {file.session.map((item) => (
            <li key={item.id} className="text-sm">{item.title} · {item.status} · {item.scope}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function SourceCard({ source, links }: { source: SourceDTO; links?: { people: { id: string; name: string }[]; cases: { id: string; title: string }[] } }) {
  const title = source.title || hostOf(source.url) || "Ohne Titel";
  const inner = (
    <>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted">{source.url ? hostOf(source.url) : "Keine Website"}</p>
      {source.note ? <p className="mt-3 line-clamp-3 text-sm text-muted">{source.note}</p> : null}
      {links && (links.people.length || links.cases.length) ? (
        <div className="mt-3 text-sm">
          <p className="text-xs text-muted">{LINK_NOTE}</p>
          {links.people.length ? <p className="mt-1">Verbundene Personen</p> : null}
          <ul>
            {links.people.map((person) => (
              <li key={person.id}><Link to="/people/$id" params={{ id: person.id }} className="underline">{person.name}</Link></li>
            ))}
          </ul>
          {links.cases.length ? <p className="mt-1">Verbundene Fälle</p> : null}
          <ul>
            {links.cases.map((item) => (
              <li key={item.id}><Link to="/cases/$id" params={{ id: item.id }} className="underline">{item.title}</Link></li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
  if (!source.url) return <article className="rounded-lg border border-border bg-card p-4">{inner}</article>;
  return <article className="rounded-lg border border-border bg-card p-4">{inner}{source.url ? <a className="mt-3 inline-flex min-h-11 items-center text-sm underline" href={source.url} target="_blank" rel="noreferrer">Quelle öffnen</a> : null}</article>;
}
