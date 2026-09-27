import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, Panel, TextArea, inputClass } from "@/components/ui";
import { formatDay, formatWhen, hostOf } from "@/lib/domain";
import { routeTask } from "@/lib/intelligence/engine";
import { loadClaims, loadSources, runAgents } from "@/lib/intelligence/functions";
import type { ClaimDTO, SourceDTO } from "@/lib/intelligence/types";
import { agentLabel } from "@/lib/labels";

export const Route = createFileRoute("/research")({ component: ResearchRoute });

type Output = { agent: string; summary: string; detail: Record<string, unknown> };

function ResearchRoute() {
  return (
    <AppFrame>
      <ResearchPage />
    </AppFrame>
  );
}

function ResearchPage() {
  const [task, setTask] = useState("");
  const [web, setWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [sources, setSources] = useState<SourceDTO[]>([]);
  const [claims, setClaims] = useState<ClaimDTO[]>([]);
  const [query, setQuery] = useState("");

  function loadLibrary() {
    void Promise.all([loadSources(), loadClaims()])
      .then(([nextSources, nextClaims]) => {
        setSources(nextSources);
        setClaims(nextClaims);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Quellen konnten nicht geladen werden."));
  }

  useEffect(loadLibrary, []);

  const preview = useMemo(() => (task.trim().length >= 8 ? routeTask(task) : null), [task]);
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
                setOutputs([]);
                void runAgents({ data: { task, web } })
                  .then((res) => {
                    setReason(res.decision.reason);
                    setOutputs(res.outputs);
                    setTask("");
                    loadLibrary();
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Recherche fehlgeschlagen."))
                  .finally(() => setBusy(false));
              }}
            >
              <TextArea value={task} onChange={(event) => setTask(event.target.value)} placeholder="Was soll belegt werden?" required minLength={8} />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
                Websuche erlauben
              </label>
              <Button type="submit" disabled={busy}>{busy ? "Läuft" : "Recherche starten"}</Button>
            </form>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <AgentRail busy={busy} preview={preview} outputs={outputs} reason={reason} />
            <AnalysisTrail outputs={outputs} />
          </div>
          <aside className="space-y-3">
            <p className="text-xs text-muted">Gespeicherte Quellen</p>
            <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Quellen filtern" />
            <p className="text-xs text-muted">{visible.length} von {sources.length}</p>
          </aside>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {sources.length === 0 ? (
            <Empty title="Noch keine Quelle" body="Eine Recherche mit Websuche speichert zurückgegebene Quellen. Ohne Treffer bleibt die Liste leer." />
          ) : null}
          {visible.map((source) => (
            <SourceCard key={source.id} source={source} />
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

function SourceCard({ source }: { source: SourceDTO }) {
  const title = source.title || hostOf(source.url) || "Ohne Titel";
  const when = source.publishedAt || formatDay(source.createdAt);
  const inner = (
    <>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted">{source.url ? hostOf(source.url) : "Keine Website"}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
        <div>
          <dt>Datum</dt>
          <dd className="text-foreground">{when || "Keins"}</dd>
        </div>
        <div>
          <dt>Art</dt>
          <dd className="text-foreground">{source.kind || "Unbekannt"}</dd>
        </div>
        <div className="col-span-2">
          <dt>Zuverlässigkeit</dt>
          <dd className="text-foreground">{source.reliability || "Nicht bewertet"}</dd>
        </div>
      </dl>
      {source.note ? <p className="mt-3 line-clamp-3 text-sm text-muted">{source.note}</p> : null}
    </>
  );
  if (!source.url) return <article className="rounded-lg border border-border bg-card p-4">{inner}</article>;
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:bg-subtle">
      {inner}
    </a>
  );
}

function AgentRail({
  busy,
  preview,
  outputs,
  reason,
}: {
  busy: boolean;
  preview: ReturnType<typeof routeTask> | null;
  outputs: Output[];
  reason: string;
}) {
  const names = busy
    ? preview?.agents ?? []
    : outputs.map((item) => item.agent);
  if (!names.length && !reason) return null;
  return (
    <Panel>
      <p className="text-xs text-muted">{busy ? "Geplante Agenten" : "Letzter Lauf"}</p>
      {reason && !busy ? <p className="mt-2 text-sm">{reason}</p> : null}
      <ul className="mt-3 space-y-2">
        {names.map((name) => {
          const output = outputs.find((item) => item.agent === name);
          const waiting = busy && preview?.agents.includes("verification") && name === "verification" && preview.parallel.includes(name) === false;
          const state = output
            ? typeof output.detail.error === "string"
              ? "fehlgeschlagen"
              : "abgeschlossen"
            : busy
              ? waiting
                ? "wartet"
                : "arbeitet"
              : "kein Ergebnis";
          return (
            <li key={name} className="flex items-baseline justify-between gap-3 text-sm">
              <span>{agentLabel(name)}</span>
              <span className={state === "fehlgeschlagen" ? "text-danger" : "text-muted"}>{state}</span>
            </li>
          );
        })}
      </ul>
      {preview && busy ? <p className="mt-3 text-xs text-muted">{preview.reason}</p> : null}
    </Panel>
  );
}

function AnalysisTrail({ outputs }: { outputs: Output[] }) {
  const research = outputs.find((item) => item.agent === "research");
  const verification = outputs.find((item) => item.agent === "verification");
  const analysis = outputs.find((item) => item.agent === "analysis");
  if (!research && !verification && !analysis) return null;
  const conflicts = Number(verification?.detail.conflicts ?? 0);
  const primary = Number(verification?.detail.primary ?? 0);
  const secondary = Number(verification?.detail.secondary ?? 0);
  const rows: { label: string; value: string }[] = [];
  if (analysis || verification || research) rows.push({ label: "Analyse", value: "gestartet" });
  if (research) rows.push({ label: "Recherche", value: research.summary });
  if (verification) {
    rows.push({ label: "Belege", value: primary ? `${primary} Primärquelle(n)` : "Keine Primärquelle" });
    rows.push({ label: "Abgleich", value: secondary ? `${secondary} weitere Quelle(n)` : "Keine weitere Quelle" });
    rows.push({ label: "Widersprüche", value: conflicts ? `${conflicts} im gespeicherten Text` : "Keine im gespeicherten Text" });
    rows.push({ label: "Prüfung", value: String(verification.detail.status ?? verification.summary) });
  }
  if (analysis) rows.push({ label: "Struktur", value: analysis.summary });
  return (
    <Panel>
      <h2 className="font-display text-2xl tracking-tight">Ergebnis</h2>
      <dl className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-1 border-t border-border pt-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
