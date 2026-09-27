import { useEffect, useState } from "react";
import { Button, Empty, Field, inputClass } from "@/components/ui";
import {
  CONFIDENCE_LABEL,
  FEATURE_KEYS,
  FEATURE_KEY_LABEL,
  KIND_LABEL,
  ORIGIN_LABEL,
  ORIGINS,
  PRIORITY_LABEL,
  isFeatureKey,
  isOrigin,
  type Origin,
} from "@/lib/cases/discovery";
import { EVIDENCE, EVIDENCE_LABEL, REGION_LABEL, STATUS_LABEL, CASE_TYPE_LABEL, isCaseStatus, isCaseType, isEvidence, isRegion } from "@/lib/cases/engine";
import { addCaseFeature, compareFeatures, loadDiscovery } from "@/lib/cases/functions";
import { DERIVED_KIND_LABEL } from "@/lib/cases/derive";
import { formatWhen } from "@/lib/domain";

type View = Awaited<ReturnType<typeof loadDiscovery>>;
type Insight = View["insights"][number];

const USER_ORIGINS = ORIGINS.filter((origin) => origin !== "ai_derived");

function labelPriority(value: string) {
  return value in PRIORITY_LABEL ? PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL] : value;
}

function labelConfidence(value: string) {
  return value in CONFIDENCE_LABEL ? CONFIDENCE_LABEL[value as keyof typeof CONFIDENCE_LABEL] : value;
}

function labelKind(value: string) {
  return value in KIND_LABEL ? KIND_LABEL[value as keyof typeof KIND_LABEL] : value;
}

function featureName(key: string) {
  if (isFeatureKey(key)) return FEATURE_KEY_LABEL[key];
  if (key === "case_type") return "Art";
  if (key === "case_status") return "Status";
  if (key === "region") return "Region";
  if (key === "weekday") return "Wochentag";
  return key;
}

function featureValue(key: string, value: string) {
  if (key === "case_type" && isCaseType(value)) return CASE_TYPE_LABEL[value];
  if (key === "case_status" && isCaseStatus(value)) return STATUS_LABEL[value];
  if (key === "region" && isRegion(value)) return REGION_LABEL[value];
  return value;
}

