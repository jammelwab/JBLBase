import { createFileRoute } from "@tanstack/react-router";
import InsightPage from "@/components/insight/InsightPage";

export const Route = createFileRoute("/insight")({
  component: InsightPage,
  loader: ({ context: { loadDirs } }) => loadDirs(),
});
