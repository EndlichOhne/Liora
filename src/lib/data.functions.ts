import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { MemoryCategory, Mode, ResponseStyle, ThemeChoice } from "@/lib/domain";
import { isMemoryCategory, isMemoryConfidence, isMode } from "@/lib/domain";
import {
  addTask,
  deleteAccount,
  deleteConversation,
  deleteFile,
  deleteMemory,
  deleteNote,
  deleteProject,
  deleteTask,
  ensureProfile,
  exportData,
  issueRecoveryCode,
  listConversations,
  listFiles,
  listMemories,
  listMessages,
  listNotes,
  listProjects,
  listTasks,
  markMemoryVerified,
  readProfile,
  renameConversation,
  resetWithRecovery,
  rotateRecoveryCode,
  saveMemory,
  saveNote,
  saveProject,
  setConversationMode,
  toggleTask,
  updateProfile,
  uploadFile,
  getProject,
} from "@/lib/data.server";

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const getProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ensureProfile(context.userId));

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    const language: "de" | "en" | undefined =
      data.language === "en" ? "en" : data.language === "de" ? "de" : undefined;
    const responseStyle =
      data.responseStyle === "concise" || data.responseStyle === "balanced" || data.responseStyle === "thorough"
        ? (data.responseStyle as ResponseStyle)
        : undefined;
    const theme =
      data.theme === "system" || data.theme === "light" || data.theme === "dark"
        ? (data.theme as ThemeChoice)
        : undefined;
    return {
      displayName: data.displayName === undefined ? undefined : str(data.displayName, 80),
      language,
      writingNotes: data.writingNotes === undefined ? undefined : str(data.writingNotes, 2000),
      responseStyle,
      theme,
      modelId: data.modelId === undefined ? undefined : str(data.modelId, 64),
      voiceId: data.voiceId === undefined ? undefined : str(data.voiceId, 32),
      voiceAuto: typeof data.voiceAuto === "boolean" ? data.voiceAuto : undefined,
    };
  })
  .handler(async ({ context, data }) => updateProfile(context.userId, data));

export const createRecoveryCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ code: await issueRecoveryCode(context.userId) }));

export const replaceRecoveryCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ code: await rotateRecoveryCode(context.userId) }));

export const resetPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      email: str(data.email, 200),
      code: str(data.code, 64),
      newPassword: str(data.newPassword, 200),
    };
  })
  .handler(async ({ data }) => {
    await resetWithRecovery(data.email, data.code, data.newPassword);
    return { ok: true as const };
  });

export const listChats = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      projectId: typeof data.projectId === "string" ? data.projectId : null,
      query: str(data.query, 80),
      before: typeof data.before === "string" ? data.before : null,
    };
  })
  .handler(async ({ context, data }) => listConversations(context.userId, data));

export const renameChat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { id: str(data.id, 80), title: str(data.title, 120) };
  })
  .handler(async ({ context, data }) => {
    await renameConversation(context.userId, data.id, data.title);
    return { ok: true as const };
  });

export const removeChat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await deleteConversation(context.userId, data.id);
    return { ok: true as const };
  });

export const setChatMode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    const mode = str(data.mode, 20);
    if (!isMode(mode)) throw new Error("Unbekannter Modus.");
    return { id: str(data.id, 80), mode: mode as Mode };
  })
  .handler(async ({ context, data }) => {
    await setConversationMode(context.userId, data.id, data.mode);
    return { ok: true as const };
  });

export const loadMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      conversationId: str(data.conversationId, 80),
      before: typeof data.before === "string" ? data.before : null,
    };
  })
  .handler(async ({ context, data }) => listMessages(context.userId, data.conversationId, data.before));

export const listMemory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listMemories(context.userId));

export const upsertMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    const category = str(data.category, 32);
    if (!isMemoryCategory(category)) throw new Error("Unbekannte Kategorie.");
    return {
      id: typeof data.id === "string" && data.id ? data.id : undefined,
      category: category as MemoryCategory,
      title: str(data.title, 140),
      content: str(data.content, 4000),
      source: str(data.source, 300),
      confidence: isMemoryConfidence(str(data.confidence, 16)) ? str(data.confidence, 16) : "",
    };
  })
  .handler(async ({ context, data }) => {
    const id = await saveMemory(context.userId, data);
    return { id };
  });

export const removeMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await deleteMemory(context.userId, data.id);
    return { ok: true as const };
  });

export const verifyMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await markMemoryVerified(context.userId, data.id);
    return { ok: true as const };
  });

export const listProjectPage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listProjects(context.userId));

export const loadProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    const project = await getProject(context.userId, data.id);
    if (!project) throw new Error("Projekt nicht gefunden.");
    const [tasks, notes, files, chats] = await Promise.all([
      listTasks(context.userId, data.id),
      listNotes(context.userId, data.id),
      listFiles(context.userId, data.id),
      listConversations(context.userId, { projectId: data.id }),
    ]);
    return { project, tasks, notes, files, chats };
  });

export const upsertProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      id: typeof data.id === "string" && data.id ? data.id : undefined,
      name: str(data.name, 120),
      summary: str(data.summary, 500),
      contextNotes: str(data.contextNotes, 8000),
    };
  })
  .handler(async ({ context, data }) => ({ id: await saveProject(context.userId, data) }));

export const removeProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await deleteProject(context.userId, data.id);
    return { ok: true as const };
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { projectId: str(data.projectId, 80), title: str(data.title, 200) };
  })
  .handler(async ({ context, data }) => ({ id: await addTask(context.userId, data.projectId, data.title) }));

export const setTaskDone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { id: str(data.id, 80), done: Boolean(data.done) };
  })
  .handler(async ({ context, data }) => {
    await toggleTask(context.userId, data.id, data.done);
    return { ok: true as const };
  });

export const removeTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await deleteTask(context.userId, data.id);
    return { ok: true as const };
  });

export const upsertNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      id: typeof data.id === "string" && data.id ? data.id : undefined,
      projectId: str(data.projectId, 80),
      title: str(data.title, 140),
      body: str(data.body, 20000),
    };
  })
  .handler(async ({ context, data }) => ({ id: await saveNote(context.userId, data) }));

export const removeNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await deleteNote(context.userId, data.id);
    return { ok: true as const };
  });

export const listLibrary = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { projectId: typeof data.projectId === "string" ? data.projectId : null };
  })
  .handler(async ({ context, data }) => listFiles(context.userId, data.projectId));

export const addFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      name: str(data.name, 180),
      mime: str(data.mime, 120),
      base64: str(data.base64, 8_200_000),
      projectId: typeof data.projectId === "string" ? data.projectId : null,
    };
  })
  .handler(async ({ context, data }) => uploadFile(context.userId, data));

export const removeFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await deleteFile(context.userId, data.id);
    return { ok: true as const };
  });

export const downloadExport = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => exportData(context.userId));

export const removeAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const confirm = str((input as { confirm?: string })?.confirm, 20);
    if (confirm !== "LÖSCHEN" && confirm !== "LOESCHEN") throw new Error("Bitte LÖSCHEN eingeben.");
    return { confirm };
  })
  .handler(async ({ context }) => {
    await deleteAccount(context.userId);
    return { ok: true as const };
  });
