/**
 * lib/run-track.ts
 *
 * The run as a sequence of events, and the reducer that turns them into
 * recorder state. Pure — no React, no Expo — so the same code runs live
 * as fixes arrive and when replaying a run file after a crash.
 *
 * Distance here is for the live readout only. The server recomputes
 * everything from the points on upload.
 */

import type { TrackPoint } from "./api/types";

/**
 * One line of a run file. Times are ms since epoch. `userId` on start is
 * the signed-in user who recorded the run; recovery discards the file if
 * someone else is signed in, since a GPS trace shows where its owner lives.
 */
export type RunEvent =
  | { type: "start"; at: number; userId: number }
  | { type: "point"; at: number; lat: number; lng: number; ele: number | null }
  | { type: "pause"; at: number }
  | { type: "resume"; at: number }
  | { type: "stop"; at: number };

export interface RunState {
  /** From the start event. Undefined for files written before it existed. */
  userId: number | undefined;
  status: "recording" | "paused" | "stopped";
  startedAt: number;
  endedAt: number | null;
  points: TrackPoint[];
  /** Active (unpaused) time from closed segments. */
  accumulatedMs: number;
  /** Start of the open segment, or null when paused/stopped. */
  segmentStart: number | null;
  distanceM: number;
  /**
   * Last point distance was measured from. Cleared on resume so the gap
   * covered while paused isn't counted.
   */
  anchor: { lat: number; lng: number; at: number } | null;
  /** Time of the latest event applied. */
  lastAt: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

// Copied from backend/workouts/services.py — keep them in sync. Both sides
// measure from the last kept fix, but the live figure is only an
// approximation of what the server will report: the recorder drops
// low-accuracy fixes and doesn't count distance covered while paused,
// and the server does neither.
export const MIN_SEGMENT_M = 5.0;
export const MAX_PLAUSIBLE_SPEED_MS = 12.0;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function activeElapsedMs(state: RunState, now: number): number {
  return state.accumulatedMs + (state.segmentStart === null ? 0 : now - state.segmentStart);
}

/**
 * Applies one event. Returns the same object if the event doesn't apply
 * (e.g. a point while paused), so callers can skip a re-render.
 * `state` is null only before the start event.
 *
 * Live updates need a new `points` array each time so React sees the
 * change. Replay passes `inPlace` to append to the existing array instead,
 * which keeps rebuilding a long run linear rather than quadratic.
 */
export function applyEvent(
  state: RunState | null,
  event: RunEvent,
  inPlace = false,
): RunState | null {
  if (event.type === "start") {
    return {
      userId: event.userId,
      status: "recording",
      startedAt: event.at,
      endedAt: null,
      points: [],
      accumulatedMs: 0,
      segmentStart: event.at,
      distanceM: 0,
      anchor: null,
      lastAt: event.at,
    };
  }
  if (state === null || state.status === "stopped") return state;

  switch (event.type) {
    case "point": {
      if (state.status !== "recording") return state;
      const point: TrackPoint = {
        lat: event.lat,
        lng: event.lng,
        timestamp: new Date(event.at).toISOString(),
        elevation: event.ele,
      };
      let points = state.points;
      if (inPlace) points.push(point);
      else points = [...points, point];
      const next: RunState = { ...state, points, lastAt: event.at };

      const anchor = state.anchor;
      if (anchor === null) {
        next.anchor = { lat: event.lat, lng: event.lng, at: event.at };
        return next;
      }
      const elapsedS = (event.at - anchor.at) / 1000;
      if (elapsedS <= 0) return next;
      const segmentM = haversineM(anchor.lat, anchor.lng, event.lat, event.lng);
      // A glitch: keep the anchor so the next good fix measures from it.
      if (segmentM / elapsedS > MAX_PLAUSIBLE_SPEED_MS) return next;
      // Jitter: keep the anchor so slow, steady movement still accumulates
      // once it clears the threshold.
      if (segmentM < MIN_SEGMENT_M) return next;

      next.anchor = { lat: event.lat, lng: event.lng, at: event.at };
      next.distanceM = state.distanceM + segmentM;
      return next;
    }
    case "pause":
      if (state.status !== "recording") return state;
      return {
        ...state,
        status: "paused",
        accumulatedMs: activeElapsedMs(state, event.at),
        segmentStart: null,
        lastAt: event.at,
      };
    case "resume":
      if (state.status !== "paused") return state;
      return { ...state, status: "recording", segmentStart: event.at, anchor: null, lastAt: event.at };
    case "stop":
      return {
        ...state,
        status: "stopped",
        endedAt: event.at,
        accumulatedMs: activeElapsedMs(state, event.at),
        segmentStart: null,
        lastAt: event.at,
      };
  }
}

export function replay(events: RunEvent[]): RunState | null {
  let state: RunState | null = null;
  for (const event of events) state = applyEvent(state, event, true);
  return state;
}
