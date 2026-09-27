import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/app-frame";
import { SystemPage } from "@/components/system-page";

const TABS = ["board", "wissen", "fehler", "agenten", "freigabe", "tests", "modelle"] as const;
export type SystemTab = (typeof TABS)[number];

export const Route = createFileRoute("/system")({
  validateSearch: (search: Record<string, unknown>): { tab: SystemTab } => ({
    tab: TABS.includes(search.tab as SystemTab) ? (search.tab as SystemTab) : "board",
  }),
  component: SystemRoute,
});

function SystemRoute() {
  const { tab } = Route.useSearch();
  return (
    <AppFrame>
      <SystemPage tab={tab} />
    </AppFrame>
  );
}
