import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Empty } from "@/components/ui";
import { uploadClientFile } from "@/components/chat-page";
import { formatBytes, formatWhen, type FileDTO } from "@/lib/domain";
import { listLibrary, removeFile } from "@/lib/data.functions";

export const Route = createFileRoute("/files")({ component: FilesRoute });

function FilesRoute() {
  return (
    <AppFrame>
      <FilesPage />
    </AppFrame>
  );
}

const ACTIONS = ["Fasse das Dokument zusammen.", "Finde Fehler und Unklarheiten.", "Zieh die wichtigsten Punkte als Tabelle."];

function FilesPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileDTO[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    void listLibrary({ data: { projectId: null } })
      .then(setFiles)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Dateien konnten nicht geladen werden."));
  }

  useEffect(load, []);

  function openWith(file: FileDTO, prompt: string, autosend: boolean) {
    sessionStorage.setItem("liora-prefill", JSON.stringify({ file, prompt, autosend }));
    void navigate({ to: "/" });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Bibliothek"
        title="Dateien"
        action={
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-accent px-3 text-sm text-accent-foreground">
            {busy ? "Lädt" : "Hochladen"}
            <input
              type="file"
              className="sr-only"
              accept=".pdf,.docx,.txt,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.md,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                void uploadClientFile(file)
                  .then(() => load())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Upload fehlgeschlagen."))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
        }
      />
      <PageBody>
        <p className="text-sm text-muted">PDF, DOCX, TXT, CSV, XLSX und Bilder. Der Text wird beim Upload gelesen und im Chat wirklich mitgeschickt.</p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {files.length === 0 ? (
          <div className="mt-5">
            <Empty title="Noch keine Datei" body="Lade ein Dokument oder Bild hoch. Die Aktionen darunter öffnen einen echten Chat mit diesem Anhang." />
          </div>
        ) : null}
        <div className="mt-4 space-y-3">
        {files.map((file) => (
          <article key={file.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex gap-3">
              {file.imageData ? <img src={file.imageData} alt="" className="size-16 rounded-md object-cover" /> : null}
              <div className="min-w-0">
                <h2 className="truncate font-medium">{file.name}</h2>
                <p className="text-xs text-muted">
                  {file.kind} · {formatBytes(file.sizeBytes)} · {formatWhen(file.createdAt)}
                </p>
                {file.excerpt ? <p className="mt-2 line-clamp-3 text-sm text-muted">{file.excerpt}</p> : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ACTIONS.map((prompt) => (
                <button key={prompt} type="button" className="min-h-10 rounded-full bg-subtle px-3 text-xs" onClick={() => openWith(file, prompt, true)}>
                  {prompt.replace(/\.$/, "")}
                </button>
              ))}
              <button type="button" className="min-h-10 rounded-full bg-subtle px-3 text-xs" onClick={() => openWith(file, "", false)}>
                Im Chat öffnen
              </button>
              <button
                type="button"
                className="min-h-10 px-3 text-xs text-danger"
                onClick={() => void removeFile({ data: { id: file.id } }).then(load)}
              >
                Löschen
              </button>
            </div>
          </article>
        ))}
        </div>
      </PageBody>
    </div>
  );
}
