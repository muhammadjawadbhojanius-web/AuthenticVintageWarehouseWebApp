import axios, { AxiosInstance } from "axios";
import { storage } from "./storage";

/**
 * Resolves the API base URL from settings.
 * - "/api" or starts with "/" → relative path (works behind nginx proxy)
 * - "http..." → absolute URL
 * - bare host/IP → prepend "http://" and append :8080
 */
export function resolveBaseUrl(): string {
  const addr = storage.getBaseAddress();
  if (addr.startsWith("/") || addr.startsWith("http")) return addr;
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
