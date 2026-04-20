"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { storage } from "@/lib/storage";
import type { Role } from "@/lib/types";

// ---------------------------------------------------------------------------
// Auth context.
//
// Role resolution has three layers so Developers can test the app as
// any other role without losing their real role in the DB:
//
//   actualRole     = whatever the JWT (and DB) says — e.g. "Developer"
//   roleOverride   = Developer-only: the role they're *currently testing as*,
//                    stored in localStorage. Ignored for all other roles.
//   effectiveRole  = what the UI acts as. Equals actualRole unless a
//                    Developer has set an override.
//   role           = what's exposed to consumers. Equals effectiveRole,
//                    except `"Developer"` resolves to `"Admin"` so every
//                    existing `role === "Admin"` gate keeps working for
//                    Developers by default.
//
// Backend auth is advisory (per CLAUDE.md) — routes don't enforce role,
// the frontend does — so mutating the effective role client-side is
// sufficient to test every UX perspective.
// ---------------------------------------------------------------------------

interface AuthState {
  isLoggedIn: boolean;
  username: string | null;
  actualRole: Role | null;
  roleOverride: Role | null;
}

type LoginResult = "success" | "pending" | "rejected" | "error";

interface AuthContextValue {
  isLoggedIn: boolean;
  username: string | null;
  /** Role exposed to the app. Developer resolves to Admin for gating. */
  role: Role | null;
  /** The real role from the JWT. */
  actualRole: Role | null;
  /** Convenience — true when actualRole is "Developer". */
  isDeveloper: boolean;
  /** Developer-only: current override, or null when unset. */
  roleOverride: Role | null;
  /** Developer-only: swap the role the UI acts as. Pass null to reset. */
  setRoleOverride: (role: Role | null) => void;
  login: (
    username: string,
    password: string,
  ) => Promise<{ result: LoginResult; message?: string }>;
  register: (
    username: string,
    password: string,
  ) => Promise<{ result: "success" | "error"; message?: string }>;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/**
 * Only these roles are legal for a Developer to impersonate.
 * Exported so the /developer page can enumerate the same set.
 */
export const IMPERSONATABLE_ROLES: Role[] = [
  "Developer",
  "Admin",
  "Content Creators",
  "Listing Executives",
];

function resolveRole(actualRole: Role | null, override: Role | null): Role | null {
  if (!actualRole) return null;
  // Override is only honored when the real role is Developer.
  const effective = actualRole === "Developer" && override ? override : actualRole;
  // Developer itself gets admin-level access everywhere in the UI.
  return effective === "Developer" ? "Admin" : effective;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({
    isLoggedIn: false,
    username: null,
    actualRole: null,
    roleOverride: null,
  });

  React.useEffect(() => {
    const token = storage.getToken();
    const username = storage.getUsername();
    const actualRole = storage.getRole() as Role | null;
    const override = storage.getRoleOverride() as Role | null;
    if (token && username && actualRole) {
      setState({
        isLoggedIn: true,
        username,
        actualRole,
        // Safety: ignore a stale override if the user's real role isn't Developer.
        roleOverride: actualRole === "Developer" ? override : null,
      });
    }
  }, []);

  const login = React.useCallback(
    async (
      username: string,
      password: string,
    ): Promise<{ result: LoginResult; message?: string }> => {
      try {
        const body = new URLSearchParams();
        body.append("username", username);
        body.append("password", password);
        const res = await api().post("/users/login", body, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        const { access_token, role } = res.data;
        storage.setToken(access_token);
        storage.setUsername(username);
        storage.setRole(role);
        // A fresh login clears any prior impersonation.
        storage.setRoleOverride(null);
        setState({
          isLoggedIn: true,
          username,
          actualRole: role,
          roleOverride: null,
        });
        return { result: "success" };
      } catch (e: unknown) {
        const err = e as {
          response?: { status?: number; data?: { detail?: string } };
        };
        const status = err.response?.status;
        const detail = String(err.response?.data?.detail ?? "");
        if (status === 403) {
          if (detail.includes("pending_approval")) return { result: "pending" };
          if (detail.includes("rejected")) return { result: "rejected" };
        }
        if (status === 400)
          return { result: "error", message: "Incorrect username or password." };
        return {
          result: "error",
          message: "Cannot reach server. Check the address in Developer menu.",
        };
      }
    },
    [],
  );

  const register = React.useCallback(
    async (
      username: string,
      password: string,
    ): Promise<{ result: "success" | "error"; message?: string }> => {
      try {
        await api().post("/users/register", { username, password });
        return { result: "success" };
      } catch (e: unknown) {
        const err = e as {
          response?: { status?: number; data?: { detail?: string } };
        };
        const detail = err.response?.data?.detail;
        return {
          result: "error",
          message: typeof detail === "string" ? detail : "Registration failed.",
        };
      }
    },
    [],
  );

  const logout = React.useCallback(() => {
    storage.clearAuth();
    setState({ isLoggedIn: false, username: null, actualRole: null, roleOverride: null });
  }, []);

  const setRoleOverride = React.useCallback((next: Role | null) => {
    setState((prev) => {
      // Only Developers can impersonate — ignore calls from anyone else.
      if (prev.actualRole !== "Developer") return prev;
      const sanitized =
        next && IMPERSONATABLE_ROLES.includes(next) ? next : null;
      storage.setRoleOverride(sanitized);
      return { ...prev, roleOverride: sanitized };
    });
  }, []);

  const role = resolveRole(state.actualRole, state.roleOverride);
  const isDeveloper = state.actualRole === "Developer";

  const value: AuthContextValue = {
    isLoggedIn: state.isLoggedIn,
    username: state.username,
    role,
    actualRole: state.actualRole,
    isDeveloper,
    roleOverride: state.roleOverride,
    setRoleOverride,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
