"use client";

import { useConnectivity } from "@/hooks/use-connectivity";
import { cn } from "@/lib/utils";

export function ConnectivityRibbon() {
  const connected = useConnectivity();
  return (
    <div
      className={cn(
        "w-full py-1 text-center text-xs font-bold text-white",
        connected ? "bg-success" : "bg-destructive"
      )}
    >
      {connected ? "Server Connected" : "Server Not Connected"}
    </div>
  );
}
