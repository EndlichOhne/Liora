import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, Panel, TextArea, inputClass } from "@/components/ui";
import { formatDay, formatWhen } from "@/lib/domain";
import { archiveFact, loadKnowledge, markChecked, takeIn } from "@/lib/intelligence/functions";
import type { KnowledgeDTO, KnowledgeStatus, PipelineStep } from "@/lib/intelligence/types";

export const Route = createFileRoute("/knowledge")({ component: KnowledgeRoute });

const STATUS: Record<KnowledgeStatus, string> = {
  unverified: "Ungeprüft",
  current: "Aktuell",
  stale: "Veraltet",
  conflicted: "Widerspruch",
  superseded: "Ersetzt",
  rejected: "Abgelehnt",
};

function KnowledgeRoute() {
  return (
    <AppFrame>
      <KnowledgePage />
    </AppFrame>
  );
}

function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeDTO[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<KnowledgeStatus | "all">("all");
  const [topic, setTopic] = useState("all");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState("");
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [open, setOpen] = useState(false);

  function load() {
    void loadKnowledge()
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Wissen konnte nicht geladen werden."));
  }
  useEffect(load, []);

  const topics = useMemo(() => {
    const set = new Set(items.map((item) => item.topic).filter(Boolean));
    return [...set];
  }, [items]);

  const filtered = items.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (topic !== "all" && item.topic !== topic) return false;
    const hay = `${item.topic} ${item.statement} ${item.sourceLabel}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  const months = new Map<string, KnowledgeDTO[]>();
  for (const item of filtered) {
    const key = item.updatedAt.slice(0, 7) || "ohne";
    const list = months.get(key) ?? [];
    list.push(item);
    months.set(key, list);
  }

  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Bestand"
        title="Wissen"
        action={
          <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? "Schließen" : "Aufnehmen"}
          </Button>
        }
      />
      <PageBody wide>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(STATUS) as KnowledgeStatus[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus((current) => (current === key ? "all" : key))}
              className={`rounded-lg border px-3 py-3 text-left ${status === key ? "border-foreground bg-subtle" : "border-border bg-card"}`}
            >
              <p className="font-display text-2xl tracking-tight">{counts[key] ?? 0}</p>
              <p className="text-xs text-muted">{STATUS[key]}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Suchen" />
          <select className={inputClass} value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="all">Alle Themen</option>
            {topics.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {open ? (
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void takeIn({ data: { body, url, title, verified, queue: false } })
                .then((res) => {
                  if (!res.queued) {
                    setNote(res.result.note);
                    setSteps(res.result.steps);
                  }
                  setBody("");
                  setUrl("");
                  setTitle("");
                  setVerified(false);
                  load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Aufnahme fehlgeschlagen."));
            }}
          >
            <Panel>
              <h2 className="font-medium">Neue Information</h2>
              <p className="mt-1 text-sm text-muted">Ohne deine Prüfung bleibt sie ungeprüft und wird nicht als Fakt verwendet.</p>
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
                  <Button type="submit">Prüfen und speichern</Button>
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
                        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Vormerken fehlgeschlagen."));
                    }}
                  >
                    Nur vormerken
                  </Button>
                </div>
              </div>
            </Panel>
          </form>
        ) : null}
        {note ? (
          <Panel className="mt-4">
            <p className="text-sm">{note}</p>
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
        {items.length === 0 ? (
          <div className="mt-6">
            <Empty title="Noch kein Wissen" body="Aufgenommene Aussagen erscheinen hier mit Status, Quelle und Prüfzeit. Vorher wird nichts gezählt." />
          </div>
        ) : null}
        <div className="mt-8 space-y-8">
          {[...months.entries()].map(([month, group]) => (
            <section key={month}>
              <h2 className="text-xs text-muted">{monthLabel(month)}</h2>
              <ul className="mt-3 space-y-2 border-l border-border pl-4">
                {group.map((item) => (
                  <li key={item.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{item.topic || "Ohne Thema"}</p>
                      <p className="text-xs text-muted">{STATUS[item.status]}</p>
                    </div>
                    <p className="mt-2 text-sm">{item.statement}</p>
                    <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
                      <div>
                        <dt>Quelle</dt>
                        <dd className="text-foreground">{item.sourceLabel || "Keine"}</dd>
                      </div>
                      <div>
                        <dt>Aktualität</dt>
                        <dd className="text-foreground">{STATUS[item.status]} · {item.origin}</dd>
                      </div>
                      <div>
                        <dt>Zuletzt</dt>
                        <dd className="text-foreground">{item.lastVerifiedAt ? `geprüft ${formatWhen(item.lastVerifiedAt)}` : `geändert ${formatDay(item.updatedAt)}`}</dd>
                      </div>
                    </dl>
                    {item.status !== "rejected" && item.status !== "superseded" ? (
                      <div className="mt-3 flex gap-2">
                        <Button
                          onClick={() => {
                            void markChecked({ data: { id: item.id } })
                              .then(load)
                              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Prüfen fehlgeschlagen."));
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
            </section>
          ))}
        </div>
      </PageBody>
    </div>
  );
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}
