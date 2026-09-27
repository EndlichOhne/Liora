import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Panel, TextArea, Tone } from "@/components/ui";
import { formatWhen } from "@/lib/domain";
import { loadRuns, runAgents } from "@/lib/intelligence/functions";
import type { RunDTO } from "@/lib/intelligence/types";
import { AGENT_ORDER, agentLabel } from "@/lib/labels";

export const Route = createFileRoute("/agents")({ component: AgentsRoute });

function AgentsRoute() {
  return (
    <AppFrame>
      <AgentsPage />
    </AppFrame>
  );
}

function AgentsPage() {
  const [runs, setRuns] = useState<RunDTO[]>([]);
  const [task, setTask] = useState("");
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  function load() {
    void loadRuns()
      .then(setRuns)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Läufe konnten nicht geladen werden."));
  }
  useEffect(load, []);

  const cards = useMemo(() => {
    return AGENT_ORDER.map((name) => {
      const mine = runs.filter((run) => run.agent === name);
      const last = mine[0];
      const failed = mine.filter((run) => run.status === "failed").length;
      const durations = mine.map((run) => run.durationMs).filter((value): value is number => value != null);
      const median = durations.length ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null;
      return { name, last, count: mine.length, failed, median };
    });
  }, [runs]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead kicker="Betrieb" title="Agenten" />
      <PageBody wide>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => {
            const tone = card.failed ? "warn" : card.count ? "ok" : "open";
            const label = card.failed ? "Hinweis" : card.last ? (card.last.status === "done" ? "In Ordnung" : card.last.status) : "Offen";
            return (
              <article key={card.name} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-medium">{agentLabel(card.name)}</h2>
                  <Tone tone={tone}>{label}</Tone>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                  <div>
                    <dt>Letzter Lauf</dt>
                    <dd className="text-foreground">{card.last ? formatWhen(card.last.startedAt) : "Keiner"}</dd>
                  </div>
                  <div>
                    <dt>Aufgaben</dt>
                    <dd className="text-foreground">{card.count}</dd>
                  </div>
                  <div>
                    <dt>Fehler</dt>
                    <dd className="text-foreground">{card.failed}</dd>
                  </div>
                  <div>
                    <dt>Dauer</dt>
                    <dd className="text-foreground">{card.median != null ? `${card.median} ms` : "Keine Messung"}</dd>
                  </div>
                </dl>
                {card.last?.summary ? <p className="mt-3 line-clamp-2 text-sm text-muted">{card.last.summary}</p> : null}
              </article>
            );
          })}
        </div>
        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void runAgents({ data: { task, web } })
              .then((res) => {
                setResult(`${res.decision.reason} ${res.outputs.map((item) => `${agentLabel(item.agent)}: ${item.summary}`).join(" ")}`);
                setTask("");
                load();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Lauf fehlgeschlagen."))
              .finally(() => setBusy(false));
          }}
        >
          <Panel>
            <h2 className="font-medium">Auftrag</h2>
            <p className="mt-1 text-sm text-muted">
              Die Route entscheidet, welche Agenten laufen. Websuche nur, wenn du sie anschaltest. Kurze Aufgaben ohne Spezialagenten bleiben bei der Orchestrierung.
            </p>
            <div className="mt-3 space-y-3">
              <TextArea value={task} onChange={(event) => setTask(event.target.value)} placeholder="Was soll eingeordnet, geprüft oder recherchiert werden?" required minLength={8} />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
                Eine Websuche erlauben
              </label>
              <Button type="submit" disabled={busy}>{busy ? "Läuft" : "Ausführen"}</Button>
            </div>
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            {result ? <p className="mt-3 text-sm">{result}</p> : null}
          </Panel>
        </form>
        {runs.length === 0 ? (
          <div className="mt-6">
            <Empty title="Noch kein Lauf" body="Status, Fehler und Dauer entstehen erst, wenn ein Agent wirklich gelaufen ist." />
          </div>
        ) : null}
      </PageBody>
    </div>
  );
}
