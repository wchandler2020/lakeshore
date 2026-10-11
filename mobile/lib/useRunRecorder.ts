/**
 * lib/useRunRecorder.ts
 *
 * Records a run from the device GPS. Accumulates TrackPoints while
 * recording and exposes live elapsed time, distance and pace for display.
 *
 * Distance and pace here are for the live readout only — the server
 * recomputes everything from `points` on upload, so nothing computed in
 * this file is ever sent.
 */

import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TrackPoint } from "./api/types";

export type RecorderStatus = "idle" | "starting" | "recording" | "paused" | "stopped";

export interface RecordedRun {
  started_at: string;
  ended_at: string;
  points: TrackPoint[];
}

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_MILE = 1609.344;

// Copied from backend/workouts/services.py — keep them in sync. Both sides
// measure from the last kept fix, but the live figure is only an
// approximation of what the server will report: this hook drops
// low-accuracy fixes and doesn't count distance covered while paused,
// and the server does neither.
const MIN_SEGMENT_M = 5.0;
const MAX_PLAUSIBLE_SPEED_MS = 12.0;

// Fixes worse than this are dropped entirely. The first few fixes after
// the GPS wakes up are often 50–100 m off and would show up as a jump.
const MAX_HORIZONTAL_ACCURACY_M = 30;

// Current pace is averaged over this trailing window. A single 1 s
// segment is far too noisy to show.
const PACE_WINDOW_MS = 20_000;

// Below this speed (~60 min/mi) we show no pace rather than a huge number.
const MIN_PACE_SPEED_MS = 0.45;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

interface DistanceSample {
  t: number;
  cumulativeM: number;
}

