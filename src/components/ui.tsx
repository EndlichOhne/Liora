import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-foreground hover:opacity-90"
      : variant === "danger"
        ? "bg-transparent text-danger border border-danger/40 hover:bg-danger/10"
        : "bg-transparent text-foreground hover:bg-subtle";
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full min-h-11 rounded-md border border-border bg-card px-3 text-base text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10";

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputClass} min-h-24 py-3 leading-normal ${props.className ?? ""}`}
    />
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card p-4 sm:p-5 ${className}`}>{children}</section>
  );
}

export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <span className={`grid place-items-center rounded-md bg-accent text-accent-foreground ${className}`} aria-hidden>
      <svg viewBox="0 0 16 16" className="h-1/2 w-1/2">
        <path d="M3.5 2.5h2.2v8.8h6.8V13.5H3.5z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8">
      <p className="font-display text-2xl tracking-tight">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}

export function Tone({ tone, children }: { tone: "ok" | "warn" | "error" | "open"; children: ReactNode }) {
  const color =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "error" ? "text-danger" : "text-muted";
  return <span className={`text-xs ${color}`}>{children}</span>;
}
