"use client";

import * as React from "react";
import { storage, type ThemeMode } from "@/lib/storage";
import { resetApiClient } from "@/lib/api";

interface SettingsContextValue {
  baseAddress: string;
  themeMode: ThemeMode;
  setBaseAddress: (v: string) => void;
  setThemeMode: (v: ThemeMode) => void;
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  root.classList.toggle("dark", dark);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [baseAddress, setBaseAddressState] = React.useState<string>("/api");
  const [themeMode, setThemeModeState] = React.useState<ThemeMode>("system");

  React.useEffect(() => {
    setBaseAddressState(storage.getBaseAddress());
    const mode = storage.getThemeMode();
    setThemeModeState(mode);
    applyTheme(mode);
    // Re-apply when system theme changes (when in "system" mode)
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      if (storage.getThemeMode() === "system") applyTheme("system");
    };
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, []);

  const setBaseAddress = React.useCallback((v: string) => {
    storage.setBaseAddress(v);
    setBaseAddressState(v);
    resetApiClient();
  }, []);

  const setThemeMode = React.useCallback((v: ThemeMode) => {
    storage.setThemeMode(v);
    setThemeModeState(v);
    applyTheme(v);
  }, []);

  return (
    <SettingsContext.Provider value={{ baseAddress, themeMode, setBaseAddress, setThemeMode }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