export function useRunRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [paceSPerMi, setPaceSPerMi] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs are the source of truth; state mirrors them for rendering. The
  // location callback and stop() need current values without waiting on
  // a re-render.
  const statusRef = useRef<RecorderStatus>("idle");
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const pointsRef = useRef<TrackPoint[]>([]);
  const startedAtRef = useRef<number | null>(null);
  // Active (unpaused) time: completed segments plus the open one.
  const accumulatedMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);
  // Last point distance was measured from. Cleared on resume so the gap
  // walked while paused isn't counted.
  const anchorRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const distanceRef = useRef(0);
  const paceSamplesRef = useRef<DistanceSample[]>([]);
  // Bumped on every start/stop so a watchPositionAsync that resolves after
  // stop() or unmount knows to tear itself down.
  const sessionRef = useRef(0);

  const setStatusBoth = useCallback((next: RecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const activeElapsedMs = useCallback(() => {
    const open = segmentStartRef.current;
    return accumulatedMsRef.current + (open === null ? 0 : Date.now() - open);
  }, []);

  const removeSubscription = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  }, []);

  const handleLocation = useCallback((loc: Location.LocationObject) => {
    if (statusRef.current !== "recording") return;

    const { latitude, longitude, altitude, accuracy } = loc.coords;
    const t = loc.timestamp;

    // iOS can hand back a cached fix from before the current segment.
    if (segmentStartRef.current === null || t < segmentStartRef.current) return;
    if (accuracy !== null && accuracy > MAX_HORIZONTAL_ACCURACY_M) return;

    const point: TrackPoint = {
      lat: latitude,
      lng: longitude,
      timestamp: new Date(t).toISOString(),
      elevation: altitude,
    };
    pointsRef.current.push(point);
    setPoints(pointsRef.current.slice());

    const anchor = anchorRef.current;
    if (anchor === null) {
      anchorRef.current = { lat: latitude, lng: longitude, t };
      return;
    }

    const elapsedS = (t - anchor.t) / 1000;
    if (elapsedS <= 0) return;
    const segmentM = haversineM(anchor.lat, anchor.lng, latitude, longitude);

    // A glitch: keep the anchor so the next good fix measures from it.
    if (segmentM / elapsedS > MAX_PLAUSIBLE_SPEED_MS) return;
    // Jitter: keep the anchor so slow, steady movement still accumulates
    // once it clears the threshold.
    if (segmentM < MIN_SEGMENT_M) return;

    anchorRef.current = { lat: latitude, lng: longitude, t };
    distanceRef.current += segmentM;
    setDistanceM(distanceRef.current);

    const samples = paceSamplesRef.current;
    samples.push({ t, cumulativeM: distanceRef.current });
    while (samples.length > 0 && t - samples[0].t > PACE_WINDOW_MS) samples.shift();
  }, []);

  const subscribe = useCallback(async () => {
    const session = sessionRef.current;
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
      },
      handleLocation,
      (reason) => setError(reason),
    );
    if (session !== sessionRef.current) {
      // stop() or unmount happened while we were waiting.
      sub.remove();
      return;
    }
    subscriptionRef.current = sub;
  }, [handleLocation]);

  const start = useCallback(async () => {
    if (statusRef.current === "starting" || statusRef.current === "recording" || statusRef.current === "paused") {
      return;
    }
    setError(null);
    setStatusBoth("starting");
    const session = ++sessionRef.current;

    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (session !== sessionRef.current) return;
      if (!granted) {
        setError("Location permission is required to record a run.");
        setStatusBoth("idle");
        return;
      }

      const now = Date.now();
      pointsRef.current = [];
      startedAtRef.current = now;
      accumulatedMsRef.current = 0;
      segmentStartRef.current = now;
      anchorRef.current = null;
      distanceRef.current = 0;
      paceSamplesRef.current = [];
      setPoints([]);
      setElapsedMs(0);
      setDistanceM(0);
      setPaceSPerMi(null);
      setStatusBoth("recording");

      await subscribe();
    } catch (e) {
      if (session !== sessionRef.current) return;
      removeSubscription();
      setError(e instanceof Error ? e.message : String(e));
      setStatusBoth("idle");
    }
  }, [removeSubscription, setStatusBoth, subscribe]);

  const pause = useCallback(() => {
    if (statusRef.current !== "recording") return;
    accumulatedMsRef.current = activeElapsedMs();
    segmentStartRef.current = null;
    paceSamplesRef.current = [];
    setElapsedMs(accumulatedMsRef.current);
    setPaceSPerMi(null);
    setStatusBoth("paused");
  }, [activeElapsedMs, setStatusBoth]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    segmentStartRef.current = Date.now();
    anchorRef.current = null;
    setStatusBoth("recording");
  }, [setStatusBoth]);

  /**
   * Ends the recording and returns everything the upload needs. Returns
   * null if nothing was being recorded.
   */
  const stop = useCallback((): RecordedRun | null => {
    const current = statusRef.current;
    if (current !== "starting" && current !== "recording" && current !== "paused") {
      return null;
    }
    sessionRef.current++;
    removeSubscription();

    accumulatedMsRef.current = activeElapsedMs();
    segmentStartRef.current = null;
    setElapsedMs(accumulatedMsRef.current);
    setPaceSPerMi(null);

    const startedAt = startedAtRef.current;
    if (startedAt === null) {
      // Stopped while still waiting on the permission prompt.
      setStatusBoth("idle");
      return null;
    }
    setStatusBoth("stopped");
    return {
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date().toISOString(),
      points: pointsRef.current.slice(),
    };
  }, [activeElapsedMs, removeSubscription, setStatusBoth]);

  /** Clears a stopped recording so the hook is ready for another run. */
  const reset = useCallback(() => {
    if (statusRef.current === "recording" || statusRef.current === "paused") return;
    sessionRef.current++;
    removeSubscription();
    pointsRef.current = [];
    startedAtRef.current = null;
    accumulatedMsRef.current = 0;
    segmentStartRef.current = null;
    anchorRef.current = null;
    distanceRef.current = 0;
    paceSamplesRef.current = [];
    setPoints([]);
    setElapsedMs(0);
    setDistanceM(0);
    setPaceSPerMi(null);
    setError(null);
    setStatusBoth("idle");
  }, [removeSubscription, setStatusBoth]);

  // Tick the clock and recompute pace once a second while recording.
  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => {
      setElapsedMs(activeElapsedMs());

      const samples = paceSamplesRef.current;
      const now = Date.now();
      while (samples.length > 0 && now - samples[0].t > PACE_WINDOW_MS) samples.shift();
      if (samples.length < 2) {
        setPaceSPerMi(null);
        return;
      }
      const first = samples[0];
      const last = samples[samples.length - 1];
      const speedMs = (last.cumulativeM - first.cumulativeM) / ((last.t - first.t) / 1000);
      setPaceSPerMi(speedMs >= MIN_PACE_SPEED_MS ? METERS_PER_MILE / speedMs : null);
    }, 1000);
    return () => clearInterval(id);
  }, [status, activeElapsedMs]);

  useEffect(
    () => () => {
      sessionRef.current++;
      removeSubscription();
    },
    [removeSubscription],
  );

  return {
    status,
    error,
    /** Active time in ms, excluding pauses. */
    elapsedMs,
    /** Live distance in meters. Display only — the server recomputes. */
    distanceM,
    /** Seconds per mile over the last ~20 s, or null when stopped/too slow. */
    paceSPerMi,
    points,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
