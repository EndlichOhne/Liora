import { assertModelId } from "@/lib/ai/provider";
import { getAIProvider } from "@/lib/ai/xai.server";
import { assertRate, readProfile, recordUsage } from "@/lib/data.server";
import {
  changePolicy,
  classifySource,
  compareMeasurements,
  detectGap,
  findConflicts,
  findSecret,
  median,
  qualityCheck,
  routeTask,
  runBenchmarks,
  tierLabel,
} from "@/lib/intelligence/engine";
import type { AgentName, RouteDecision } from "@/lib/intelligence/types";
import {
  addProposal,
  closeRun,
  latestProbe,
  listModelIds,
  openRun,
  perfSamples,
  processStatement,
  rememberClaim,
  rememberSource,
  saveProbe,
  sourcesFor,
  textsForScan,
  upsertModels,
} from "@/lib/intelligence/store";

function publicDetail(detail: Record<string, unknown>) {
  const text = (key: string) => (typeof detail[key] === "string" ? detail[key] : undefined);
  const count = (key: string) => (typeof detail[key] === "number" ? detail[key] : undefined);
  const flag = (key: string) => (typeof detail[key] === "boolean" ? detail[key] : undefined);
  const urls = Array.isArray(detail.citations) ? detail.citations.filter((item): item is string => typeof item === "string") : undefined;
  return {
    error: text("error"),
    status: text("status"),
    modelNote: text("modelNote"),
    gap: text("gap"),
    conflicts: count("conflicts"),
    primary: count("primary"),
    secondary: count("secondary"),
    storedSources: count("storedSources"),
    sentences: count("sentences"),
    web: flag("web"),
    citations: urls,
  };
}

type AgentOutput = { agent: AgentName; summary: string; detail: Record<string, unknown> };

