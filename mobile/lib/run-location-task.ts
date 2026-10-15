/**
 * lib/run-location-task.ts
 *
 * The background location task that records a run while the phone is
 * locked or the app is in the background, and the in-memory run it
 * writes to.
 *
 * The task is defined at module top level so it's registered as soon as
 * the bundle loads — the OS can deliver fixes before any screen mounts.
 * app/_layout.tsx imports this file for that reason.
 *
 * Fixes arrive here in batches whether the app is foregrounded or not.
 * Each one is filtered by pointFromFix() and appended to the run file
 * through commitRunEvent(), the same path useRunRecorder uses for
 * start/pause/resume/stop, so there is one writer and one copy of the
 * run's state per JS context. The recorder hook subscribes to see the
 * changes.
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { appendEvent } from "./run-log";
import { applyEvent, pointFromFix, type RunEvent, type RunState } from "./run-track";

export const RUN_LOCATION_TASK = "lakeshore-run-location";

export type RunChange =
  /** `saved` is false if the run file couldn't be written. */
  | { kind: "event"; event: RunEvent; state: RunState | null; saved: boolean }
  | { kind: "error"; message: string };

type Listener = (change: RunChange) => void;

let active: { runId: string; state: RunState | null } | null = null;
const listeners = new Set<Listener>();

function notify(change: RunChange): void {
  for (const listener of listeners) listener(change);
}

/** Makes `runId` the run that fixes and events are written to. */
export function attachRun(runId: string, state: RunState | null): void {
  active = { runId, state };
}

/** Stops writing to the current run. Its file is left on disk. */
export function detachRun(): void {
  active = null;
}

export function subscribeRun(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Writes the event to the run file, then applies it to the run's state.
 * A point that fails to write is not applied, so the screen never shows
 * data the file doesn't have. Control events are applied either way so
 * the buttons still respond. No-op without an attached run.
 */
export function commitRunEvent(event: RunEvent): void {
  if (active === null) return;
  let saved = true;
  try {
    appendEvent(active.runId, event);
  } catch {
    saved = false;
  }
  if (saved || event.type !== "point") {
    active.state = applyEvent(active.state, event);
  }
  notify({ kind: "event", event, state: active.state, saved });
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  RUN_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      notify({ kind: "error", message: error.message });
      return;
    }
    if (active === null) {
      // The JS context was restarted while updates were still running, so
      // the recorder that started them is gone. The run file is intact;
      // the next launch recovers it paused. Don't keep the GPS on for it.
      await stopRunLocationUpdates();
      return;
    }
    for (const loc of data?.locations ?? []) {
      const event = pointFromFix(active.state, {
        at: loc.timestamp,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        ele: loc.coords.altitude,
        accuracy: loc.coords.accuracy,
      });
      if (event !== null) commitRunEvent(event);
    }
  },
);

// Starts and stops run one at a time, in call order, so a quick
// pause/resume can't have a stop land after the start that followed it.
let updatesQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = updatesQueue.then(op, op);
  updatesQueue = next.catch(() => {});
  return next;
}

/** Requires foreground location permission. */
export function startRunLocationUpdates(): Promise<void> {
  return enqueue(() =>
    Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1000,
      distanceInterval: 0,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Recording your run",
        notificationBody: "Lakeshore is tracking your route.",
        killServiceOnDestroy: true,
      },
    }),
  );
}

/** Safe to call when updates aren't running. Never rejects. */
export function stopRunLocationUpdates(): Promise<void> {
  return enqueue(async () => {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
      }
    } catch {
      // Not registered, or already stopped.
    }
  });
}
