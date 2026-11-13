import { Progress } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

type ProgressPayload = {
  id: string;
  progress: number;
  finished: boolean;
};

function DatabaseLoader({ isLoading, tab }: { isLoading: boolean; tab: string | null }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Stop listening when the panel unmounts or switches tabs. Before, each
    // mount left a listener behind that kept running for the whole session.
    let active = true;
    const unlistenPromise = listen<ProgressPayload>("search_progress", ({ payload }) => {
      if (!active || payload.id !== tab) return;
      setProgress(payload.finished ? 0 : payload.progress);
    });
    return () => {
      active = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [tab]);

  const isLoadingFromMemory = isLoading && progress === 0;

  return (
    <Progress
      animated={isLoadingFromMemory}
      value={isLoadingFromMemory ? 100 : progress}
      size="xs"
      mt="xs"
    />
  );
}

export default DatabaseLoader;