function InsightCard({ item }: { item: Insight }) {
  const full = item.priority === "high" || item.priority === "critical_review";
  return (
    <article className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted">
        {labelKind(item.kind)} · {labelPriority(item.priority)} · {labelConfidence(item.confidence)}
        {item.version > 1 ? ` · Version ${item.version}` : ""}
        {item.createdAt ? ` · ${formatWhen(item.createdAt)}` : ""}
      </p>
      <h3 className="mt-1 text-base">{item.title}</h3>
      <p className="mt-2 text-sm leading-relaxed">{item.reason}</p>
      {item.marks ? <p className="mt-2 text-sm"><span className="text-muted">Datenklasse. </span>{item.marks}</p> : null}
      {item.rarity ? <p className="mt-2 text-sm"><span className="text-muted">Seltenheit. </span>{item.rarity}</p> : null}
      {item.featureNote ? <p className="mt-2 text-sm"><span className="text-muted">Merkmale. </span>{item.featureNote}</p> : null}
      <p className="mt-2 text-sm"><span className="text-muted">Alternative. </span>{item.alternative}</p>
      <p className="mt-2 text-sm"><span className="text-muted">Gegenprüfung. </span>{item.disconfirmation}</p>
      <p className="mt-2 text-sm"><span className="text-muted">Quellenlage. </span>{item.officialNote}</p>
      {full && item.calculations.length ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-sm text-muted">Berechnung</p>
          <ul className="mt-1 grid gap-1 text-sm">
            {item.calculations.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      ) : null}
      {full && item.differences.length ? (
        <div className="mt-3">
          <p className="text-sm text-muted">Unterschiede</p>
          <ul className="mt-1 grid gap-1 text-sm">{item.differences.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      ) : null}
      {full && item.unknown.length ? (
        <div className="mt-3">
          <p className="text-sm text-muted">Unbekannt</p>
          <ul className="mt-1 grid gap-1 text-sm">{item.unknown.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      ) : null}
      {full && item.nextQuestions.length ? (
        <div className="mt-3">
          <p className="text-sm text-muted">Nächste öffentliche Fragen</p>
          <ul className="mt-1 grid gap-1 text-sm">{item.nextQuestions.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      ) : null}
      {full ? (
        <ol className="mt-3 grid gap-1 border-t border-border pt-3 text-sm">
          {item.chain.map((step, index) => (
            <li key={`${item.id}-${index}`}>{step}</li>
          ))}
        </ol>
      ) : null}
      {item.method ? <p className="mt-2 text-xs text-muted">Verfahren {item.method}</p> : null}
      {item.sources.length ? (
        <ul className="mt-2 grid gap-1">
          {item.sources.map((source) => (
            <li key={source}><a className="block truncate text-sm underline" href={source} target="_blank" rel="noreferrer">{source}</a></li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function DiscoveryPanel({ caseId = "" }: { caseId?: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [key, setKey] = useState<(typeof FEATURE_KEYS)[number]>("merkmal");
  const [value, setValue] = useState("");
  const [origin, setOrigin] = useState<Origin>("media_report");
  const [evidence, setEvidence] = useState<(typeof EVIDENCE)[number]>("reported");
  const [sourceUrl, setSourceUrl] = useState("");

  function load() {
    return loadDiscovery({ data: { caseId } })
      .then(setView)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Der Vergleich konnte nicht geladen werden."));
  }

  useEffect(() => {
    void load();
  }, [caseId]);

  const high = view?.insights.filter((item) => item.priority === "high" || item.priority === "critical_review").length ?? 0;

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-tight">Querverbindungen</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Nur gespeicherte Merkmale. Zeit, Ort und Häufigkeit werden daraus gerechnet. Fehlt eine Angabe, steht dort unzureichende Daten. Seltenheit gilt nur in diesem Aktenbestand und ist keine Wahrscheinlichkeit. Ein gemeinsames Detail ist kein Zusammenhang und keine Person.
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void compareFeatures()
              .then((result) => {
                setNote(result.note);
                return load();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Der Vergleich ist fehlgeschlagen."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Vergleicht" : "Merkmale vergleichen"}
        </Button>
      </div>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <p className="mt-3 text-xs text-muted">
        {view ? `${view.insights.length} aktuelle Ergebnisse · ${high} zur Prüfung · ${view.history.length} ältere Versionen` : "Wird gelesen"}
      </p>

      {caseId ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            void addCaseFeature({ data: { caseId, key, value, origin, evidence, sourceUrl } })
              .then((result) => {
                setValue("");
                setSourceUrl("");
                setNote(result.note);
                return load();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Das Merkmal wurde nicht gespeichert."));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Merkmal">
              <select className={inputClass} value={key} onChange={(event) => { if (isFeatureKey(event.target.value)) setKey(event.target.value); }}>
                {FEATURE_KEYS.map((item) => <option key={item} value={item}>{FEATURE_KEY_LABEL[item]}</option>)}
              </select>
            </Field>
            <Field label="Herkunft">
              <select className={inputClass} value={origin} onChange={(event) => { if (isOrigin(event.target.value)) setOrigin(event.target.value); }}>
                {USER_ORIGINS.map((item) => <option key={item} value={item}>{ORIGIN_LABEL[item]}</option>)}
              </select>
            </Field>
            <Field label="Klasse">
              <select className={inputClass} value={evidence} onChange={(event) => { if (isEvidence(event.target.value)) setEvidence(event.target.value); }}>
                {EVIDENCE.map((item) => <option key={item} value={item}>{EVIDENCE_LABEL[item]}</option>)}
              </select>
            </Field>
            <Field label="Quelle">
              <input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Wert aus der Quelle">
              <input className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} required />
            </Field>
          </div>
          <div className="mt-3"><Button type="submit">Merkmal speichern</Button></div>
        </form>
      ) : null}

      {view && view.features.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {view.features.slice(0, 12).map((feature) => (
            <li key={feature.id} className="rounded-lg border border-border px-4 py-3 text-sm">
              <p>{feature.caseTitle ? `${feature.caseTitle}: ` : ""}{featureName(feature.key)} · {featureValue(feature.key, feature.value)}</p>
              <p className="text-muted">{isOrigin(feature.origin) ? ORIGIN_LABEL[feature.origin] : feature.origin}{feature.auto ? " · aus der Akte gelesen" : " · eingetragen"}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {view && view.insights.length === 0 ? (
        <div className="mt-4">
          <Empty title="Kein Muster" body="Mindestens zwei Akten mit belegten Merkmalen. Ein gemeinsamer Ort allein reicht nicht. Es wird nichts erfunden." />
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          {view?.insights.map((item) => <InsightCard key={item.id} item={item} />)}
        </div>
      )}

      {view && view.history.length > 0 ? (
        <div className="mt-4">
          <Button variant="ghost" onClick={() => setHistory((open) => !open)}>{history ? "Ältere Versionen schließen" : "Ältere Versionen"}</Button>
          {history ? (
            <div className="mt-3 grid gap-2">
              {view.history.map((item) => <InsightCard key={item.id} item={item} />)}
            </div>
          ) : null}
        </div>
      ) : null}

      {view && view.derived.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-display text-xl tracking-tight">Berechnete Werte</h3>
          <p className="mt-1 text-sm text-muted">Jeder Wert verweist auf gespeicherte Angaben. Keine Kilometer und keine Wahrscheinlichkeit.</p>
          <ul className="mt-3 grid gap-2">
            {view.derived.slice(0, 8).map((point) => (
              <li key={point.id} className="rounded-lg border border-border px-4 py-3 text-sm">
                <p className="text-muted">{point.kind in DERIVED_KIND_LABEL ? DERIVED_KIND_LABEL[point.kind as keyof typeof DERIVED_KIND_LABEL] : point.kind} · {point.method}</p>
                <p className="mt-1">{point.value}</p>
                {point.inputs ? <p className="mt-1 text-muted">Ausgangsdaten. {point.inputs}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view && view.network.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-display text-xl tracking-tight">Netz</h3>
          <p className="mt-1 text-sm text-muted">Eine Kante ist eine berechnete oder gespeicherte Beziehung, kein belegter Zusammenhang zwischen Fällen.</p>
          <ul className="mt-3 grid gap-2">
            {view.network.filter((edge) => edge.relation !== "hat Merkmal" && edge.relation !== "Quelle").slice(0, 8).map((edge) => (
              <li key={`${edge.from}-${edge.relation}-${edge.to}`} className="rounded-lg border border-border px-4 py-3 text-sm">
                {edge.from} · {edge.relation} · {edge.to}
              </li>
            ))}
            {view.network.filter((edge) => edge.relation === "hat Merkmal" || edge.relation === "Quelle").slice(0, 6).map((edge) => (
              <li key={`${edge.from}-${edge.relation}-${edge.to}`} className="rounded-lg border border-border px-4 py-3 text-sm">
                {edge.from} · {edge.relation} · {edge.to}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
