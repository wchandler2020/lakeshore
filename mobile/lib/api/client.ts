/**
 * lib/api/client.ts
 *
 * Axios instance with automatic token refresh.
 *
 * The refresh interceptor is the part worth understanding: when a request
 * comes back 401, we pause it, refresh the access token once, and replay
 * the original request. Concurrent 401s queue behind a single refresh
 * rather than each firing their own — otherwise a screen that fires four
 * requests on mount triggers four refreshes and rotates the refresh token
 * out from under itself.
 */

import axios, {
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const ACCESS_KEY = "lakeshore.access";
const REFRESH_KEY = "lakeshore.refresh";

/**
 * On a simulator, localhost resolves to the simulator itself, not your Mac.
 * Expo exposes the dev machine's LAN address, so derive the host from it.
 * Set EXPO_PUBLIC_API_URL in .env to override (staging, physical device
 * on a different network, etc).
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    "";
  const host = hostUri.split(":")[0];

  if (host) return `http://${host}:8000`;
  return "http://localhost:8000";
}

export const API_BASE_URL = resolveBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

// ── Token storage ────────────────────────────────────────────────

export const tokens = {
  async get() {
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    return { access, refresh };
  },

  async set(access: string, refresh?: string) {
    const writes = [SecureStore.setItemAsync(ACCESS_KEY, access)];
    if (refresh) writes.push(SecureStore.setItemAsync(REFRESH_KEY, refresh));
    await Promise.all(writes);
  },

  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  },
};

// ── Request: attach the access token ─────────────────────────────

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const { access } = await tokens.get();
    if (access) {
      config.headers.Authorization = `Bearer ${access}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response: refresh once on 401, then replay ───────────────────

let refreshing: Promise<string | null> | null = null;

/** Called when refresh fails — the app should route back to login. */
let onAuthFailure: (() => void) | null = null;

export function setAuthFailureHandler(handler: () => void) {
  onAuthFailure = handler;
}

async function refreshAccessToken(): Promise<string | null> {
  const { refresh } = await tokens.get();
  if (!refresh) return null;

  try {
    // Deliberately a bare axios call, not `api` — going through the
    // instance would re-enter these interceptors and recurse.
    const response = await axios.post(
      `${API_BASE_URL}/api/v1/auth/login/refresh/`,
      { refresh },
      { headers: { "Content-Type": "application/json" } },
    );

    const newAccess: string = response.data.access;
    // SimpleJWT has ROTATE_REFRESH_TOKENS on, so a new refresh token
    // comes back too and the old one stops working. Store both.
    const newRefresh: string | undefined = response.data.refresh;

    await tokens.set(newAccess, newRefresh);
    return newAccess;
  } catch {
    await tokens.clear();
    onAuthFailure?.();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & {
      _retried?: boolean;
    };

    const isAuthError = error.response?.status === 401;
    const isRefreshCall = original?.url?.includes("/auth/login/refresh/");

    if (!isAuthError || original?._retried || isRefreshCall) {
      return Promise.reject(error);
    }

    original._retried = true;

    // Collapse concurrent refreshes into one in-flight promise.
    refreshing = refreshing ?? refreshAccessToken();
    const newAccess = await refreshing;
    refreshing = null;

    if (!newAccess) {
      return Promise.reject(error);
    }

    original.headers = {
      ...original.headers,
      Authorization: `Bearer ${newAccess}`,
    };
    return api(original);
  },
);
