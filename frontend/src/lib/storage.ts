// localStorage helpers — guarded for SSR

const KEYS = {
  token: "auth_token",
  username: "username",
  role: "role",
  baseAddress: "base_address",
  themeMode: "theme_mode",
  roleOverride: "role_override", // Developer-only: simulate another role
} as const;

export type ThemeMode = "light" | "dark" | "system";

export const storage = {
  getToken: () => (typeof window === "undefined" ? null : localStorage.getItem(KEYS.token)),
  setToken: (v: string) => localStorage.setItem(KEYS.token, v),

  getUsername: () => (typeof window === "undefined" ? null : localStorage.getItem(KEYS.username)),
  setUsername: (v: string) => localStorage.setItem(KEYS.username, v),

  getRole: () => (typeof window === "undefined" ? null : localStorage.getItem(KEYS.role)),
  setRole: (v: string) => localStorage.setItem(KEYS.role, v),

  clearAuth: () => {
    localStorage.removeItem(KEYS.token);
    localStorage.removeItem(KEYS.username);
    localStorage.removeItem(KEYS.role);
    localStorage.removeItem(KEYS.roleOverride);
  },

  getRoleOverride: () =>
    typeof window === "undefined" ? null : localStorage.getItem(KEYS.roleOverride),
  setRoleOverride: (v: string | null) => {
    if (v) localStorage.setItem(KEYS.roleOverride, v);
    else localStorage.removeItem(KEYS.roleOverride);
  },

  getBaseAddress: () => {
    if (typeof window === "undefined") return "/api";
    return localStorage.getItem(KEYS.baseAddress) || "/api";
  },
  setBaseAddress: (v: string) => localStorage.setItem(KEYS.baseAddress, v),

  getThemeMode: (): ThemeMode => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(KEYS.themeMode) as ThemeMode) || "system";
  },
  setThemeMode: (v: ThemeMode) => localStorage.setItem(KEYS.themeMode, v),
};
