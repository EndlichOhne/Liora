import { createFileRoute } from "@tanstack/react-router";
import { getAIProvider } from "@/lib/ai/xai.server";
import { assertRate, readProfile, recordUsage } from "@/lib/data.server";
import { requireRequestUser } from "@/lib/session.server";

function plain(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

export const Route = createFileRoute("/api/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await requireRequestUser(request);
          const body = (await request.json().catch(() => null)) as { text?: string; voiceId?: string } | null;
          const text = plain(typeof body?.text === "string" ? body.text : "");
          if (!text) return Response.json({ error: "Nichts vorzulesen." }, { status: 400 });
          await assertRate(userId, "tts", 40, "1 hour");
          const profile = await readProfile(userId);
          const voice = typeof body?.voiceId === "string" && body.voiceId ? body.voiceId : profile.voiceId;
          await recordUsage(userId, "tts");
          const audio = await getAIProvider("xai").synthesizeSpeech(text, voice, request.signal);
          return new Response(Buffer.from(audio), {
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          const status = (error as { status?: number }).status ?? 500;
          const message = error instanceof Error ? error.message : "Sprache fehlgeschlagen.";
          return Response.json({ error: message }, { status: status === 401 || status === 403 ? status : 500 });
        }
      },
    },
  },
});
