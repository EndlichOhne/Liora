import { getAIProvider } from "@/lib/ai/xai.server";
import {
  chooseWork,
  classifyContradiction,
  contentHash,
  isEvidence,
  leadsFromCitations,
  reviewPublicStatement,
  safePublicUrl,
  scanFocus,
  scanQuery,
  timelineGaps,
  watchDelta,
  type EvidenceClass,
  type Region,
} from "@/lib/cases/engine";
import { runBenchmarks } from "@/lib/intelligence/engine";
import { assertRate, recordUsage } from "@/lib/data.server";
import {
  addAlert,
  addContradiction,
  casesMissingSource,
  contradictionExists,
  findCaseByTitle,
  getCaseFile,
  insertLead,
  itemsForContradiction,
  listColdCases,
  loadSignals,
  nextStaleWatch,
  recordJob,
  saveWatchCheck,
  compareStored,
} from "@/lib/cases/store";

async function searchOnce(query: string) {
  const provider = getAIProvider("xai");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const citations: { url: string; title?: string; snippet?: string }[] = [];
  try {
    for await (const event of provider.streamChat({
      model: "grok-4.5",
      messages: [
        { role: "system", content: "Suche nur öffentliche deutsche Quellen. Erfinde keine URL, keinen Fall und keine Zahl. Wenn nichts gefunden wurde, liefere keine Quellen." },
        { role: "user", content: query },
      ],
      maxTokens: 200,
      webSearch: true,
      signal: controller.signal,
    })) {
      if (event.type === "citations") {
        for (const item of event.items) {
          if (!citations.some((citation) => citation.url === item.url)) citations.push(item);
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return citations;
}

function pageText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

export async function runDeskTick(userId: string) {
  const signals = await loadSignals(userId);
  let webAllowed = true;
  try {
    await assertRate(userId, "case_scan", 6, "1 day");
  } catch {
    webAllowed = false;
  }
  const plan = chooseWork({ ...signals, webAllowed });
  if (plan.kind === "idle") {
    await recordJob(userId, { agent: plan.agent, kind: plan.kind, status: "done", reason: plan.reason, result: "Kein Abruf." });
    return { kind: plan.kind, web: false, note: plan.reason, createdLeads: 0 };
  }
  if (plan.kind === "scan_region") {
    if (!plan.region) {
      await recordJob(userId, { agent: plan.agent, kind: "idle", status: "done", reason: plan.reason, result: "Keine Region für die Suche." });
      return { kind: "idle" as const, web: false, note: "Keine Region für die Suche.", createdLeads: 0 };
    }
    await recordUsage(userId, "case_scan");
    const focus = scanFocus(Math.floor(Date.now() / 86_400_000));
    const focusLabel = focus === "court" ? "Gerichte" : focus === "missing" ? "Vermisste" : "neue Meldungen";
    let citations: { url: string; title?: string; snippet?: string }[] = [];
    try {
      citations = await searchOnce(scanQuery(plan.region, focus));
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const message = /abort/i.test(raw) ? "Die Suche hat das Zeitlimit erreicht. Es wurde nichts angelegt." : raw.slice(0, 240) || "Suche fehlgeschlagen.";
      const note = `Suche nicht abgeschlossen. ${message}`;
      await recordJob(userId, { agent: plan.agent, kind: plan.kind, region: plan.region, status: "failed", web: true, reason: plan.reason, result: note });
      return { kind: plan.kind, web: true, note, createdLeads: 0 };
    }
    const { kept, dropped } = leadsFromCitations(citations);
    let created = 0;
    let attached = 0;
    for (const lead of kept) {
      const match = await findCaseByTitle(userId, lead.title ?? "");
      if (match) {
        await addAlert(userId, {
          caseId: match.id,
          title: "Mögliche Aktualisierung",
          body: lead.title || lead.url,
          source: lead.url,
          evidence: lead.evidence,
        });
        attached += 1;
        continue;
      }
      const saved = await insertLead(userId, {
        region: lead.region,
        title: lead.title || lead.url,
        url: lead.url,
        snippet: lead.snippet ?? "",
        evidence: lead.evidence,
        kind: lead.kind,
        originKey: lead.originKey,
        publisher: lead.kind,
      });
      if (saved.fresh) created += 1;
    }
    const note = citations.length
      ? `${focusLabel}: ${created} neue Hinweise, ${attached} an bestehende Fälle gelegt, ${dropped} verworfen. Kein Fall wurde erfunden.`
      : `${focusLabel}: Die Suche hat keine Quelle zurückgegeben. Nichts angelegt.`;
    await recordJob(userId, { agent: plan.agent, kind: plan.kind, region: plan.region, status: "done", web: true, reason: plan.reason, result: note });
    return { kind: plan.kind, web: true, note, createdLeads: created };
  }
  if (plan.kind === "recheck_source") {
    const watch = await nextStaleWatch(userId);
    if (!watch) {
      await recordJob(userId, { agent: plan.agent, kind: plan.kind, status: "done", reason: plan.reason, result: "Keine fällige Quelle." });
      return { kind: plan.kind, web: false, note: "Keine fällige Quelle.", createdLeads: 0 };
    }
    const url = safePublicUrl(watch.url);
    if (!url) {
      await saveWatchCheck(userId, watch.id, { hash: watch.content_hash, changed: false, note: "URL ist nicht öffentlich abrufbar." });
      await recordJob(userId, { agent: plan.agent, kind: plan.kind, status: "done", reason: plan.reason, result: "URL abgelehnt." });
      return { kind: plan.kind, web: false, note: "URL abgelehnt.", createdLeads: 0 };
    }
    let note = "Abruf fehlgeschlagen. Keine neue Analyse.";
    let changed = false;
    let hash = watch.content_hash;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(url, { signal: controller.signal, redirect: "manual", headers: { "user-agent": "LioraDesk/1.0" } });
      clearTimeout(timer);
      if (res.status >= 300 && res.status < 400) note = "Weiterleitung wurde nicht gefolgt.";
      else if (!res.ok) note = `Seite antwortete ${res.status}. Nicht neu analysiert.`;
      else {
        const type = res.headers.get("content-type") ?? "";
        if (type && !/text|html|xml|json/i.test(type)) note = "Kein Text. Nicht neu analysiert.";
        else {
          const delta = watchDelta(watch.content_hash, contentHash(pageText(await res.text())));
          hash = delta.hash;
          changed = delta.changed;
          note = delta.baseline
            ? "Erster Abruf gespeichert. Noch kein Vergleich und kein Fakt."
            : delta.changed
              ? "Die Seite hat sich geändert. Kein Inhalt wurde als Fakt übernommen."
              : "Unverändert. Nicht erneut analysiert.";
          if (changed) {
            await addAlert(userId, { title: "Quelle geändert", body: watch.title, source: watch.url, evidence: "unknown" });
          }
        }
      }
    } catch {
      note = "Abruf fehlgeschlagen. Keine neue Analyse.";
    }
    await saveWatchCheck(userId, watch.id, { hash, changed, note });
    await recordJob(userId, { agent: plan.agent, kind: plan.kind, status: "done", reason: plan.reason, result: `${watch.title}: ${note}` });
    return { kind: plan.kind, web: false, note, createdLeads: 0 };
  }
  if (plan.kind === "gap_review") {
    const rows = await casesMissingSource(userId);
    const note = rows.length ? `${rows.length} Fälle ohne Quellen-URL: ${rows.map((row) => row.code).join(", ")}.` : "Kein Fall ohne Quelle.";
    await recordJob(userId, { agent: plan.agent, kind: plan.kind, status: "done", reason: plan.reason, result: note });
    return { kind: plan.kind, web: false, note, createdLeads: 0 };
  }
  if (plan.kind === "cold_review") {
    const rows = await listColdCases(userId);
    const note = rows.length ? `${rows.length} Cold Cases liegen vor. Es wurde niemand beschuldigt.` : "Kein Cold Case gespeichert.";
    await recordJob(userId, { agent: plan.agent, kind: plan.kind, status: "done", reason: plan.reason, result: note });
    return { kind: plan.kind, web: false, note, createdLeads: 0 };
  }
  if (plan.kind === "contradiction_scan") {
    const items = await itemsForContradiction(userId);
    let found = 0;
    const byCase = new Map<string, typeof items>();
    for (const item of items) {
      const list = byCase.get(item.case_id) ?? [];
      list.push(item);
      byCase.set(item.case_id, list);
    }
    for (const [caseId, group] of byCase) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const left = group[i];
          const right = group[j];
          if (!isEvidence(left.evidence_class) || !isEvidence(right.evidence_class)) continue;
          const result = classifyContradiction(
            { text: left.body, evidence: left.evidence_class },
            { text: right.body, evidence: right.evidence_class },
          );
          if (result.kind !== "direct" && result.kind !== "possible") continue;
          if (await contradictionExists(userId, left.body, right.body)) continue;
          await addContradiction(userId, { caseId, kind: result.kind, left: left.body, right: right.body, note: result.note });
          found += 1;
        }
      }
    }
    const note = found ? `${found} neue Widersprüche im gespeicherten Text.` : "Kein neuer Widerspruch im gespeicherten Text.";
    await recordJob(userId, { agent: plan.agent, kind: plan.kind, status: "done", reason: plan.reason, result: note });
    return { kind: plan.kind, web: false, note, createdLeads: 0 };
  }
  if (plan.kind === "discovery") {
    const result = await runDiscoveryJob(userId);
    return { kind: "discovery" as const, web: false, note: result.note, createdLeads: 0 };
  }
  const bench = runBenchmarks();
  const passed = bench.filter((item) => item.pass).length;
  const failed = bench.length - passed;
  const note = `${passed} Tests bestanden, ${failed} nicht. Code wurde nicht verändert.`;
  await recordJob(userId, { agent: "evaluation", kind: "benchmark", status: "done", reason: plan.reason, result: note });
  return { kind: "benchmark", web: false, note, createdLeads: 0 };
}

