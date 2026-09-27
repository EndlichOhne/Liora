import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, TextArea, inputClass } from "@/components/ui";
import {
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  MEMORY_CONFIDENCE,
  MEMORY_SECTIONS,
  MEMORY_STATUS_LABEL,
  formatWhen,
  type MemoryCategory,
  type MemoryConfidence,
  type MemoryDTO,
} from "@/lib/domain";
import { listMemory, removeMemory, upsertMemory, verifyMemory } from "@/lib/data.functions";

export const Route = createFileRoute("/memory")({ component: MemoryRoute });

const EDITABLE = MEMORY_SECTIONS.map((section) => section.id);

function MemoryRoute() {
  return (
    <AppFrame>
      <MemoryPage />
    </AppFrame>
  );
}

function MemoryPage() {
  const [items, setItems] = useState<MemoryDTO[]>([]);
  const [section, setSection] = useState<MemoryCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [category, setCategory] = useState<MemoryCategory>("preference");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [confidence, setConfidence] = useState<MemoryConfidence>("");
  const [error, setError] = useState("");

  function load() {
    void listMemory()
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Erinnerungen konnten nicht geladen werden."));
  }
  useEffect(load, []);

  const counts = useMemo(() => {
    return MEMORY_SECTIONS.map((group) => ({
      ...group,
      count: items.filter((item) => group.match.includes(item.category)).length,
    }));
  }, [items]);

  const visible = items.filter((item) => {
    if (section !== "all") {
      const group = MEMORY_SECTIONS.find((entry) => entry.id === section);
      if (group && !group.match.includes(item.category)) return false;
    }
    const hay = `${item.title} ${item.content} ${item.source}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  function resetForm() {
    setEditing(null);
    setTitle("");
    setContent("");
    setSource("");
    setConfidence("");
    setCategory("preference");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Nur bestätigt"
        title="Erinnerung"
        action={
          <Button
            variant="ghost"
            onClick={() => {
              resetForm();
              setOpen((value) => !value);
            }}
          >
            {open ? "Schließen" : "Eintrag"}
          </Button>
        }
      />
      <PageBody>
        <p className="max-w-xl text-sm text-muted">
          Nichts wird still mitgeschrieben. Hier liegt nur, was du speicherst oder im Chat bestätigst. Eine Prüfung setzt du selbst.
        </p>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          <Chip active={section === "all"} onClick={() => setSection("all")} label={`Alle ${items.length}`} />
          {counts.map((group) => (
            <Chip key={group.id} active={section === group.id} onClick={() => setSection(group.id)} label={`${group.label} ${group.count}`} />
          ))}
        </div>
        <input className={`${inputClass} mt-3`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Suchen" />
        {open ? (
          <form
            className="mt-4 space-y-3 rounded-lg border border-border bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void upsertMemory({ data: { id: editing ?? undefined, category, title, content, source, confidence } })
                .then(() => {
                  resetForm();
                  setOpen(false);
                  load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen."));
            }}
          >
            <div className="flex gap-1 overflow-x-auto">
              {EDITABLE.map((item) => (
                <Chip key={item} active={category === item} onClick={() => setCategory(item)} label={CATEGORY_LABEL[item]} />
              ))}
            </div>
            <Field label="Information">
              <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required />
            </Field>
            <TextArea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Was soll bleiben?" required />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quelle">
                <input className={inputClass} value={source} onChange={(event) => setSource(event.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Sicherheit">
                <select className={inputClass} value={confidence} onChange={(event) => setConfidence(event.target.value as MemoryConfidence)}>
                  {MEMORY_CONFIDENCE.map((item) => (
                    <option key={item || "unset"} value={item}>{CONFIDENCE_LABEL[item]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Button type="submit">{editing ? "Aktualisieren" : "Speichern"}</Button>
          </form>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {items.length === 0 ? (
          <div className="mt-6">
            <Empty title="Noch nichts behalten" body="Lege einen Eintrag an oder bestätige einen Vorschlag im Chat. Beides bleibt editierbar." />
          </div>
        ) : null}
        <ul className="mt-5 space-y-2">
          {visible.map((item) => (
            <li key={item.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted">{CATEGORY_LABEL[item.category]} · {MEMORY_STATUS_LABEL[item.status]}</p>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{item.content}</p>
              <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
                <div>
                  <dt>Quelle</dt>
                  <dd className="text-foreground">{item.source || "Keine"}</dd>
                </div>
                <div>
                  <dt>Sicherheit</dt>
                  <dd className="text-foreground">{CONFIDENCE_LABEL[item.confidence]}</dd>
                </div>
                <div>
                  <dt>Angelegt</dt>
                  <dd className="text-foreground">{formatWhen(item.createdAt)}</dd>
                </div>
                <div>
                  <dt>Zuletzt geprüft</dt>
                  <dd className="text-foreground">{item.verifiedAt ? formatWhen(item.verifiedAt) : "Nie"}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOpen(true);
                    setEditing(item.id);
                    setCategory(item.category === "long_term" ? "personal" : item.category);
                    setTitle(item.title);
                    setContent(item.content);
                    setSource(item.source);
                    setConfidence(item.confidence);
                  }}
                >
                  Bearbeiten
                </Button>
                {item.status !== "verified" ? (
                  <Button variant="ghost" onClick={() => void verifyMemory({ data: { id: item.id } }).then(load)}>
                    Prüfen
                  </Button>
                ) : null}
                <Button
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm("Diesen Eintrag löschen?")) return;
                    void removeMemory({ data: { id: item.id } }).then(load);
                  }}
                >
                  Löschen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </PageBody>
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 shrink-0 rounded-full px-3 text-xs ${active ? "bg-accent text-accent-foreground" : "bg-subtle text-muted"}`}
    >
      {label}
    </button>
  );
}
