/**
 * lib/api/endpoints.ts
 *
 * Typed wrappers for each backend endpoint. Screens call these rather
 * than using axios directly, so URL changes land in one place.
 */

import { api, tokens } from "./client";
import type {
  GeneratedRoute,
  RouteGenerationResponse,
  TrackPoint,
  User,
  Workout,
  WorkoutDetail,
} from "./types";

// ── Auth ─────────────────────────────────────────────────────────

export const auth = {
  async register(input: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
  }) {
    const { data } = await api.post("/api/v1/auth/register/", input);
    return data;
  },

  /** `identifier` accepts either a username or an email address. */
  async login(identifier: string, password: string) {
    const { data } = await api.post("/api/v1/auth/login/", {
      username: identifier,
      password,
    });
    await tokens.set(data.access, data.refresh);
    return data;
  },

  async logout() {
    await tokens.clear();
  },

  async me(): Promise<User> {
    const { data } = await api.get("/api/v1/auth/me/");
    return data;
  },

  async updateProfile(patch: Record<string, unknown>): Promise<User> {
    const { data } = await api.patch("/api/v1/auth/me/", patch);
    return data;
  },
};

// ── Routes ───────────────────────────────────────────────────────

export const routes = {
  /**
   * Generate loop options from a start point. The backend samples many
   * seeds concurrently and returns the closest matches — expect roughly
   * 1–2% distance error with the default sample count.
   */
  async generate(input: {
    lat: number;
    lng: number;
    distance: number;
    units?: "mi" | "km" | "m";
    profile?: "foot" | "bike";
    samples?: number;
    count?: number;
  }): Promise<GeneratedRoute[]> {
    const { data } = await api.post<RouteGenerationResponse>(
      "/api/v1/routes/generate/",
      { units: "mi", profile: "foot", ...input },
    );
    return data.routes;
  },
};

// ── Workouts ─────────────────────────────────────────────────────

export const workouts = {
  async list(page = 1): Promise<{ count: number; results: Workout[] }> {
    const { data } = await api.get("/api/v1/workouts/", {
      params: { page },
    });
    return data;
  },

  async get(id: number): Promise<WorkoutDetail> {
    const { data } = await api.get(`/api/v1/workouts/${id}/`);
    return data;
  },

  /**
   * Upload a recorded run. Distance, splits, pace and elevation are all
   * computed server-side from `points` — don't send totals, they're
   * ignored.
   */
  async create(input: {
    activity_type?: string;
    source?: string;
    privacy?: string;
    title?: string;
    notes?: string;
    started_at: string;
    ended_at: string;
    points?: TrackPoint[];
  }): Promise<WorkoutDetail> {
    const { data } = await api.post("/api/v1/workouts/", input);
    return data;
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/api/v1/workouts/${id}/`);
  },
};