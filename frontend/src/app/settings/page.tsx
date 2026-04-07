"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wifi, Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSettings } from "@/contexts/settings-context";
import type { ThemeMode } from "@/lib/storage";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const { baseAddress, setBaseAddress, themeMode, setThemeMode } = useSettings();
  const [draft, setDraft] = useState(baseAddress);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const handleSave = () => {
    const value = draft.trim();
    if (!value) return;
    setBaseAddress(value);
    setSavedMessage(`Active server: ${value}`);
    setTimeout(() => setSavedMessage(null), 3000);
  };

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
          <CardContent className="space-y-6 pt-6">
            {/* Server */}
            <section className="space-y-3">
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  <Wifi className="h-4 w-4" /> Backend Server
                </h2>
                <p className="text-sm text-muted-foreground">
                  Address of the backend. Use <code className="bg-muted px-1 py-0.5 rounded">/api</code>{" "}
                  when accessing through the bundled web app, or an IP like{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">192.168.1.100</code> for direct LAN access.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="server">Server Address</Label>
                <Input
                  id="server"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="/api or 192.168.1.100"
                />
              </div>
              <Button onClick={handleSave}>Save</Button>
              {savedMessage && (
                <Alert variant="success">
                  <AlertDescription>{savedMessage}</AlertDescription>
                </Alert>
              )}
            </section>

            <hr className="border-border" />

            {/* Theme */}
            <section className="space-y-3">
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
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
