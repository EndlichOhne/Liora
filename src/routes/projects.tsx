import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { AppFrame, PageBody, PageHead } from "@/components/app-frame";
import { Button, Empty, Field, TextArea, inputClass } from "@/components/ui";
import { formatWhen, type ProjectDTO } from "@/lib/domain";
import { listProjectPage, upsertProject } from "@/lib/data.functions";

export const Route = createFileRoute("/projects")({ component: ProjectsRoute });

function ProjectsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const child = pathname.startsWith("/projects/") && pathname !== "/projects";
  return <AppFrame>{child ? <Outlet /> : <ProjectsPage />}</AppFrame>;
}

function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  function load() {
    void listProjectPage()
      .then((next) => {
        setProjects(next);
        if (!next.length) setOpen(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Projekte konnten nicht geladen werden."));
  }

  useEffect(load, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead
        kicker="Arbeit"
        title="Projekte"
        action={
          <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? "Schließen" : "Neu"}
          </Button>
        }
      />
      <PageBody>
        {open ? (
          <form
            className="mb-5 space-y-3 rounded-lg border border-border bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void upsertProject({ data: { name, summary, contextNotes: "" } })
                .then((res) => navigate({ to: "/projects/$id", params: { id: res.id } }))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Konnte nicht angelegt werden."));
            }}
          >
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <TextArea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Worum geht es?" />
            <Button type="submit">Anlegen</Button>
          </form>
        ) : null}
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        {projects.length === 0 ? (
          <Empty title="Noch kein Projekt" body="Ein Projekt bündelt Chats, Dateien, Aufgaben und Notizen. Der Kontext geht nur in die Chats dieses Projekts." />
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link to="/projects/$id" params={{ id: project.id }} className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors duration-150 hover:bg-subtle">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-subtle font-display text-lg">
                    {project.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{project.name}</span>
                    <span className="mt-1 block text-sm text-muted">{project.summary || "Ohne Kurzbeschreibung"}</span>
                    <span className="mt-2 block text-xs text-muted">{formatWhen(project.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </div>
  );
}
