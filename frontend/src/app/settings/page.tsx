"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSettings } from "@/contexts/settings-context";
import type { ThemeMode } from "@/lib/storage";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const { themeMode, setThemeMode } = useSettings();

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <h2 className="font-semibold">Appearance</h2>
              <p className="text-sm text-muted-foreground">Choose how the app looks.</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "system", label: "System", icon: Monitor },
                ] as { value: ThemeMode; label: string; icon: typeof Sun }[]
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setThemeMode(value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-sm transition-colors",
                    themeMode === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input hover:bg-accent"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
