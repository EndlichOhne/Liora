import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/app-frame";
import { ChatPage } from "@/components/chat-page";

type Search = { c?: string; project?: string };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    c: typeof search.c === "string" && search.c.length > 0 ? search.c : undefined,
    project: typeof search.project === "string" && search.project.length > 0 ? search.project : undefined,
  }),
  component: Home,
});

function Home() {
  const { c, project } = Route.useSearch();
  return (
    <AppFrame>
      <ChatPage conversationId={c} projectId={project} />
    </AppFrame>
  );
}
