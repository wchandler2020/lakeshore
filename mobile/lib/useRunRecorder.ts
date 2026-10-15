/**
 * lib/useRunRecorder.ts
 *
 * Records a run from the device GPS and exposes live elapsed time,
 * distance and pace for display.
 *
 * Every fix and every start/pause/resume/stop is appended to a run file
 * on disk (lib/run-log.ts) before it's shown, so the file is the record
 * of the run and the on-screen state is a cache of it. Fixes come from
 * the background location task in lib/run-location-task.ts, which keeps
 * recording while the phone is locked; GPS updates run only while the
 * run is recording, not while it's paused. stop() reads the
 * file back to build the upload. If the app dies mid-run, the next launch
 * replays the file and the run comes back paused, or ready to upload if
 * it had already been stopped.
 *
 * Distance and pace here are for the live readout only — the server
 * recomputes everything from `points` on upload.
 */

import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TrackPoint } from "./api/types";
import { appendEvent, createRun, deleteRun, listRuns, newRunId, readEvents } from "./run-log";
import {
  attachRun,
  commitRunEvent,
  detachRun,
  startRunLocationUpdates,
  stopRunLocationUpdates,
  subscribeRun,
} from "./run-location-task";
import { applyEvent, replay, type RunEvent, type RunState } from "./run-track";

export type RecorderStatus = "idle" | "starting" | "recording" | "paused" | "stopped";

export interface RecordedRun {
  started_at: string;
  ended_at: string;
  points: TrackPoint[];
}

const METERS_PER_MILE = 1609.344;

// Current pace is averaged over this trailing window. A single 1 s
// segment is far too noisy to show.
const PACE_WINDOW_MS = 20_000;

// Below this speed (~60 min/mi) we show no pace rather than a huge number.
const MIN_PACE_SPEED_MS = 0.45;

const SAVE_ERROR = "Couldn't save GPS data to this device. Free up storage space.";

interface DistanceSample {
  t: number;
  cumulativeM: number;
}

