import { createFileRoute } from "@tanstack/react-router";
import { runChat, type ChatInput } from "@/lib/chat.server";
import { requireRequestUser } from "@/lib/session.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId = "";
        try {
          userId = await requireRequestUser(request);
        } catch (error) {
          const status = (error as { status?: number }).status ?? 401;
          return Response.json(
            { error: status === 403 ? "Anfrage abgelehnt." : "Nicht angemeldet." },
            { status },
          );
        }
        const body = (await request.json().catch(() => null)) as ChatInput | null;
        if (!body || typeof body !== "object") {
          return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const write = (event: Record<string, unknown>) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              } catch {
                /* client gone */
              }
            };
            try {
              await runChat({ userId, body, signal: request.signal, write });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Die Antwort konnte nicht erzeugt werden.";
              write({ type: "error", message });
            } finally {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
