import { useState } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button, Field, Mark, inputClass } from "@/components/ui";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">("up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isPending && user) return <Navigate to="/" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (password.length < 10) throw new Error("Mindestens 10 Zeichen.");
      if (mode === "up") {
        const res = await authClient.signUp.email({ email, password, name: name.trim() || email });
        if (res.error) throw new Error(res.error.message || "Konto konnte nicht erstellt werden.");
      } else {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message || "Anmeldung fehlgeschlagen.");
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <Mark className="size-10" />
        <p className="mt-4 font-display text-4xl tracking-tight">Liora</p>
        <p className="mt-2 text-sm text-muted">Ein privates Konto. Chats, Wissen und Dateien bleiben bei dir.</p>
        <div className="mt-8 flex rounded-md bg-subtle p-1">
          <button type="button" className={`min-h-10 flex-1 rounded-sm text-sm ${mode === "up" ? "bg-card" : "text-muted"}`} onClick={() => setMode("up")}>
            Konto erstellen
          </button>
          <button type="button" className={`min-h-10 flex-1 rounded-sm text-sm ${mode === "in" ? "bg-card" : "text-muted"}`} onClick={() => setMode("in")}>
            Anmelden
          </button>
        </div>
        <form className="mt-5 space-y-3" onSubmit={(e) => void submit(e)}>
          {mode === "up" ? (
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </Field>
          ) : null}
          <Field label="E-Mail">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label="Passwort">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "up" ? "new-password" : "current-password"} required minLength={10} />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Bitte warten" : mode === "up" ? "Konto erstellen" : "Anmelden"}
          </Button>
        </form>
        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          oder
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-2">
          {GROK_PROVIDERS.map((p) => (
            <button
              key={p.providerId}
              type="button"
              className="min-h-11 w-full rounded-md border border-border text-sm hover:bg-subtle"
              onClick={() => void signIn(p.providerId, { callbackURL: "/" }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen."))}
            >
              Weiter mit {p.label}
            </button>
          ))}
        </div>
        <p className="mt-6 text-center text-sm">
          <Link to="/reset" className="text-muted underline-offset-4 hover:underline">
            Passwort zurücksetzen
          </Link>
        </p>
      </div>
    </main>
  );
}
