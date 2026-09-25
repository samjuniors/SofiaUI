import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  const [App, setApp] = useState<ComponentType | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    import("@/App")
      .then((m) => setApp(() => m.default))
      .catch((err) => {
        console.error("Failed to load Sophia interface:", err);
        setLoadError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (loadError) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#04060f] p-6 text-center text-white">
        <p className="text-rose-400 font-mono text-sm mb-2">Failed to load Sophia</p>
        <p className="text-white/60 text-xs font-mono max-w-md">{loadError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 text-xs rounded border border-white/20 hover:bg-white/10"
        >
          Reload
        </button>
      </div>
    );
  }

  if (!App) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#04060f]" aria-label="Loading Sophia">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400/30 border-t-sky-400" />
      </div>
    );
  }

  return <App />;
}
