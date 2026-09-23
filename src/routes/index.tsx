import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  const [App, setApp] = useState<ComponentType | null>(null);
  useEffect(() => {
    void import("@/App").then((m) => setApp(() => m.default));
  }, []);
  if (!App) {
    return <div className="fixed inset-0 bg-[#04060f]" aria-label="Loading Sophia" />;
  }
  return <App />;
}