export async function runDiscoveryJob(userId: string) {
  const result = await compareStored(userId);
  await recordJob(userId, {
    agent: "disconfirmation",
    kind: "discovery",
    status: "done",
    reason: "Gespeicherte Merkmale vergleichen.",
    result: result.note,
  });
  return { unchanged: result.unchanged, created: result.created, note: result.note };
}

export async function reviewCaseLocally(userId: string, input: { caseId: string; summary: string; eventDates: string[]; statements: string[] }) {
  const gaps = timelineGaps(input.eventDates);
  const wording = reviewPublicStatement(input.summary || "");
  const pairs: { kind: string; note: string }[] = [];
  for (let i = 0; i < input.statements.length; i += 1) {
    for (let j = i + 1; j < input.statements.length; j += 1) {
      const result = classifyContradiction(
        { text: input.statements[i], evidence: "unknown" as EvidenceClass },
        { text: input.statements[j], evidence: "unknown" as EvidenceClass },
      );
      if (result.kind === "direct" || result.kind === "possible") pairs.push(result);
    }
  }
  const note = [
    gaps.length ? `Zeitlücken: ${gaps.join(" ")}` : "Keine Zeitlücke ab 30 Tagen.",
    `Formulierung: ${wording.notes.join(" ")}`,
    pairs.length ? `${pairs.length} mögliche Widersprüche.` : "Kein Widerspruch in den gespeicherten Sätzen.",
    "Keine Lügenfeststellung. Niemand wurde als Täter bezeichnet.",
  ].join(" ");
  await recordJob(userId, { agent: "deep_research", kind: "deep_case", region: "", status: "done", reason: input.caseId, result: note });
  return { gaps, notes: wording.notes, contradictions: pairs.length, note };
}

export async function reviewStoredCase(userId: string, caseId: string) {
  const file = await getCaseFile(userId, caseId);
  if (!file) throw new Error("Fall nicht gefunden.");
  const statements = [file.case.summary, ...file.items.map((item) => item.body)].map((value) => value.trim()).filter((value) => value.length >= 24);
  return reviewCaseLocally(userId, {
    caseId: file.case.code,
    summary: file.case.summary,
    eventDates: file.events.map((event) => event.occurredOn).filter(Boolean),
    statements,
  });
}

export type { Region };
