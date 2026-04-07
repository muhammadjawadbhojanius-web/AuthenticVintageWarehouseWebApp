"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { storage } from "@/lib/storage";
import type { Role } from "@/lib/types";

interface AuthState {
  isLoggedIn: boolean;
  username: string | null;
  role: Role | null;
}

type LoginResult = "success" | "pending" | "rejected" | "error";

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<{ result: LoginResult; message?: string }>;
  register: (username: string, password: string) => Promise<{ result: "success" | "error"; message?: string }>;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({
    isLoggedIn: false,
    username: null,
    role: null,
  });

  React.useEffect(() => {
    const token = storage.getToken();
    const username = storage.getUsername();
    const role = storage.getRole();
    if (token && username && role) {
      setState({ isLoggedIn: true, username, role });
    }
  }, []);

  const login = React.useCallback(
    async (username: string, password: string): Promise<{ result: LoginResult; message?: string }> => {
      try {
        // FastAPI OAuth2PasswordRequestForm expects form-encoded body
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
        setState({ isLoggedIn: true, username, role });
        return { result: "success" };
      } catch (e: unknown) {
        // axios error handling
        const err = e as { response?: { status?: number; data?: { detail?: string } } };
        const status = err.response?.status;
        const detail = String(err.response?.data?.detail ?? "");
        if (status === 403) {
          if (detail.includes("pending_approval")) return { result: "pending" };
          if (detail.includes("rejected")) return { result: "rejected" };
        }
        if (status === 400) return { result: "error", message: "Incorrect username or password." };
        return {
          result: "error",
          message: "Cannot reach server. Check the address in Settings.",
        };
      }
    },
    []
  );

  const register = React.useCallback(
    async (username: string, password: string): Promise<{ result: "success" | "error"; message?: string }> => {
      try {
        await api().post("/users/register", { username, password });
        return { result: "success" };
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { detail?: string } } };
        const detail = err.response?.data?.detail;
        return {
          result: "error",
          message: typeof detail === "string" ? detail : "Registration failed.",
        };
      }
    },
    []
  );

  const logout = React.useCallback(() => {
    storage.clearAuth();
    setState({ isLoggedIn: false, username: null, role: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
