"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveDataRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [lastRefresh, setLastRefresh] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setLastRefresh(new Date());
    };

    const timer = window.setInterval(refresh, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, router]);

  return (
    <span className="live-refresh-indicator" title={`Last checked ${lastRefresh.toLocaleTimeString()}`}>
      <i aria-hidden="true" /> Live updates
    </span>
  );
}
