import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PageHead } from "@/components/app-frame";
import { Button, Field, Panel, TextArea, inputClass } from "@/components/ui";
import type { SystemTab } from "@/routes/system";
import { formatWhen } from "@/lib/domain";
import {
  archiveFact,
  askRollback,
  compareModels,
  fetchModels,
  fixError,
  keepSnapshot,
  loadClaims,
  loadErrors,
  loadGaps,
  loadKnowledge,
  loadModels,
  loadProposals,
  loadRuns,
  loadSystem,
  markChecked,
  resolveGap,
  runAgents,
  runCycle,
  settleProposal,
  takeIn,
  testModel,
} from "@/lib/intelligence/functions";
import type {
  ClaimDTO,
  CycleReport,
  ErrorDTO,
  GapDTO,
  KnowledgeDTO,
  KnowledgeStatus,
  ProposalDTO,
  RunDTO,
  SystemBoard,
} from "@/lib/intelligence/types";

const TABS: { id: SystemTab; label: string }[] = [
  { id: "board", label: "Überblick" },
  { id: "wissen", label: "Wissen" },
  { id: "fehler", label: "Fehler" },
  { id: "agenten", label: "Agenten" },
  { id: "freigabe", label: "Freigabe" },
  { id: "tests", label: "Tests" },
  { id: "modelle", label: "Modelle" },
];

const STATUS: Record<KnowledgeStatus, string> = {
  unverified: "Ungeprüft",
  current: "Aktuell",
  stale: "Veraltet",
  conflicted: "Widerspruch",
  superseded: "Ersetzt",
  rejected: "Abgelehnt",
};

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : "Das hat nicht geklappt.";
}

