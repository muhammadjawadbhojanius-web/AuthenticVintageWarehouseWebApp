"use client";

import { useEffect, useState } from "react";
import { checkHealth } from "@/lib/queries";

export function useConnectivity(): boolean {
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const ok = await checkHealth();
      if (cancelled) return;
      setConnected(ok);
      timer = setTimeout(tick, ok ? 60_000 : 20_000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return connected;
}
