const MAX_TEXT = 60_000;

const ALLOWED = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/tab-separated-values",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function normalizeMime(mime: string, name: string): string {
  const lower = mime.toLowerCase().split(";")[0]?.trim() || "";
  if (ALLOWED.has(lower)) return lower;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  const guessed = byExt[ext];
  if (!guessed) throw new Error("Dieser Dateityp wird nicht unterstützt.");
  return guessed;
}

export function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.replace(/[^\w.\- ()äöüÄÖÜß]+/g, "_").slice(0, 160);
  return base && base !== "." && base !== ".." ? base : "datei";
}

export type Extracted = {
  kind: "text" | "pdf" | "docx" | "sheet" | "image";
  text: string;
  imageData: string | null;
};

export async function extractUpload(name: string, mime: string, buf: Buffer): Promise<Extracted> {
  if (mime.startsWith("image/")) {
    if (buf.byteLength > 4_000_000) throw new Error("Bilder dürfen höchstens 4 MB groß sein.");
    return {
      kind: "image",
      text: "",
      imageData: `data:${mime};base64,${buf.toString("base64")}`,
    };
  }
  if (buf.byteLength > 6_000_000) throw new Error("Dateien dürfen höchstens 6 MB groß sein.");

  if (mime === "application/pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const result = await extractText(pdf, { mergePages: false });
      const pages = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
      const text = pages
        .map((page, i) => `--- Seite ${i + 1} ---\n${page}`)
        .join("\n\n")
        .slice(0, MAX_TEXT);
      return {
        kind: "pdf",
        text: text.trim() || "(Die PDF enthält keinen extrahierbaren Text.)",
        imageData: null,
      };
    } catch {
      return {
        kind: "pdf",
        text: "(Der PDF-Text konnte nicht gelesen werden. Die Datei ist gespeichert, der Inhalt liegt der KI aber nicht vor.)",
        imageData: null,
      };
    }
  }

  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      return {
        kind: "docx",
        text: (result.value || "(Das Dokument enthält keinen Text.)").slice(0, MAX_TEXT),
        imageData: null,
      };
    } catch {
      return {
        kind: "docx",
        text: "(Das DOCX konnte nicht gelesen werden.)",
        imageData: null,
      };
    }
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames.slice(0, 8)) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        parts.push(`# ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet).slice(0, 20_000)}`);
      }
      return {
        kind: "sheet",
        text: parts.join("\n\n").slice(0, MAX_TEXT) || "(Die Tabelle ist leer.)",
        imageData: null,
      };
    } catch {
      return { kind: "sheet", text: "(Die Tabelle konnte nicht gelesen werden.)", imageData: null };
    }
  }

  const text = buf.toString("utf8").replace(/\u0000/g, "").slice(0, MAX_TEXT);
  return { kind: "text", text, imageData: null };
}
