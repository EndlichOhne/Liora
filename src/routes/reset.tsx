import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { resetPassword } from "@/lib/data.functions";
import { Button, Field, inputClass } from "@/components/ui";

export const Route = createFileRoute("/reset")({ component: ResetPage });

function ResetPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-3xl">Passwort zurücksetzen</h1>
        <p className="mt-2 text-sm text-muted">
          Mit dem Wiederherstellungscode aus der Kontoerstellung. Ein E-Mail-Versand ist nicht angebunden, damit kein Schlüssel und kein Postfach im Browser landet.
        </p>
        {done ? (
          <p className="mt-6 text-sm">
            Passwort geändert. <Link to="/login" className="underline">Jetzt anmelden</Link>
          </p>
        ) : (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              void resetPassword({ data: { email, code, newPassword: password } })
                .then(() => setDone(true))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Zurücksetzen fehlgeschlagen."))
                .finally(() => setBusy(false));
            }}
          >
            <Field label="E-Mail">
              <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Wiederherstellungscode">
              <input className={inputClass} required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Neues Passwort">
              <input className={inputClass} type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Bitte warten" : "Passwort setzen"}
            </Button>
          </form>
        )}
        <p className="mt-6 text-sm">
          <Link to="/login" className="text-muted underline-offset-4 hover:underline">Zurück zur Anmeldung</Link>
        </p>
      </div>
    </main>
  );
}