export function SystemPage({ tab }: { tab: SystemTab }) {
  const navigate = useNavigate();
  const [board, setBoard] = useState<SystemBoard | null>(null);
  const [error, setError] = useState("");

  function refresh() {
    return loadSystem()
      .then(setBoard)
      .catch((err: unknown) => setError(messageOf(err)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead kicker="Betrieb" title="System" />
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <p className="max-w-2xl text-sm text-muted">
          Liora lernt nur, was geprüft und gespeichert wurde. Zahlen hier sind Zählungen, keine Schätzungen. Produktion, Schlüssel und Rechte ändern sich nicht von selbst.
        </p>
        <div className="mt-4 flex gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`min-h-11 shrink-0 rounded-full px-3 text-sm ${tab === item.id ? "bg-accent text-accent-foreground" : "text-muted hover:bg-subtle"}`}
              onClick={() => void navigate({ to: "/system", search: { tab: item.id } })}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
        <div className="mt-5">
          {tab === "board" ? <Board board={board} onError={setError} onDone={() => void refresh()} /> : null}
          {tab === "wissen" ? <Knowledge onError={setError} onDone={() => void refresh()} /> : null}
          {tab === "fehler" ? <Errors onError={setError} /> : null}
          {tab === "agenten" ? <Agents onError={setError} onDone={() => void refresh()} /> : null}
          {tab === "freigabe" ? <Proposals onError={setError} onDone={() => void refresh()} /> : null}
          {tab === "tests" ? <Tests board={board} onError={setError} onDone={() => void refresh()} /> : null}
          {tab === "modelle" ? <Models board={board} onError={setError} onDone={() => void refresh()} /> : null}
        </div>
      </div>
    </div>
  );
}

function Board({ board, onError, onDone }: { board: SystemBoard | null; onError: (value: string) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const report = board?.latestCycle?.report ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void runCycle()
              .then(() => onDone())
              .catch((err: unknown) => onError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Zyklus läuft" : "Tageszyklus starten"}
        </Button>
        <p className="text-sm text-muted">Morgen zählen, tagsüber Eingänge verarbeiten, abends Veraltung, nachts der interne Test. Keine Modellanfrage.</p>
      </div>
      {report ? <Report report={report} /> : (
        <Panel>
          <h2 className="font-display text-2xl">Noch kein Bericht</h2>
          <p className="mt-2 text-sm text-muted">Was sich verbessert hat, steht hier erst nach einem Zyklus. Vorher wird nichts erfunden.</p>
        </Panel>
      )}
      <section>
        <h2 className="font-display text-2xl">Bestand</h2>
        <p className="mt-1 text-sm text-muted">Direkt aus deiner Datenbank. Eine Null ist eine Null.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label="Aktuelle Fakten" value={board ? String(board.inventory.knowledge.current) : "–"} hint="Geprüft und nicht älter als 30 Tage, sonst setzt der Zyklus sie auf veraltet." />
          <Metric label="Ungeprüft" value={board ? String(board.inventory.knowledge.unverified) : "–"} hint="Gespeichert, aber nicht als Fakt verwendet." />
          <Metric label="Widersprüche" value={board ? String(board.inventory.knowledge.conflicted) : "–"} hint="Beide Seiten bleiben stehen." />
          <Metric label="Veraltet" value={board ? String(board.inventory.knowledge.stale) : "–"} hint="Zuletzt vor mehr als 30 Tagen geprüft." />
          <Metric label="Quellen" value={board ? String(board.inventory.sources) : "–"} hint={board ? `${board.inventory.sourcesChecked} davon mit Prüfzeitpunkt` : " "} />
          <Metric label="Erinnerungen" value={board ? String(board.inventory.memories) : "–"} hint={board ? `${board.inventory.rules} aktive Regeln` : " "} />
          <Metric label="Offene Lücken" value={board ? String(board.inventory.gapsOpen) : "–"} hint="Nicht mit einer Vermutung gefüllt." />
          <Metric label="Fehler" value={board ? String(board.inventory.errors) : "–"} hint={board ? `${board.inventory.errorsCorrected} mit Korrektur` : " "} />
          <Metric label="Offene Freigaben" value={board ? String(board.inventory.proposalsPending) : "–"} hint="Nichts davon ist schon live." />
        </div>
      </section>
      <div className="grid gap-2 sm:grid-cols-3">
        <Panel>
          <p className="text-sm text-muted">Modell</p>
          <p className="mt-1 font-medium">{board?.modelId || "–"}</p>
          <p className="mt-2 text-xs text-muted">Wechsel nur in den Einstellungen.</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted">Latenz</p>
          <p className="mt-1 font-medium">{board?.latency ? `${board.latency.medianMs} ms` : "Keine Messung"}</p>
          <p className="mt-2 text-xs text-muted">{board?.latency ? `Median aus ${board.latency.n} ${board.latency.n === 1 ? "Lauf" : "Läufen"}` : "Entsteht durch Chat, Zyklus oder Agenten."}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted">Aufrufe, 2 Tage</p>
          <p className="mt-1 font-medium">{board ? `${board.inventory.usageChat} Chat · ${board.inventory.usageResearch} Recherche` : "–"}</p>
          <p className="mt-2 text-xs text-muted">Ältere Ereignisse können verschwinden. Deshalb nur dieses Fenster.</p>
        </Panel>
      </div>
      {board?.versions.length ? (
        <Panel>
          <h2 className="font-medium">Versionen</h2>
          <ul className="mt-3 divide-y divide-border text-sm">
            {board.versions.map((version) => (
              <li key={version.kind} className="flex items-baseline justify-between gap-3 py-2">
                <span>{version.label}</span>
                <span className="text-muted">{version.note}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {board && board.cycles.filter((cycle) => cycle.report).length > 1 ? (
        <Panel>
          <h2 className="font-medium">Frühere Zyklen</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Zeit</th>
                  <th className="py-2 pr-3 font-medium">Neu</th>
                  <th className="py-2 pr-3 font-medium">Widerspruch</th>
                  <th className="py-2 pr-3 font-medium">Test</th>
                </tr>
              </thead>
              <tbody>
                {board.cycles.filter((cycle) => cycle.report).map((cycle) => (
                  <tr key={cycle.id} className="border-t border-border">
                    <td className="py-2 pr-3">{formatWhen(cycle.startedAt)}</td>
                    <td className="py-2 pr-3">{cycle.report?.knowledgeCreated}</td>
                    <td className="py-2 pr-3">{cycle.report?.contradictions}</td>
                    <td className="py-2 pr-3">{cycle.report?.benchPassed} / {(cycle.report?.benchPassed ?? 0) + (cycle.report?.benchFailed ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      <Panel>
        <h2 className="font-medium">Design</h2>
        <p className="mt-2 text-sm text-muted">Ein System für die ganze App. Keine zweiten Farben, keine zweiten Schriften.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Swatch className="bg-background" label="Grund" />
          <Swatch className="bg-card" label="Fläche" />
          <Swatch className="bg-subtle" label="Leise" />
          <Swatch className="bg-accent text-accent-foreground" label="Akzent" />
        </div>
        <p className="mt-4 font-display text-3xl tracking-tight">Newsreader für Titel</p>
        <p className="mt-1 text-sm">Outfit für Text, IBM Plex Mono für Kennungen.</p>
      </Panel>
    </div>
  );
}

function Report({ report }: { report: CycleReport }) {
  const rows = [
    ["Eingänge zu Beginn", report.intakeWaiting],
    ["Davon verarbeitet", report.intakeProcessed],
    ["Neue Quellen", report.sourcesAdded],
    ["Neue Wissenseinträge", report.knowledgeCreated],
    ["Zeilen mit Änderung", report.rowsTouched],
    ["Widersprüche berührt", report.contradictions],
    ["Fehler notiert", report.errorsFound],
    ["Davon korrigiert", report.errorsCorrected],
    ["Lücken geöffnet", report.gapsOpened],
    ["Lücken geschlossen", report.gapsClosed],
    ["Auf veraltet gesetzt", report.staleMarked],
    ["Ungeprüft seit über 7 Tagen", report.weakUnverified],
    ["Tests bestanden", report.benchPassed],
    ["Tests nicht bestanden", report.benchFailed],
    ["Hinweise in Antworten", report.selfCheckFlags],
    ["Neue Freigaben", report.proposalsOpened],
  ] as const;
  return (
    <Panel>
      <h2 className="font-display text-2xl">Seit diesem Zyklus</h2>
      <p className="mt-1 text-sm text-muted">{formatWhen(report.from)} bis {formatWhen(report.to)}. Nur dieses Fenster.</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 font-display text-3xl tracking-tight">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-muted">
        {report.benchRegressed == null
          ? "Erster Testlauf in der Reihe. Kein Vergleich mit einem früheren Lauf."
          : report.benchRegressed
            ? "Der Test ist schlechter als der vorherige. Code wurde nicht zurückgesetzt."
            : "Der Test ist nicht schlechter als der vorherige Lauf."}
      </p>
    </Panel>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <div className={`grid h-16 w-24 place-items-end rounded-md border border-border p-2 text-xs ${className}`}>{label}</div>
  );
}

function Knowledge({ onError, onDone }: { onError: (value: string) => void; onDone: () => void }) {
  const [items, setItems] = useState<KnowledgeDTO[]>([]);
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState("");
  const [steps, setSteps] = useState<{ name: string; outcome: string; note: string }[]>([]);

  function load() {
    void loadKnowledge().then(setItems).catch((err: unknown) => onError(messageOf(err)));
  }
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void takeIn({ data: { body, url, title, verified, queue: false } })
            .then((res) => {
              if (!res.queued) {
                setNote(res.result.note);
                setSteps(res.result.steps);
              }
              setBody("");
              load();
              onDone();
            })
            .catch((err: unknown) => onError(messageOf(err)));
        }}
      >
        <Panel>
          <h2 className="font-medium">Neue Information</h2>
          <p className="mt-1 text-sm text-muted">Quelle, Qualität, Duplikat, Widerspruch. Ohne deine Prüfung bleibt sie ungeprüft.</p>
          <div className="mt-3 space-y-3">
            <TextArea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Die Aussage, wörtlich." required />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quelle, optional">
                <input className={inputClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />
              </Field>
              <Field label="Titel, optional">
                <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
              Ich habe das selbst geprüft
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Pipeline</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void takeIn({ data: { body, url, title, verified: false, queue: true } })
                    .then(() => {
                      setNote("In die Warteschlange gelegt. Der Tageszyklus verarbeitet sie.");
                      setSteps([]);
                      setBody("");
                    })
                    .catch((err: unknown) => onError(messageOf(err)));
                }}
              >
                Nur vormerken
              </Button>
            </div>
          </div>
        </Panel>
      </form>
      {note ? (
        <Panel>
          <p className="font-medium">{note}</p>
          <ol className="mt-3 space-y-2 text-sm">
            {steps.map((step) => (
              <li key={step.name}>
                <span className="text-muted">{step.name} · {step.outcome === "pass" ? "ok" : step.outcome === "fail" ? "hinweis" : "stopp"}</span>
                <span className="mt-0.5 block">{step.note}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
      {items.length === 0 ? <p className="text-sm text-muted">Noch kein Wissen.</p> : null}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">{item.topic}</p>
              <p className="text-xs text-muted">{STATUS[item.status]} · {item.origin}</p>
            </div>
            <p className="mt-2 text-sm">{item.statement}</p>
            <p className="mt-2 text-xs text-muted">
              {item.sourceLabel || "Keine Quelle"} · {item.lastVerifiedAt ? `geprüft ${formatWhen(item.lastVerifiedAt)}` : "nie geprüft"}
            </p>
            {item.status !== "rejected" && item.status !== "superseded" ? (
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => {
                    void markChecked({ data: { id: item.id } }).then(() => { load(); onDone(); }).catch((err: unknown) => onError(messageOf(err)));
                  }}
                >
                  Als geprüft
                </Button>
                <Button variant="ghost" onClick={() => void archiveFact({ data: { id: item.id } }).then(load)}>
                  Archivieren
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Errors({ onError }: { onError: (value: string) => void }) {
  const [items, setItems] = useState<ErrorDTO[]>([]);
  const [gaps, setGaps] = useState<GapDTO[]>([]);
  const [claims, setClaims] = useState<ClaimDTO[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { correction: string; source: string }>>({});

  function load() {
    void Promise.all([loadErrors(), loadGaps(), loadClaims()])
      .then(([nextErrors, nextGaps, nextClaims]) => {
        setItems(nextErrors);
        setGaps(nextGaps);
        setClaims(nextClaims);
      })
      .catch((err: unknown) => onError(messageOf(err)));
  }
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-display text-2xl">Fehlergedächtnis</h2>
        <p className="text-sm text-muted">Entsteht, wenn du im Chat sagst, dass etwas falsch war. Die alte Antwort bleibt stehen.</p>
        {items.length === 0 ? <p className="text-sm text-muted">Noch kein Fehler notiert.</p> : null}
        {items.map((item) => {
          const draft = drafts[item.id] ?? { correction: "", source: "" };
          return (
            <article key={item.id} className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="text-muted">{formatWhen(item.createdAt)} · {item.cause}</p>
              <p className="mt-2"><span className="text-muted">Antwort. </span>{item.originalAnswer || "Keine vorherige Antwort."}</p>
              <p className="mt-2"><span className="text-muted">Hinweis. </span>{item.errorText}</p>
              <p className="mt-2"><span className="text-muted">Lehre. </span>{item.lesson}</p>
              {item.correction ? <p className="mt-2">Korrektur: {item.correction}</p> : (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void fixError({ data: { id: item.id, correction: draft.correction, source: draft.source } })
                      .then(load)
                      .catch((err: unknown) => onError(messageOf(err)));
                  }}
                >
                  <TextArea
                    value={draft.correction}
                    placeholder="Was stimmt stattdessen?"
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, correction: event.target.value } }))}
                  />
                  <input
                    className={inputClass}
                    value={draft.source}
                    placeholder="Quelle, optional"
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, source: event.target.value } }))}
                  />
                  <Button type="submit">Korrektur speichern</Button>
                </form>
              )}
            </article>
          );
        })}
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-2xl">Lücken</h2>
        {gaps.length === 0 ? <p className="text-sm text-muted">Keine offene Lücke.</p> : null}
        {gaps.map((gap) => (
          <article key={gap.id} className="rounded-lg border border-border bg-card p-4 text-sm">
            <p className="text-muted">{gap.status === "open" ? "Offen" : "Geschlossen"}</p>
            <p className="mt-2">{gap.question}</p>
            <p className="mt-2 text-muted">{gap.missing}</p>
            {gap.resolution ? <p className="mt-2">{gap.resolution}</p> : (
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void resolveGap({ data: { id: gap.id, resolution: String(data.get("resolution") ?? "") } })
                    .then(load)
                    .catch((err: unknown) => onError(messageOf(err)));
                }}
              >
                <input name="resolution" className={inputClass} placeholder="Womit ist die Lücke zu?" required />
                <Button type="submit">Schließen</Button>
              </form>
            )}
          </article>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-2xl">Belege</h2>
        {claims.length === 0 ? <p className="text-sm text-muted">Noch keine Verifikation.</p> : null}
        {claims.map((claim) => (
          <article key={claim.id} className="rounded-lg border border-border bg-card p-4 text-sm">
            <p className="text-muted">{claim.status} · {formatWhen(claim.createdAt)}</p>
            <p className="mt-2">{claim.claim}</p>
            <p className="mt-2 text-muted">{claim.primaryNote}</p>
            <p className="text-muted">{claim.secondaryNote}</p>
            <p className="text-muted">{claim.conflictNote}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function Agents({ onError, onDone }: { onError: (value: string) => void; onDone: () => void }) {
  const [task, setTask] = useState("");
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [runs, setRuns] = useState<RunDTO[]>([]);

  function load() {
    void loadRuns().then(setRuns).catch((err: unknown) => onError(messageOf(err)));
  }
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-medium">Orchestrator</h2>
        <p className="mt-1 text-sm text-muted">
          Kurze Fragen bleiben schnell. Recherche, Prüfung und Analyse laufen nur, wenn die Aufgabe es hergibt. Unabhängige Agenten parallel, die Prüfung danach. Websuche nur, wenn du sie anschaltest.
        </p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void runAgents({ data: { task, web } })
              .then((res) => {
                setResult(`${res.decision.mode} · ${res.tierLabel} · Modell bleibt ${res.model}. ${res.decision.reason} ${res.outputs.map((item) => item.summary).join(" ")}`);
                setTask("");
                load();
                onDone();
              })
              .catch((err: unknown) => onError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          <TextArea value={task} onChange={(event) => setTask(event.target.value)} placeholder="Was soll geprüft, recherchiert oder nur eingeordnet werden?" required />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
            Eine Websuche erlauben
          </label>
          <Button type="submit" disabled={busy}>{busy ? "Läuft" : "Ausführen"}</Button>
        </form>
        {result ? <p className="mt-3 text-sm">{result}</p> : null}
      </Panel>
      {runs.length === 0 ? <p className="text-sm text-muted">Noch kein Lauf.</p> : null}
      <ul className="space-y-2">
        {runs.map((run) => (
          <li key={run.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <p className="text-muted">{run.agent} · {run.mode} · {run.tier} · {run.status}{run.durationMs != null ? ` · ${run.durationMs} ms` : ""}</p>
            <p className="mt-1">{run.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Proposals({ onError, onDone }: { onError: (value: string) => void; onDone: () => void }) {
  const [items, setItems] = useState<ProposalDTO[]>([]);
  function load() {
    void loadProposals().then(setItems).catch((err: unknown) => onError(messageOf(err)));
  }
  useEffect(load, []);
  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-medium">Änderungskontrolle</h2>
        <p className="mt-1 text-sm text-muted">
          Vorschläge dürfen Tests und Sandbox-Läufe beschreiben. Eine Freigabe ändert keinen Produktionscode, keinen Schlüssel, keine Rechte und löscht keine Erinnerung. Nur ein ausdrücklicher Wissens-Rollback setzt gespeicherte Status zurück.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => void keepSnapshot().then(() => { load(); onDone(); }).catch((err: unknown) => onError(messageOf(err)))}
          >
            Wissensstand sichern
          </Button>
          <Button
            variant="ghost"
            onClick={() => void askRollback().then(load).catch((err: unknown) => onError(messageOf(err)))}
          >
            Rollback vorschlagen
          </Button>
        </div>
      </Panel>
      {items.length === 0 ? <p className="text-sm text-muted">Keine Vorschläge.</p> : null}
      {items.map((item) => (
        <article key={item.id} className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="text-muted">{item.agent} · {item.kind} · {item.risk} · {item.status}</p>
          <h3 className="mt-1 text-base font-medium">{item.title}</h3>
          <p className="mt-2 whitespace-pre-wrap text-muted">{item.body}</p>
          {item.effect ? <p className="mt-2">{item.effect}</p> : null}
          {item.status === "pending" ? (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void settleProposal({ data: { id: item.id, approve: true } }).then(() => { load(); onDone(); })}>Freigeben</Button>
              <Button variant="ghost" onClick={() => void settleProposal({ data: { id: item.id, approve: false } }).then(load)}>Ablehnen</Button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function Tests({ board, onError, onDone }: { board: SystemBoard | null; onError: (value: string) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-medium">Interner Testsatz</h2>
        <p className="mt-1 text-sm text-muted">
          Feste Prüfungen der Lernregeln: Duplikat, Widerspruch, Route, Veraltung, Quelle, Freigabe. Keine erfundenen Qualitätsnoten. Ein schlechterer Lauf erzeugt einen Hinweis, setzt den Code aber nicht zurück.
        </p>
        <Button
          className="mt-3"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void runCycle()
              .then(() => onDone())
              .catch((err: unknown) => onError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Läuft" : "Tests mit dem Zyklus ausführen"}
        </Button>
        {board?.bench ? (
          <p className="mt-3 text-sm">
            Letzter Lauf {formatWhen(board.bench.at)}: {board.bench.passed} bestanden, {board.bench.failed} nicht, {board.bench.latencyMs} ms.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">Noch kein Lauf.</p>
        )}
        {board?.bench?.failures.length ? (
          <ul className="mt-2 text-sm text-danger">
            {board.bench.failures.map((item) => (
              <li key={item.id}>{item.id}: {item.detail}</li>
            ))}
          </ul>
        ) : null}
      </Panel>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {(board?.cases ?? []).map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
            <span>{item.title}</span>
            <span className="text-muted">{item.dimension}</span>
          </li>
        ))}
      </ul>
      {board?.recentFlags.length ? (
        <Panel>
          <h2 className="font-medium">Hinweise aus Antworten</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {board.recentFlags.map((item) => (
              <li key={item.id}>
                <p className="text-muted">{formatWhen(item.createdAt)}</p>
                {item.flags.map((flag) => (
                  <p key={flag.code}>{flag.detail}</p>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function Models({ board, onError, onDone }: { board: SystemBoard | null; onError: (value: string) => void; onDone: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [probe, setProbe] = useState("");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [compare, setCompare] = useState("");

  function load() {
    void loadModels().then(setIds).catch((err: unknown) => onError(messageOf(err)));
  }
  useEffect(load, []);

  const choices = ids.length ? ids : board?.modelId ? [board.modelId] : [];

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-medium">Modellliste</h2>
        <p className="mt-1 text-sm text-muted">
          Namen kommen von der xAI-Liste, nicht aus einer fest eingebauten Rangliste. Ein neues Modell wird vorgeschlagen, nie still gewechselt. Eingestellt ist {board?.modelId || "–"}.
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            void fetchModels()
              .then((res) => {
                setAdded(res.added);
                setIds(res.ids);
                onDone();
              })
              .catch((err: unknown) => onError(messageOf(err)));
          }}
        >
          Liste abrufen
        </Button>
        {added.length ? <p className="mt-3 text-sm">Neu in diesem Abruf: {added.join(", ")}. Nicht gewechselt.</p> : null}
        {ids.length === 0 ? <p className="mt-3 text-sm text-muted">Noch keine abgerufene Liste.</p> : null}
      </Panel>
      {choices.length ? (
        <Panel>
          <h2 className="font-medium">Kurztest</h2>
          <p className="mt-1 text-sm text-muted">Eine Anfrage. Bestanden heißt: die Antwort ist exakt OK. Sonst nichts.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select className={inputClass} value={left} onChange={(event) => setLeft(event.target.value)}>
              <option value="">Modell wählen</option>
              {choices.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <Button
              disabled={!left}
              onClick={() => {
                void testModel({ data: { modelId: left } })
                  .then((res) => setProbe(`${res.modelId}: ${res.passed ? "bestanden" : "nicht bestanden"}, ${res.latencyMs} ms. Antwort: ${res.output || "leer"}`))
                  .catch((err: unknown) => onError(messageOf(err)));
              }}
            >
              Testen
            </Button>
          </div>
          {probe ? <p className="mt-3 text-sm">{probe}</p> : null}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <select className={inputClass} value={right} onChange={(event) => setRight(event.target.value)}>
              <option value="">Zweites Modell</option>
              {choices.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <Button
              variant="ghost"
              disabled={!left || !right}
              onClick={() => {
                void compareModels({ data: { modelA: left, modelB: right } })
                  .then((res) => setCompare(res.reason))
                  .catch((err: unknown) => onError(messageOf(err)));
              }}
            >
              A gegen B
            </Button>
          </div>
          {compare ? <p className="mt-3 text-sm">{compare}</p> : null}
        </Panel>
      ) : null}
      <ul className="text-sm text-muted">
        {ids.map((id) => (
          <li key={id} className="border-b border-border py-2">{id}</li>
        ))}
      </ul>
    </div>
  );
}