async function completeOnce(model: string, system: string, user: string, web: boolean) {
  const provider = getAIProvider("xai");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let text = "";
  const citations: { url: string; title?: string; snippet?: string }[] = [];
  try {
    for await (const event of provider.streamChat({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 500,
      webSearch: web,
      signal: controller.signal,
    })) {
      if (event.type === "delta") text += event.text;
      if (event.type === "citations") {
        for (const item of event.items) {
          if (!citations.some((citation) => citation.url === item.url)) citations.push(item);
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { text: text.trim(), citations };
}

async function research(userId: string, task: string, web: boolean, model: string): Promise<AgentOutput> {
  const local = await sourcesFor(userId, task);
  const detail: Record<string, unknown> = {
    storedSources: local.length,
    web: false,
    citations: [] as string[],
  };
  if (!web) {
    return {
      agent: "research",
      summary: local.length
        ? `${local.length} gespeicherte Quellen überlappen. Keine neue Suche gestartet.`
        : "Keine passende gespeicherte Quelle. Websuche war nicht freigegeben.",
      detail,
    };
  }
  await assertRate(userId, "research", 8, "1 hour");
  await recordUsage(userId, "research");
  const result = await completeOnce(
    model,
    "Suche Quellen. Antworte nur mit dem, was die Suche hergibt. Erfinde keine URL und keine Zahl. Wenn nichts gefunden wurde, sag das in einem Satz.",
    task.slice(0, 1500),
    true,
  );
  detail.web = true;
  detail.modelNote = result.text.slice(0, 600);
  const urls: string[] = [];
  for (const citation of result.citations) {
    const source = classifySource(citation.url);
    urls.push(citation.url);
    const snippet = citation.snippet?.trim() ?? "";
    if (snippet && qualityCheck(snippet).ok && !findSecret(snippet)) {
      await processStatement(userId, {
        body: snippet,
        url: citation.url,
        title: citation.title || "",
        origin: "research",
      });
    } else {
      await rememberSource(userId, {
        url: citation.url,
        title: citation.title || citation.url,
        kind: source.kind,
        reliability: source.reliability,
        note: snippet || source.note,
        checked: true,
      });
    }
  }
  detail.citations = urls;
  return {
    agent: "research",
    summary: urls.length
      ? `${urls.length} Quellen aus der Suche gespeichert. Snippets nur ungeprüft, der Modelltext nicht als Fakt.`
      : "Suche lief, hat aber keine Quelle zurückgegeben. Nichts erfunden.",
    detail,
  };
}

async function verify(userId: string, task: string): Promise<AgentOutput> {
  const matches = await sourcesFor(userId, task);
  const primary = matches.filter((item) => item.kind === "primary");
  const secondary = matches.filter((item) => item.kind !== "primary");
  const conflicts = findConflicts(task, (await textsForScan(userId)).slice(0, 40).map((statement, index) => ({
    id: String(index),
    statement,
    status: "current" as const,
  }))).length;
  let status = "insufficient";
  if (conflicts) status = "conflicted";
  else if (primary.length) status = "supported";
  else if (secondary.length) status = "secondary_only";
  await rememberClaim(userId, {
    claim: task.slice(0, 500),
    status,
    primaryNote: primary.length ? primary.map((item) => item.url || item.title).join(", ") : "Keine Primärquelle.",
    secondaryNote: secondary.length ? `${secondary.length} weitere Quelle(n).` : "Keine Sekundärquelle.",
    conflictNote: conflicts ? "Überlappt widersprüchlich mit gespeichertem Text." : "Kein Widerspruch im gespeicherten Text.",
  });
  return {
    agent: "verification",
    summary:
      status === "supported"
        ? "Primärquelle vorhanden. Trotzdem nur so weit belegt, wie die Quelle reicht."
        : status === "secondary_only"
          ? "Nur Sekundärquellen. Nicht als gesichert markiert."
          : status === "conflicted"
            ? "Widerspruch. Kein abschließender Fakt."
            : "Belege reichen nicht. Status: unzureichend.",
    detail: { status, primary: primary.length, secondary: secondary.length, conflicts },
  };
}

async function analyze(userId: string, task: string): Promise<AgentOutput> {
  const sentences = task.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean).slice(0, 8);
  const assumptions = sentences.filter((sentence) => /\b(angenommen|wenn|falls|assuming|vorausgesetzt)\b/i.test(sentence));
  const counters = sentences.filter((sentence) => /\b(aber|jedoch|dagegen|allerdings)\b/i.test(sentence));
  const known = await textsForScan(userId);
  const gap = detectGap(task, known);
  return {
    agent: "analysis",
    summary: gap.open
      ? "Struktur erkannt. Eine Wissenslücke bleibt offen und wird nicht geraten."
      : "Struktur erkannt. Gespeichertes Wissen überlappt teilweise.",
    detail: {
      sentences: sentences.length,
      assumptions,
      countersInText: counters,
      gap: gap.open ? gap.missing : "",
    },
  };
}

async function memory(userId: string, task: string): Promise<AgentOutput> {
  if (!/merk dir|speichere das|ins wissen/i.test(task)) {
    const gap = detectGap(task, await textsForScan(userId));
    return {
      agent: "memory",
      summary: gap.open ? "Nichts gespeichert. Die Frage trifft gespeichertes Wissen nicht." : "Nichts Neues zu speichern.",
      detail: { stored: false, gap: gap.open },
    };
  }
  const result = await processStatement(userId, { body: task, origin: "intake" });
  return { agent: "memory", summary: result.note, detail: { status: result.status, steps: result.steps } };
}

async function code(userId: string, task: string): Promise<AgentOutput> {
  const started = Date.now();
  const results = runBenchmarks();
  const failed = results.filter((item) => !item.pass);
  const policy = changePolicy("code");
  await addProposal(userId, {
    agent: "code",
    kind: "code",
    risk: "gated",
    title: "Codevorschlag, nicht angewendet",
    body: `${task.slice(0, 800)}\n\nInterner Test: ${results.length - failed.length} bestanden, ${failed.length} nicht, ${Date.now() - started} ms. Produktion wurde nicht verändert.`,
  });
  return {
    agent: "code",
    summary: `Test im Sandbox-Sinn: ${results.length - failed.length}/${results.length} bestanden. Kein Produktionscode geändert.`,
    detail: { policy, failed: failed.map((item) => item.id) },
  };
}

async function design(userId: string, task: string): Promise<AgentOutput> {
  await addProposal(userId, {
    agent: "design",
    kind: "design",
    risk: "low",
    title: "Designnotiz",
    body: `${task.slice(0, 800)}\n\nKeine Layoutänderung ausgeführt. Das bestehende System bleibt: eine Schrift für Text, eine für Überschriften, neutrale Flächen, ein Akzent.`,
  });
  return {
    agent: "design",
    summary: "Notiz gespeichert. Die Oberfläche wurde nicht umgebaut.",
    detail: { changed: false },
  };
}

async function performance(userId: string): Promise<AgentOutput> {
  const samples = await perfSamples(userId);
  const mid = median(samples);
  if (mid == null || samples.length < 5) {
    return {
      agent: "performance",
      summary: `Zu wenige Messungen (${samples.length}). Kein Engpass behauptet.`,
      detail: { n: samples.length },
    };
  }
  if (mid > 10_000) {
    await addProposal(userId, {
      agent: "performance",
      kind: "performance",
      risk: "low",
      title: "Latenz über 10 Sekunden",
      body: `Median der letzten ${samples.length} Messungen: ${mid} ms. Nur ein Hinweis, keine automatische Änderung.`,
    });
  }
  return {
    agent: "performance",
    summary: `Median ${mid} ms aus ${samples.length} Messungen.`,
    detail: { n: samples.length, medianMs: mid },
  };
}

async function security(userId: string): Promise<AgentOutput> {
  const hits = (await textsForScan(userId)).filter((text) => findSecret(text));
  if (hits.length) {
    await addProposal(userId, {
      agent: "security",
      kind: "security",
      risk: "gated",
      title: "Möglicher Schlüssel im Wissen",
      body: `${hits.length} Text(e) sehen nach einem Schlüssel aus. Nichts gelöscht und keine Regel geändert. Bitte selbst prüfen.`,
    });
  }
  return {
    agent: "security",
    summary: hits.length ? `${hits.length} mögliche Schlüssel gefunden. Nichts gelöscht.` : "Keine Schlüssel in Wissen oder Regeln.",
    detail: { hits: hits.length, productionUntouched: true },
  };
}

async function runOne(userId: string, agent: AgentName, task: string, web: boolean, model: string, parentId: string, decision: RouteDecision) {
  const started = Date.now();
  const id = await openRun(userId, { agent, parentId, mode: decision.mode, tier: decision.tier, summary: task.slice(0, 160) });
  try {
    const output =
      agent === "research"
        ? await research(userId, task, web, model)
        : agent === "verification"
          ? await verify(userId, task)
          : agent === "analysis"
            ? await analyze(userId, task)
            : agent === "memory"
              ? await memory(userId, task)
              : agent === "code"
                ? await code(userId, task)
                : agent === "design"
                  ? await design(userId, task)
                  : agent === "performance"
                    ? await performance(userId)
                    : await security(userId);
    await closeRun(userId, id, { status: "done", summary: output.summary, detail: output.detail, started });
    return output;
  } catch (error) {
    const summary = error instanceof Error ? error.message : "Agent fehlgeschlagen.";
    await closeRun(userId, id, { status: "failed", summary, started });
    return { agent, summary, detail: { error: summary } };
  }
}

export async function runTask(userId: string, task: string, web: boolean) {
  const text = task.trim().slice(0, 4000);
  if (text.length < 8) throw new Error("Die Aufgabe ist zu kurz.");
  const decision = routeTask(text);
  const profile = await readProfile(userId);
  const model = profile.modelId || "grok-4.5";
  const started = Date.now();
  const parent = await openRun(userId, {
    agent: "orchestrator",
    mode: decision.mode,
    tier: decision.tier,
    summary: decision.reason,
  });
  const jobs: AgentName[] = decision.parallel.length ? decision.parallel : decision.agents.length ? [] : ["memory"];
  const parallel = await Promise.all(jobs.map((agent) => runOne(userId, agent, text, web, model, parent, decision)));
  const after: AgentOutput[] = [];
  if (decision.agents.includes("verification")) {
    after.push(await runOne(userId, "verification", text, web, model, parent, decision));
  }
  const outputs = [...parallel, ...after];
  const summary = outputs.length
    ? outputs.map((item) => `${item.agent}: ${item.summary}`).join(" ")
    : decision.reason;
  await closeRun(userId, parent, {
    status: "done",
    summary: summary.slice(0, 500),
    detail: {
      mode: decision.mode,
      tier: decision.tier,
      agents: decision.agents,
      model,
    },
    started,
  });
  return {
    decision,
    tierLabel: tierLabel(decision.tier),
    model,
    outputs: outputs.map((item) => ({ agent: item.agent, summary: item.summary, detail: publicDetail(item.detail) })),
  };
}

export async function refreshCatalog(userId: string) {
  await assertRate(userId, "models", 6, "1 day");
  await recordUsage(userId, "models");
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("Die Modellliste ist hier nicht verfügbar.");
  const res = await fetch("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Die Modellliste kam nicht zurück (${res.status}).`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  const ids = (body.data ?? [])
    .map((item) => (typeof item.id === "string" ? item.id : ""))
    .filter((id) => /^[a-zA-Z0-9._-]{1,64}$/.test(id));
  if (!ids.length) throw new Error("Die Liste war leer. Nichts übernommen.");
  const added = await upsertModels(userId, ids);
  if (added.length) {
    await addProposal(userId, {
      agent: "orchestrator",
      kind: "model",
      risk: "gated",
      title: "Neue Modelle gesehen",
      body: `${added.join(", ")}. Nicht gewechselt. Ein Wechsel bleibt in den Einstellungen und nur durch dich.`,
    });
  }
  return { ids, added };
}

export async function probeModel(userId: string, modelId: string) {
  const id = assertModelId(modelId);
  const allowed = new Set([...(await listModelIds(userId)), (await readProfile(userId)).modelId]);
  if (!allowed.has(id)) throw new Error("Nur ein abgerufenes oder das eingestellte Modell kann getestet werden.");
  await assertRate(userId, "probe", 8, "1 day");
  await recordUsage(userId, "probe");
  const started = Date.now();
  const result = await completeOnce(id, "Reply with exactly OK and nothing else.", "OK", false);
  const latencyMs = Date.now() - started;
  const passed = result.text.trim() === "OK";
  await saveProbe(userId, { modelId: id, expected: "OK", output: result.text, passed, latencyMs });
  return { modelId: id, passed, latencyMs, output: result.text.slice(0, 200) };
}

export async function compareProbePair(userId: string, modelA: string, modelB: string) {
  const a = await latestProbe(userId, assertModelId(modelA));
  const b = await latestProbe(userId, assertModelId(modelB));
  const result = compareMeasurements(a, b);
  if (result.winner === "b") {
    await addProposal(userId, {
      agent: "orchestrator",
      kind: "model",
      risk: "gated",
      title: `${modelB} nur vorschlagen`,
      body: `${result.reason} Das eingestellte Modell bleibt, bis du es in den Einstellungen wechselst.`,
    });
  }
  return { ...result, a, b };
}
