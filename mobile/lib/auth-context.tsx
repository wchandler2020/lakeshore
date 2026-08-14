/**
 * lib/auth-context.tsx
 *
 * Session state for the whole app. Holds the current user, exposes
 * login/register/logout, and hooks into the API client's refresh-failure
 * path so an expired session routes back to the login screen rather than
 * leaving the UI in a broken half-authenticated state.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setAuthFailureHandler, tokens } from "./api/client";
import { auth } from "./api/endpoints";
import type { User } from "./api/types";

interface AuthState {
  user: User | null;
  /** True until the initial token check finishes. Gates routing. */
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on cold start. A stored token might be expired,
  // so we verify it against /me rather than trusting its presence.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { access } = await tokens.get();
        if (!access) return;

        const me = await auth.me();
        if (!cancelled) setUser(me);
      } catch {
        // Token is bad or the server is unreachable. Either way, start
        // signed out — the refresh interceptor already cleared storage
        // if it was an auth problem.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // When a refresh fails mid-session, drop the user immediately so the
  // root layout redirects to login.
  useEffect(() => {
    setAuthFailureHandler(() => setUser(null));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,

      async login(identifier, password) {
        await auth.login(identifier, password);
        setUser(await auth.me());
      },

      async register(input) {
        await auth.register(input);
        // Registration doesn't return tokens, so sign in straight after.
        await auth.login(input.username, input.password);
        setUser(await auth.me());
      },

      async logout() {
        await auth.logout();
        setUser(null);
      },

      async refreshUser() {
        setUser(await auth.me());
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
