import axios, { AxiosInstance } from "axios";
import { storage } from "./storage";

/**
 * Resolves the API base URL from settings.
 * - "/api" or starts with "/" → relative path (works behind nginx proxy)
 * - "http..." → absolute URL
 * - bare host/IP → prepend "http://" and append :8080
 * - anything empty / whitespace / clearly malformed → safe default "/api"
 *   (so a mistyped Settings value can't silently point at a junk URL
 *   that returns HTML and blows up the render layer)
 */
export function resolveBaseUrl(): string {
  const raw = storage.getBaseAddress();
  const addr = (raw || "").trim();
  if (!addr) return "/api";
  if (addr.startsWith("/")) return addr;
  if (addr.startsWith("http://") || addr.startsWith("https://")) return addr;
  // Bare host/IP — must be a plausible hostname, not random text.
  // Hostnames / IPs only contain alphanumerics, dots, and hyphens.
  if (!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(addr)) return "/api";
  return `http://${addr}:8080`;
}

let instance: AxiosInstance | null = null;

export function api(): AxiosInstance {
  if (instance) return instance;
  instance = axios.create({
    baseURL: resolveBaseUrl(),
    timeout: 30_000,
  });
  instance.interceptors.request.use((config) => {
    const token = storage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  return instance;
}

export function resetApiClient() {
  instance = null;
}
