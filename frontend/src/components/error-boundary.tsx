"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface State {
  error: Error | null;
}

/**
 * Catches render-phase errors anywhere in the tree and shows a recovery
 * screen instead of a blank page. Typical trigger: a settings value that
 * makes the API return a non-list response and a component crashes while
 * trying to iterate it. We give the user a way to get to Settings and to
 * reload the page.
 *
 * Must be a class component — React's error-boundary lifecycle hooks
 * (getDerivedStateFromError / componentDidCatch) aren't exposed to
 * function components.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console so a developer still sees the stack.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  handleGoToSettings = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/settings";
    }
  };

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md p-6">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive/15"
            >
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold leading-tight">
                Something went wrong
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A page threw an unexpected error. This often happens when the
                backend server address in Settings is wrong and the response
                isn&apos;t in the expected shape.
              </p>
              <p className="mt-2 text-xs font-mono text-muted-foreground break-words">
                {this.state.error.message || String(this.state.error)}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={this.handleGoToSettings}>
              <SettingsIcon className="h-4 w-4" />
              Open Settings
            </Button>
            <Button onClick={this.handleReload}>
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
