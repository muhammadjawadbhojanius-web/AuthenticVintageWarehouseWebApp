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
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot-password modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotPassword, setForgotPassword] = useState("");
  const [forgotConfirm, setForgotConfirm] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError("Username and password are required.");
      return;
    }
    if (!isLogin && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        const { result, message } = await login(username, password);
        if (result === "success") {
          router.replace("/bundles");
        } else if (result === "pending") {
          router.replace("/status?status=pending");
        } else if (result === "rejected") {
          router.replace("/status?status=rejected");
        } else {
          setError(message ?? "Login failed.");
        }
      } else {
        const { result, message } = await register(username, password);
        if (result === "success") {
          // Try to log in immediately. First user is auto-approved as Admin.
          const r = await login(username, password);
          if (r.result === "success") {
            router.replace("/bundles");
          } else if (r.result === "pending") {
            router.replace("/status?status=pending");
          } else {
            router.replace("/status?status=pending");
          }
        } else {
          setError(message ?? "Registration failed.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const openForgot = () => {
    setForgotUsername(username); // pre-fill if they typed it
    setForgotPassword("");
    setForgotConfirm("");
    setForgotError(null);
    setForgotDone(false);
    setForgotOpen(true);
  };

  const submitForgot = async () => {
    setForgotError(null);
    if (!forgotUsername.trim()) {
      setForgotError("Username is required.");
      return;
    }
    if (!forgotPassword) {
      setForgotError("Enter a new password.");
      return;
    }
    if (forgotPassword !== forgotConfirm) {
      setForgotError("Passwords do not match.");
      return;
    }
    setForgotLoading(true);
    try {
      await resetPassword(forgotUsername.trim(), forgotPassword);
      setForgotDone(true);
    } catch (e: unknown) {
      let message = "Could not reset password.";
      if (axios.isAxiosError(e)) {
        const status = e.response?.status;
        const detail = e.response?.data?.detail;
        if (status === 403) {
          message =
            typeof detail === "string"
              ? detail
              : "This account's password cannot be reset.";
        } else if (status === 404) {
          message = "No user with that username.";
        } else if (typeof detail === "string") {
          message = detail;
        }
      }
      setForgotError(message);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-baseline justify-center gap-2">
          <span className="text-3xl font-bold text-amber-700 dark:text-amber-500">Authentic</span>
          <span className="text-2xl font-black tracking-widest">VINTAGE</span>
        </div>
        <Card>
          <CardContent className="pt-6">
            <h1 className="mb-6 text-center text-xl font-semibold">
              {isLogin ? "Sign In" : "Create Account"}
            </h1>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Toggle password visibility"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm Password</Label>
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
                {loading ? <Spinner className="h-4 w-4" /> : isLogin ? "Sign In" : "Create Account"}
              </Button>
            </form>
            <div className="mt-4 space-y-2 text-center text-sm">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin((v) => !v);
                    setError(null);
                  }}
                  className="text-primary hover:underline"
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
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="mt-4 text-center">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" />
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
                <Input
                  id="forgot-username"
                  value={forgotUsername}
                  onChange={(e) => setForgotUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-password">New password</Label>
                <Input
                  id="forgot-password"
                  type="password"
                  value={forgotPassword}
                  onChange={(e) => setForgotPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-confirm">Confirm new password</Label>
                <Input
                  id="forgot-confirm"
                  type="password"
                  value={forgotConfirm}
                  onChange={(e) => setForgotConfirm(e.target.value)}
                  autoComplete="new-password"
                />
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
              <Button onClick={() => setForgotOpen(false)} className="w-full">
                OK
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setForgotOpen(false)} disabled={forgotLoading}>
                  Cancel
                </Button>
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
