import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Panel, Tone } from "@/components/ui";
import { formatBytes, formatWhen } from "@/lib/domain";
import { listLibrary } from "@/lib/data.functions";
import { loadRuns, loadSystem, runCycle } from "@/lib/intelligence/functions";
import type { RunDTO, SystemBoard } from "@/lib/intelligence/types";
import { agentLabel } from "@/lib/labels";

export const Route = createFileRoute("/activity")({ component: ActivityRoute });

function ActivityRoute() {
  return (
    <AppFrame>
      <ActivityPage />
    </AppFrame>
  );
}

function ActivityPage() {
  const [board, setBoard] = useState<SystemBoard | null>(null);
  const [runs, setRuns] = useState<RunDTO[]>([]);
  const [bytes, setBytes] = useState<number | null>(null);
  const [files, setFiles] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    void Promise.all([loadSystem(), loadRuns(), listLibrary({ data: { projectId: null } })])
      .then(([nextBoard, nextRuns, nextFiles]) => {
        setBoard(nextBoard);
        setRuns(nextRuns);
        setFiles(nextFiles.length);
        setBytes(nextFiles.reduce((sum, file) => sum + file.sizeBytes, 0));
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Aktivität konnte nicht geladen werden."));
  }
  useEffect(load, []);

  const failed = runs.filter((run) => run.status === "failed").length;
  const knowledgeWarn = (board?.inventory.knowledge.conflicted ?? 0) > 0 || (board?.inventory.knowledge.stale ?? 0) > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Zustand"
        title="Aktivität"
        action={
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void runCycle()
                .then(() => load())
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Zyklus fehlgeschlagen."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Zyklus läuft" : "Tageszyklus"}
          </Button>
        }
      />
      <PageBody wide>
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Health
            label="Datenbank"
            tone={error && !board ? "error" : board ? "ok" : "open"}
            status={error && !board ? "Fehler" : board ? "In Ordnung" : "Offen"}
            detail={board ? "Bestand gelesen" : "Noch keine Antwort"}
          />
          <Health
            label="Antwortzeit"
            tone={board?.latency ? "ok" : "open"}
            status={board?.latency ? "Gemessen" : "Offen"}
            detail={board?.latency ? `Median ${board.latency.medianMs} ms aus ${board.latency.n} Läufen` : "Keine Messung"}
          />
          <Health
            label="Wissen"
            tone={!board ? "open" : knowledgeWarn ? "warn" : "ok"}
            status={!board ? "Offen" : knowledgeWarn ? "Hinweis" : "In Ordnung"}
            detail={board ? `${board.inventory.knowledge.current} aktuell · ${board.inventory.knowledge.conflicted} Widerspruch · ${board.inventory.knowledge.stale} veraltet` : "Noch nicht gelesen"}
          />
          <Health
            label="Erinnerung"
            tone={board ? "ok" : "open"}
            status={board ? "Gelesen" : "Offen"}
            detail={board ? `${board.inventory.memories} Einträge · ${board.inventory.rules} Regeln` : "Noch nicht gelesen"}
          />
          <Health
            label="Agenten"
            tone={!runs.length ? "open" : failed ? "warn" : "ok"}
            status={!runs.length ? "Offen" : failed ? "Hinweis" : "In Ordnung"}
            detail={runs.length ? `${runs.length} letzte Läufe · ${failed} fehlgeschlagen` : "Noch kein Lauf"}
          />
          <Health
            label="Dateien"
            tone={bytes == null ? "open" : "ok"}
            status={bytes == null ? "Offen" : "Gemessen"}
            detail={bytes == null ? "Noch nicht gelesen" : `${files ?? 0} Dateien${files === 100 ? ", letzte 100" : ""} · ${formatBytes(bytes)}`}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link to="/system" search={{ tab: "board" }} className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-subtle">Messungen</Link>
          <Link to="/system" search={{ tab: "freigabe" }} className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-subtle">
            Freigaben{board ? ` · ${board.inventory.proposalsPending}` : ""}
          </Link>
          <Link to="/system" search={{ tab: "fehler" }} className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-subtle">Fehler</Link>
          <Link to="/system" search={{ tab: "modelle" }} className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-subtle">Modelle</Link>
        </div>
        <section className="mt-8">
          <h2 className="font-display text-2xl tracking-tight">Verlauf</h2>
          {runs.length === 0 ? (
            <div className="mt-3">
              <Empty title="Noch keine Aktivität" body="Chat, Recherche und Agentenläufe schreiben hier einen Eintrag. Vorher bleibt der Verlauf leer." />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
              {runs.map((run) => (
                <li key={run.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p>{agentLabel(run.agent)}</p>
                    <p className="text-xs text-muted">{formatWhen(run.startedAt)}{run.durationMs != null ? ` · ${run.durationMs} ms` : ""}</p>
                  </div>
                  <p className="mt-1 text-muted">{run.status} · {run.mode} · {run.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        {board?.latestCycle?.report ? (
          <Panel className="mt-6">
            <h2 className="font-display text-2xl tracking-tight">Letzter Zyklus</h2>
            <p className="mt-1 text-sm text-muted">{formatWhen(board.latestCycle.report.from)} bis {formatWhen(board.latestCycle.report.to)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Neues Wissen" value={board.latestCycle.report.knowledgeCreated} />
              <Stat label="Widersprüche" value={board.latestCycle.report.contradictions} />
              <Stat label="Tests bestanden" value={board.latestCycle.report.benchPassed} />
              <Stat label="Tests nicht bestanden" value={board.latestCycle.report.benchFailed} />
            </dl>
          </Panel>
        ) : null}
      </PageBody>
    </div>
  );
}

function Health({ label, tone, status, detail }: { label: string; tone: "ok" | "warn" | "error" | "open"; status: string; detail: string }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm">{label}</h2>
        <Tone tone={tone}>{status}</Tone>
      </div>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-display text-3xl tracking-tight">{value}</dd>
    </div>
  );
}
