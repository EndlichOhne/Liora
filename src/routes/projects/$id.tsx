import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHead } from "@/components/app-frame";
import { Button, Field, inputClass, TextArea } from "@/components/ui";
import type { ConversationDTO, FileDTO, NoteDTO, ProjectDTO, TaskDTO } from "@/lib/domain";
import {
  createTask,
  loadProject,
  removeNote,
  removeProject,
  removeTask,
  setTaskDone,
  upsertNote,
  upsertProject,
} from "@/lib/data.functions";

export const Route = createFileRoute("/projects/$id")({ component: ProjectRoute });

function ProjectRoute() {
  const { id } = Route.useParams();
  return <ProjectPage id={id} />;
}

function ProjectPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  const [files, setFiles] = useState<FileDTO[]>([]);
  const [chats, setChats] = useState<ConversationDTO[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [error, setError] = useState("");

  function load() {
    void loadProject({ data: { id } })
      .then((res) => {
        setProject(res.project);
        setTasks(res.tasks);
        setNotes(res.notes);
        setFiles(res.files);
        setChats(res.chats);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Projekt nicht gefunden."));
  }

  useEffect(load, [id]);

  if (!project) {
    return (
      <div className="p-6 text-sm text-muted">
        {error || "Wird geladen"}
        <div className="mt-3">
          <Link to="/projects" className="underline">Alle Projekte</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Projekt"
        title={project.name}
        action={
          <Link to="/" search={{ project: project.id }} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-sm text-accent-foreground">
            Chat
          </Link>
        }
      />
      <div className="mx-auto grid max-w-3xl gap-4 px-4 py-5 sm:px-8">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Count label="Chats" value={chats.length} />
          <Count label="Dateien" value={files.length} />
          <Count label="Aufgaben" value={tasks.length} />
          <Count label="Notizen" value={notes.length} />
        </dl>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <form
          className="space-y-3 rounded-lg border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void upsertProject({
              data: { id: project.id, name: project.name, summary: project.summary, contextNotes: project.contextNotes },
            }).then(load);
          }}
        >
          <Field label="Name">
            <input className={inputClass} value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
          </Field>
          <Field label="Kurz">
            <input className={inputClass} value={project.summary} onChange={(e) => setProject({ ...project, summary: e.target.value })} />
          </Field>
          <Field label="Kontext für die KI">
            <TextArea value={project.contextNotes} onChange={(e) => setProject({ ...project, contextNotes: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Speichern</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!window.confirm("Projekt und zugehörige Notizen löschen? Chats bleiben erhalten.")) return;
                void removeProject({ data: { id: project.id } }).then(() => navigate({ to: "/projects" }));
              }}
            >
              Löschen
            </Button>
          </div>
        </form>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Aufgaben</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createTask({ data: { projectId: project.id, title: taskTitle } }).then(() => {
                setTaskTitle("");
                load();
              });
            }}
          >
            <input className={inputClass} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Neue Aufgabe" />
            <Button type="submit">Hinzufügen</Button>
          </form>
          <ul className="mt-3 space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={task.done}
                  className="size-4"
                  onChange={(e) => void setTaskDone({ data: { id: task.id, done: e.target.checked } }).then(load)}
                />
                <span className={task.done ? "text-muted line-through" : ""}>{task.title}</span>
                <button type="button" className="ml-auto text-xs text-muted" onClick={() => void removeTask({ data: { id: task.id } }).then(load)}>
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Notizen</h2>
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void upsertNote({ data: { projectId: project.id, title: noteTitle, body: noteBody } }).then(() => {
                setNoteTitle("");
                setNoteBody("");
                load();
              });
            }}
          >
            <input className={inputClass} value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Titel" />
            <TextArea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Notiz" />
            <Button type="submit">Notiz speichern</Button>
          </form>
          <ul className="mt-4 space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="border-t border-border pt-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{note.title}</p>
                  <button type="button" className="text-xs text-muted" onClick={() => void removeNote({ data: { id: note.id } }).then(load)}>
                    Löschen
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted">{note.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Chats</h2>
          <ul className="mt-2 space-y-1">
            {chats.length === 0 ? <li className="text-sm text-muted">Noch keine Chats in diesem Projekt.</li> : null}
            {chats.map((chat) => (
              <li key={chat.id}>
                <Link to="/" search={{ c: chat.id, project: project.id }} className="block min-h-11 py-2 text-sm hover:underline">
                  {chat.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Dateien</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {files.length === 0 ? <li className="text-muted">Noch keine Dateien diesem Projekt zugeordnet.</li> : null}
            {files.map((file) => (
              <li key={file.id}>{file.name}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <p className="font-display text-2xl tracking-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
