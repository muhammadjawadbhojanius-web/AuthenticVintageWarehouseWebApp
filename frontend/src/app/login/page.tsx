"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { Eye, EyeOff, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { resetPassword } from "@/lib/queries";

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [isLogin, setIsLogin]   = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const [forgotOpen, setForgotOpen]         = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotPassword, setForgotPassword] = useState("");
  const [forgotConfirm, setForgotConfirm]   = useState("");
  const [forgotError, setForgotError]       = useState<string | null>(null);
  const [forgotLoading, setForgotLoading]   = useState(false);
  const [forgotDone, setForgotDone]         = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password) { setError("Username and password are required."); return; }
    if (!isLogin && password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      if (isLogin) {
        const { result, message } = await login(username, password);
        if (result === "success")  router.replace("/bundles");
        else if (result === "pending")  router.replace("/status?status=pending");
        else if (result === "rejected") router.replace("/status?status=rejected");
        else setError(message ?? "Login failed.");
      } else {
        const { result, message } = await register(username, password);
        if (result === "success") {
          const r = await login(username, password);
          if (r.result === "success") router.replace("/bundles");
          else router.replace("/status?status=pending");
        } else {
          setError(message ?? "Registration failed.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const openForgot = () => {
    setForgotUsername(username);
    setForgotPassword("");
    setForgotConfirm("");
    setForgotError(null);
    setForgotDone(false);
    setForgotOpen(true);
  };

  const submitForgot = async () => {
    setForgotError(null);
    if (!forgotUsername.trim()) { setForgotError("Username is required."); return; }
    if (!forgotPassword)        { setForgotError("Enter a new password."); return; }
    if (forgotPassword !== forgotConfirm) { setForgotError("Passwords do not match."); return; }
    setForgotLoading(true);
    try {
      await resetPassword(forgotUsername.trim(), forgotPassword);
      setForgotDone(true);
    } catch (e: unknown) {
      let message = "Could not reset password.";
      if (axios.isAxiosError(e)) {
        const status = e.response?.status;
        const detail = e.response?.data?.detail;
        if (status === 403)       message = typeof detail === "string" ? detail : "This account's password cannot be reset.";
        else if (status === 404)  message = "No user with that username.";
        else if (typeof detail === "string") message = detail;
      }
      setForgotError(message);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden p-4">
      {/* Ambient warm glow — adds depth without being distracting */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[40vh] w-[70vw] rounded-full bg-primary/8 blur-[80px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* ── Brand mark ─────────────────────────────────────────────────── */}
        <div className="mb-8 select-none text-center">
          <h1 className="font-display text-[3.5rem] font-light italic leading-none tracking-tight text-primary text-glow">
            Authentic
          </h1>
          <p className="mt-2 text-[10px] font-bold tracking-[0.4em] text-foreground/55 uppercase">
            Vintage · Warehouse
          </p>
          {/* Thin amber rule */}
          <div className="mx-auto mt-4 h-px w-10 bg-primary/40" />
        </div>

        {/* ── Auth card ──────────────────────────────────────────────────── */}
        <Card className="border-border/50 shadow-2xl shadow-black/10">
          <CardContent className="pt-6">
            <h2 className="mb-5 text-center text-sm font-semibold tracking-wide text-foreground/70 uppercase">
              {isLogin ? "Sign in to continue" : "Create your account"}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                  Username
                </Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your username"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/60 hover:text-foreground transition-colors"
                    aria-label="Toggle password visibility"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {!isLogin && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirm" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                    Confirm password
                  </Label>
                  <Input
                    id="confirm"
                    type={showPw ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? <Spinner className="h-4 w-4" />
                  : isLogin ? "Sign In" : "Create Account"}
              </Button>
            </form>

            <div className="mt-5 space-y-2 text-center text-sm">
              <div>
                <button
                  type="button"
                  onClick={() => { setIsLogin((v) => !v); setError(null); }}
                  className="text-primary/80 hover:text-primary transition-colors hover:underline underline-offset-4"
                >
                  {isLogin
                    ? "Don't have an account? Sign up"
                    : "Already have an account? Sign in"}
                </button>
              </div>
              {isLogin && (
                <div>
                  <button
                    type="button"
                    onClick={openForgot}
                    className="text-muted-foreground/70 hover:text-foreground transition-colors hover:underline underline-offset-4"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Settings link */}
        <div className="mt-5 text-center">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Server settings
          </Link>
        </div>
      </div>

      {/* Forgot password dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent onClose={() => setForgotOpen(false)}>
          <DialogHeader>
            <DialogTitle>Reset your password</DialogTitle>
            <DialogDescription>
              {forgotDone
                ? "Your password has been reset. Please go to your administrator in person — they need to re-approve your account before you can sign in."
                : "Enter your username and a new password. After resetting, you'll need to be re-approved by an administrator before you can sign in again."}
            </DialogDescription>
          </DialogHeader>

          {!forgotDone && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="forgot-username">Username</Label>
                <Input id="forgot-username" value={forgotUsername} onChange={(e) => setForgotUsername(e.target.value)} autoComplete="username" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-password">New password</Label>
                <Input id="forgot-password" type="password" value={forgotPassword} onChange={(e) => setForgotPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-confirm">Confirm new password</Label>
                <Input id="forgot-confirm" type="password" value={forgotConfirm} onChange={(e) => setForgotConfirm(e.target.value)} autoComplete="new-password" />
              </div>
              {forgotError && (
                <Alert variant="destructive">
                  <AlertDescription>{forgotError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            {forgotDone ? (
              <Button onClick={() => setForgotOpen(false)} className="w-full">OK</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setForgotOpen(false)} disabled={forgotLoading}>Cancel</Button>
                <Button onClick={submitForgot} disabled={forgotLoading}>
                  {forgotLoading ? <Spinner className="h-4 w-4" /> : "Reset Password"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