function toRecordedRun(state: RunState, endedAt: number): RecordedRun {
  return {
    started_at: new Date(state.startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    points: state.points,
  };
}

/**
 * `userId` is the signed-in user. It's written into each new run file, and
 * recovery only restores a file that carries the same id.
 */
export function useRunRecorder(userId: number | null) {
  const [run, setRun] = useState<RunState | null>(null);
  const [starting, setStarting] = useState(false);
  const [stoppedRun, setStoppedRun] = useState<RecordedRun | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [paceSPerMi, setPaceSPerMi] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirrors of state for the callbacks below, which need current values
  // without waiting on a re-render.
  const runIdRef = useRef<string | null>(null);
  const runRef = useRef<RunState | null>(null);
  const startingRef = useRef(false);
  // Live-only; not worth persisting since a recovered run starts paused.
  const paceSamplesRef = useRef<DistanceSample[]>([]);
  // Bumped whenever location updates should stop (pause, stop, reset,
  // unmount) so a startLocationUpdatesAsync that resolves afterwards
  // knows to tear itself down.
  const sessionRef = useRef(0);

  const status: RecorderStatus = run?.status ?? (starting ? "starting" : "idle");

  const setRunBoth = useCallback((next: RunState | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const setStartingBoth = useCallback((next: boolean) => {
    startingRef.current = next;
    setStarting(next);
  }, []);

  // Every change to the run — control events from the buttons and fixes
  // from the background task — arrives here, after it's been written.
  useEffect(
    () =>
      subscribeRun((change) => {
        if (change.kind === "error") {
          setError(change.message);
          return;
        }
        const { event, state, saved } = change;
        if (!saved) setError(SAVE_ERROR);
        if (state === runRef.current) return;

        const before = runRef.current?.distanceM ?? 0;
        setRunBoth(state);
        setNow(Date.now());

        const after = state?.distanceM ?? before;
        if (event.type === "point" && after > before) {
          const samples = paceSamplesRef.current;
          samples.push({ t: event.at, cumulativeM: after });
          while (samples.length > 0 && event.at - samples[0].t > PACE_WINDOW_MS) samples.shift();
        }
      }),
    [setRunBoth],
  );

  const stopUpdates = useCallback(() => {
    sessionRef.current++;
    void stopRunLocationUpdates();
  }, []);

  /** Starts GPS updates, unless stopUpdates() is called while it's waiting. */
  const startUpdates = useCallback(async () => {
    const session = sessionRef.current;
    await startRunLocationUpdates();
    if (session !== sessionRef.current) await stopRunLocationUpdates();
  }, []);

  // Recover an interrupted run left on disk by a previous launch. Files
  // that are empty, unreadable or recorded by a different user are
  // deleted rather than offered for upload: a run belongs to whoever
  // recorded it, and a GPS trace shows where they live.
  useEffect(() => {
    if (userId === null || runIdRef.current !== null) return;
    let runIds: string[];
    try {
      runIds = listRuns();
    } catch {
      return;
    }

    let runId: string | undefined;
    let state: RunState | null = null;
    // Newest first, so discarding someone else's run doesn't hide an
    // older one of this user's.
    for (const candidate of runIds.reverse()) {
      try {
        state = replay(readEvents(candidate));
      } catch {
        state = null;
      }
      if (state !== null && state.userId === userId) {
        runId = candidate;
        break;
      }
      state = null;
      try {
        deleteRun(candidate);
      } catch {}
    }
    if (runId === undefined || state === null) return;

    // Updates left running by a previous JS context have nobody to
    // resume them for.
    void stopRunLocationUpdates();
    runIdRef.current = runId;
    runRef.current = state;
    attachRun(runId, state);
    if (state.status === "recording") {
      // The app died mid-run. We don't know what happened after the last
      // event, so close the segment there and come back paused.
      commitRunEvent({ type: "pause", at: state.lastAt });
    } else {
      setRunBoth(state);
    }
    if (state.status === "stopped" && state.endedAt !== null) {
      setStoppedRun(toRecordedRun(state, state.endedAt));
    }
    setRecovered(true);
  }, [userId, setRunBoth]);

  const start = useCallback(async () => {
    if (startingRef.current || runRef.current !== null || userId === null) return;
    setError(null);
    setRecovered(false);
    setStartingBoth(true);
    const session = ++sessionRef.current;

    let runId: string | null = null;
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (session !== sessionRef.current) return;
      if (!granted) {
        setError("Location permission is required to record a run.");
        setStartingBoth(false);
        return;
      }

      const at = Date.now();
      runId = newRunId(at);
      createRun(runId);
      runIdRef.current = runId;
      paceSamplesRef.current = [];
      setPaceSPerMi(null);
      const startEvent: RunEvent = { type: "start", at, userId };
      appendEvent(runId, startEvent);
      const state = applyEvent(null, startEvent);
      attachRun(runId, state);
      setRunBoth(state);
      setNow(at);
      setStartingBoth(false);

      await startUpdates();
    } catch (e) {
      if (session !== sessionRef.current) return;
      stopUpdates();
      detachRun();
      if (runId !== null) {
        try {
          deleteRun(runId);
        } catch {}
      }
      runIdRef.current = null;
      setRunBoth(null);
      setStartingBoth(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [userId, setRunBoth, setStartingBoth, startUpdates, stopUpdates]);

  const pause = useCallback(() => {
    if (runRef.current?.status !== "recording") return;
    commitRunEvent({ type: "pause", at: Date.now() });
    stopUpdates();
    paceSamplesRef.current = [];
    setPaceSPerMi(null);
  }, [stopUpdates]);

  const resume = useCallback(async () => {
    if (runRef.current?.status !== "paused") return;
    commitRunEvent({ type: "resume", at: Date.now() });
    try {
      await startUpdates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [startUpdates]);

  /**
   * Ends the recording and returns everything the upload needs, read back
   * from the run file. The run stays on disk (and in `stoppedRun`) until
   * reset(), so a failed upload can be retried, even after a relaunch.
   * Returns null if nothing was being recorded.
   */
  const stop = useCallback((): RecordedRun | null => {
    if (startingRef.current) {
      // Stopped while still waiting on the permission prompt.
      sessionRef.current++;
      setStartingBoth(false);
      return null;
    }
    const current = runRef.current;
    if (current?.status !== "recording" && current?.status !== "paused") return null;

    stopUpdates();
    const at = Date.now();
    commitRunEvent({ type: "stop", at });
    setPaceSPerMi(null);

    // Build the upload from the file, not memory. Fall back to memory only
    // if the file can't be read at all.
    let fromFile: RunState | null = null;
    try {
      fromFile = replay(readEvents(runIdRef.current!));
    } catch {
      setError(SAVE_ERROR);
    }
    const recorded = toRecordedRun(fromFile ?? runRef.current!, at);
    setStoppedRun(recorded);
    return recorded;
  }, [setStartingBoth, stopUpdates]);

  /**
   * Deletes the run file and clears the recorder. Call after a successful
   * upload, or to discard. Refuses while a run is active.
   */
  const reset = useCallback(() => {
    const current = runRef.current;
    if (current?.status === "recording" || current?.status === "paused") return;
    stopUpdates();
    detachRun();
    if (runIdRef.current !== null) {
      try {
        deleteRun(runIdRef.current);
      } catch {}
    }
    runIdRef.current = null;
    paceSamplesRef.current = [];
    setRunBoth(null);
    setStartingBoth(false);
    setStoppedRun(null);
    setRecovered(false);
    setPaceSPerMi(null);
    setError(null);
  }, [setRunBoth, setStartingBoth, stopUpdates]);

  // Tick the clock and recompute pace once a second while recording.
  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);

      const samples = paceSamplesRef.current;
      while (samples.length > 0 && t - samples[0].t > PACE_WINDOW_MS) samples.shift();
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
  }, [status]);

  // Leaving the screen (e.g. signing out) stops recording. The run stays
  // on disk and comes back paused through recovery on the next mount.
  useEffect(
    () => () => {
      stopUpdates();
      detachRun();
      runIdRef.current = null;
    },
    [stopUpdates],
  );

  const elapsedMs =
    run === null
      ? 0
      : run.accumulatedMs +
        (run.segmentStart === null ? 0 : Math.max(0, now - run.segmentStart));

  return {
    status,
    error,
    /** True when the current run was restored from disk after a relaunch. */
    recovered,
    /** Active time in ms, excluding pauses. */
    elapsedMs,
    /** Live distance in meters. Display only — the server recomputes. */
    distanceM: run?.distanceM ?? 0,
    /** Seconds per mile over the last ~20 s, or null when stopped/too slow. */
    paceSPerMi,
    points: run?.points ?? EMPTY_POINTS,
    /** The stopped run awaiting upload, if any. Cleared by reset(). */
    stoppedRun,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}

const EMPTY_POINTS: TrackPoint[] = [];
