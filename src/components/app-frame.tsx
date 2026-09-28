import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  Brain,
  Files,
  FolderKanban,
  Library,
  Menu,
  MessageSquare,
  Scale,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import { applyTheme, type ProfileDTO } from "@/lib/domain";
import { createRecoveryCode, getProfile } from "@/lib/data.functions";
import { Button, Mark } from "@/components/ui";

type Ctx = {
  user: AppUser;
  profile: ProfileDTO | null;
  refreshProfile: () => Promise<void>;
};

const AppContext = createContext<Ctx | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp außerhalb des Rahmens");
  return ctx;
}

const NAV = [
  { to: "/", label: "Chat", icon: MessageSquare, exact: true, group: "Arbeit" },
  { to: "/cases", label: "Fälle", icon: Scale, exact: false, group: "Arbeit" },
  { to: "/people", label: "Personen", icon: Users, exact: false, group: "Arbeit" },
  { to: "/projects", label: "Projekte", icon: FolderKanban, exact: false, group: "Arbeit" },
  { to: "/research", label: "Recherche", icon: Search, exact: false, group: "Arbeit" },
  { to: "/knowledge", label: "Wissen", icon: Library, exact: false, group: "Archiv" },
  { to: "/memory", label: "Erinnerung", icon: Brain, exact: false, group: "Archiv" },
  { to: "/files", label: "Dateien", icon: Files, exact: false, group: "Archiv" },
  { to: "/agents", label: "Agenten", icon: Bot, exact: false, group: "Betrieb" },
  { to: "/activity", label: "Aktivität", icon: Activity, exact: false, group: "Betrieb" },
  { to: "/settings", label: "Einstellungen", icon: Settings, exact: false, group: "Betrieb" },
] as const;

const MOBILE = [
  { to: "/", label: "Chat", icon: MessageSquare, exact: true },
  { to: "/cases", label: "Fälle", icon: Scale, exact: false },
  { to: "/research", label: "Recherche", icon: Search, exact: false },
  { to: "/memory", label: "Erinnerung", icon: Brain, exact: false },
] as const;

const MORE = NAV.filter((item) => !MOBILE.some((mobile) => mobile.to === item.to));

function activePath(pathname: string, to: string, exact: boolean) {
  return exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
}

export function AppFrame({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const refreshProfile = async () => {
    const next = await getProfile();
    setProfile(next);
    applyTheme(next.theme);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void getProfile()
      .then((next) => {
        if (cancelled) return;
        setProfile(next);
        applyTheme(next.theme);
      })
      .catch(() => undefined);
    void createRecoveryCode()
      .then((res) => {
        if (res.code) setRecovery(res.code);
      })
      .catch(() => undefined);
    const stored = sessionStorage.getItem("liora-recovery");
    if (stored) {
      setRecovery(stored);
      sessionStorage.removeItem("liora-recovery");
    }
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    setMore(false);
  }, [pathname]);

  if (isPending || !user) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        {isPending ? (
          <div className="space-y-3 text-center">
            <p className="font-display text-4xl tracking-tight">Liora</p>
            <p className="text-sm text-muted">Wird geladen</p>
          </div>
        ) : (
          <RedirectToSignIn />
        )}
      </div>
    );
  }

  const moreActive = MORE.some((item) => activePath(pathname, item.to, item.exact));
  let lastGroup = "";

  return (
    <AppContext.Provider value={{ user, profile, refreshProfile }}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border px-3 py-5 lg:flex">
          <Link to="/" className="flex items-center gap-2.5 px-2 pb-6">
            <Mark />
            <span>
              <span className="block font-display text-2xl leading-none tracking-tight">Liora</span>
              <span className="mt-1 block text-xs text-muted">Privat</span>
            </span>
          </Link>
          <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {NAV.map((item) => {
              const active = activePath(pathname, item.to, item.exact);
              const Icon = item.icon;
              const heading = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <div key={item.to}>
                  {heading ? <p className="px-3 pt-4 pb-1 text-xs text-muted first:pt-0">{item.group}</p> : null}
                  <Link
                    to={item.to}
                    className={`flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm transition-colors duration-150 ${
                      active ? "bg-subtle text-foreground" : "text-muted hover:bg-subtle hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                    {item.label}
                  </Link>
                </div>
              );
            })}
          </nav>
          <p className="truncate px-3 pt-4 text-sm text-muted">{profile?.displayName || user.displayName || user.primaryEmail}</p>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </div>
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 backdrop-blur-sm lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {MOBILE.map((item) => {
            const active = activePath(pathname, item.to, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${active ? "text-foreground" : "text-muted"}`}
              >
                <Icon className="size-5" strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${more || moreActive ? "text-foreground" : "text-muted"}`}
            aria-expanded={more}
            onClick={() => setMore((value) => !value)}
          >
            <Menu className="size-5" strokeWidth={1.75} />
            Mehr
          </button>
        </nav>
      </div>
      {more ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-foreground/30" aria-label="Schließen" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-lg border border-border bg-card p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-sm text-muted">Weiter</p>
              <button type="button" className="inline-flex size-11 items-center justify-center" aria-label="Schließen" onClick={() => setMore(false)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {MORE.map((item) => {
                const Icon = item.icon;
                const active = activePath(pathname, item.to, item.exact);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex min-h-12 items-center gap-2 rounded-md px-3 text-sm ${active ? "bg-subtle" : "hover:bg-subtle"}`}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {recovery ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-3xl tracking-tight">Wiederherstellungscode</h2>
            <p className="mt-2 text-sm text-muted">
              Einmalig sichtbar. Damit setzt du dein Passwort zurück, wenn du ausgesperrt bist. Er wird nicht erneut angezeigt.
            </p>
            <p className="mt-4 rounded-md bg-subtle px-3 py-3 text-center font-mono text-sm tracking-wide">{recovery}</p>
            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={() => void navigator.clipboard.writeText(recovery)}>
                Kopieren
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setRecovery(null)}>
                Gespeichert
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppContext.Provider>
  );
}

export function PageHead({ title, kicker, action }: { title: string; kicker?: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 px-4 pt-5 pb-2 sm:px-8 sm:pt-7">
      <div className="min-w-0">
        {kicker ? <p className="text-xs text-muted">{kicker}</p> : null}
        <h1 className="truncate font-display text-3xl tracking-tight sm:text-4xl">{title}</h1>
      </div>
      {action}
    </header>
  );
}

export function PageBody({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full px-4 pt-3 pb-10 sm:px-8 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</div>;
}
