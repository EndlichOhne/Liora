import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { authClient, getBearerToken, signOut } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";
import { AppFrame, PageHead, useApp } from "@/components/app-frame";
import { Button, Field, inputClass, TextArea } from "@/components/ui";
import { KNOWN_MODELS, VOICES, applyTheme, type ResponseStyle, type ThemeChoice } from "@/lib/domain";
import { downloadExport, removeAccount, replaceRecoveryCode, saveProfile } from "@/lib/data.functions";
import { loadModels } from "@/lib/intelligence/functions";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const child = pathname.startsWith("/settings/") && pathname !== "/settings";
  return <AppFrame>{child ? <Outlet /> : <SettingsPage />}</AppFrame>;
}

function SettingsPage() {
  const { profile, refreshProfile, user } = useApp();
  const [displayName, setDisplayName] = useState("");
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [writingNotes, setWritingNotes] = useState("");
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>("balanced");
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [modelId, setModelId] = useState("grok-4.5");
  const [voiceId, setVoiceId] = useState("eve");
  const [voiceAuto, setVoiceAuto] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [notify, setNotify] = useState<NotificationPermission | "unsupported">("default");
  const [catalog, setCatalog] = useState<string[]>([]);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setLanguage(profile.language);
    setWritingNotes(profile.writingNotes);
    setResponseStyle(profile.responseStyle);
    setTheme(profile.theme);
    setModelId(profile.modelId);
    setVoiceId(profile.voiceId);
    setVoiceAuto(profile.voiceAuto);
  }, [profile]);

  useEffect(() => {
    setNotify(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  useEffect(() => {
    void loadModels()
      .then(setCatalog)
      .catch(() => undefined);
  }, []);

  async function persist(patch?: Partial<{ voiceAuto: boolean; theme: ThemeChoice; language: "de" | "en" }>) {
    setError("");
    const next = await saveProfile({
      data: {
        displayName,
        language: patch?.language ?? language,
        writingNotes,
        responseStyle,
        theme: patch?.theme ?? theme,
        modelId,
        voiceId,
        voiceAuto: patch?.voiceAuto ?? voiceAuto,
      },
    });
    applyTheme(next.theme);
    await refreshProfile();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getBearerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (displayName.trim()) {
      await fetch("/api/auth/update-user", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ name: displayName.trim() }),
      }).catch(() => undefined);
    }
    setNotice("Gespeichert.");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHead kicker="Konto" title="Einstellungen" />
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 sm:px-6">
        {notice ? <p className="text-sm text-ok">{notice}</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Account</h2>
          <UserButton />
          <p className="text-sm text-muted">{user.primaryEmail}</p>
          <p className="text-sm"><Link to="/settings/security" className="underline">Sicherheit</Link></p>
          <Field label="Name">
            <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          {profile?.hasPassword ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                void authClient
                  .changePassword({ currentPassword, newPassword, revokeOtherSessions: true })
                  .then((res) => {
                    if (res.error) throw new Error(res.error.message || "Passwort nicht geändert.");
                    setCurrentPassword("");
                    setNewPassword("");
                    setNotice("Passwort geändert.");
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Passwort nicht geändert."));
              }}
            >
              <Field label="Aktuelles Passwort">
                <input className={inputClass} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              <Field label="Neues Passwort">
                <input className={inputClass} type="password" minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Button type="submit">Passwort ändern</Button>
            </form>
          ) : (
            <p className="text-sm text-muted">Dieses Konto meldet sich über Google oder X an. Dafür gibt es hier kein Passwort.</p>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              void replaceRecoveryCode()
                .then((res) => setCode(res.code))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Code konnte nicht erzeugt werden."));
            }}
          >
            Neuen Wiederherstellungscode erzeugen
          </Button>
          {code ? <p className="rounded-md bg-subtle px-3 py-2 font-mono text-sm">{code}</p> : null}
          <p className="text-xs text-muted">
            Face ID und Touch ID sind kein eigener Login dieser App. Auf dem iPhone schützt die Gerätesperre die installierte App. Passkeys sind hier nicht angebunden.
          </p>
          <Button variant="ghost" onClick={() => void signOut("/login").catch((err: unknown) => setError(err instanceof Error ? err.message : "Abmelden fehlgeschlagen."))}>
            Abmelden
          </Button>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Sprache, Ton, Darstellung</h2>
          <Field label="Antwortsprache, wenn deine Nachricht die Sprache nicht vorgibt">
            <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "de")}>
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
            </select>
          </Field>
          <Field label="Antwortstil">
            <select className={inputClass} value={responseStyle} onChange={(e) => setResponseStyle(e.target.value as ResponseStyle)}>
              <option value="concise">Knapp</option>
              <option value="balanced">Ausgewogen</option>
              <option value="thorough">Gründlich</option>
            </select>
          </Field>
          <Field label="Schreibhinweise">
            <TextArea value={writingNotes} onChange={(e) => setWritingNotes(e.target.value)} placeholder="Zum Beispiel: sieze mich, kurze Absätze, kein Fachjargon." />
          </Field>
          <Field label="Theme">
            <select
              className={inputClass}
              value={theme}
              onChange={(e) => {
                const next = e.target.value as ThemeChoice;
                setTheme(next);
                applyTheme(next);
              }}
            >
              <option value="system">System</option>
              <option value="light">Hell</option>
              <option value="dark">Dunkel</option>
            </select>
          </Field>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">KI-Modell</h2>
          <p className="text-sm text-muted">
            Aktiv ist xAI. Der Schlüssel bleibt auf dem Server. Die abgerufene Modellliste aus System erscheint hier zusätzlich. Gespeichert wird nur, was du auswählst. Nichts wechselt von allein.
          </p>
          <Field label="Modell">
            <select
              className={inputClass}
              value={[...KNOWN_MODELS.map((model) => model.id), ...catalog].includes(modelId) ? modelId : "custom"}
              onChange={(event) => {
                if (event.target.value !== "custom") setModelId(event.target.value);
              }}
            >
              {KNOWN_MODELS.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
              {catalog.filter((id) => !KNOWN_MODELS.some((model) => model.id === id)).map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
              <option value="custom">Eigene ID</option>
            </select>
          </Field>
          <Field label="Modell-ID">
            <input className={inputClass} value={modelId} onChange={(e) => setModelId(e.target.value)} spellCheck={false} />
          </Field>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Stimme</h2>
          <Field label="Stimme">
            <select className={inputClass} value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {VOICES.map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={voiceAuto} onChange={(e) => setVoiceAuto(e.target.checked)} />
            Antworten automatisch vorlesen
          </label>
          <p className="text-xs text-muted">Spracheingabe nutzt die Spracherkennung des Browsers. Die Ausgabe läuft über die serverseitige Stimme.</p>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Benachrichtigungen</h2>
          {notify === "unsupported" ? (
            <p className="text-sm text-muted">Dieser Browser kann keine Mitteilungen anzeigen.</p>
          ) : (
            <>
              <p className="text-sm text-muted">Status: {notify === "granted" ? "erlaubt" : notify === "denied" ? "blockiert" : "noch nicht gefragt"}. Wenn der Tab im Hintergrund ist, meldet Liora eine fertige Antwort.</p>
              <Button
                variant="ghost"
                onClick={() => {
                  void Notification.requestPermission().then((perm) => setNotify(perm));
                }}
              >
                Mitteilungen erlauben
              </Button>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Daten</h2>
          <p className="text-sm text-muted">Export enthält Profil, Chats, Erinnerungen, Projekte und Dateinamen. Bilddaten bleiben in der App.</p>
          <Button
            variant="ghost"
            onClick={() => {
              void downloadExport().then((data) => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "liora-export.json";
                a.click();
                URL.revokeObjectURL(url);
              });
            }}
          >
            Daten exportieren
          </Button>
          <Field label="Account löschen — tippe LÖSCHEN">
            <input className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button
            variant="danger"
            onClick={() => {
              void removeAccount({ data: { confirm } })
                .then(() => {
                  window.location.href = "/login";
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen."));
            }}
          >
            Account endgültig löschen
          </Button>
        </section>

        <Button onClick={() => void persist().catch((err: unknown) => setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen."))}>
          Einstellungen speichern
        </Button>
      </div>
    </div>
  );
}
