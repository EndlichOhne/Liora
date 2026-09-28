import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageBody, PageHead } from "@/components/app-frame";
import { formatWhen } from "@/lib/domain";
import { loadSecurity } from "@/lib/security/functions";

export const Route = createFileRoute("/settings/security")({ component: SecurityPage });

type Report = Awaited<ReturnType<typeof loadSecurity>>;

function SecurityPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadSecurity()
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Der Sicherheitsbericht konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead kicker="Konto" title="Sicherheit" />
      <PageBody>
        <p className="text-sm"><Link to="/settings" className="underline">Einstellungen</Link></p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {!report && !error ? <p className="mt-3 text-sm text-muted">Wird geladen</p> : null}
        {report ? (
          <>
            <p className="mt-4 text-sm">{report.line}</p>
            <p className="mt-2 text-sm text-muted">Diese Sitzung ist angemeldet. Andere Sitzungen werden nicht aufgelistet.</p>
            <ul className="mt-4 grid gap-2">
              {report.checks.map((item) => (
                <li key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <p>{item.id} · {item.status}</p>
                  <p className="mt-1 text-muted">{item.note}</p>
                </li>
              ))}
            </ul>
            <section className="mt-6">
              <h2 className="font-display text-2xl tracking-tight">Protokoll</h2>
              <p className="mt-1 text-sm text-muted">Nur Aktion, Ressource und Ergebnis. Keine Schlüssel und keine Dokumentinhalte.</p>
              {report.events.length === 0 ? <p className="mt-3 text-sm text-muted">Noch kein Eintrag.</p> : null}
              <ul className="mt-3 grid gap-2">
                {report.events.map((event, index) => (
                  <li key={`${event.action}-${event.createdAt}-${index}`} className="text-sm">
                    {event.action} · {event.result}
                    <span className="block text-muted">{event.resource} · {event.createdAt ? formatWhen(event.createdAt) : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="mt-6">
              <h2 className="font-display text-2xl tracking-tight">Export</h2>
              <p className="mt-1 text-sm text-muted">Ein Export enthält nur Daten dieses Kontos. Eine erneute Anmeldung davor ist nicht eingerichtet.</p>
            </section>
          </>
        ) : null}
      </PageBody>
    </div>
  );
}
