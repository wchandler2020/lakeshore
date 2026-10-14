/**
 * lib/run-log.ts
 *
 * Durable storage for an in-progress run. Each run is a newline-delimited
 * JSON file of RunEvents in the document directory, appended to as events
 * happen, so a crash or a killed app loses at most the fix being written.
 * The file is deleted once the run is uploaded or discarded.
 */

import { Directory, File, Paths } from "expo-file-system";

import type { RunEvent } from "./run-track";

const RUNS_DIR = new Directory(Paths.document, "runs");
const EXTENSION = ".ndjson";

function runFile(runId: string): File {
  return new File(RUNS_DIR, `${runId}${EXTENSION}`);
}

/** Starts with the time, so run ids sort in creation order. */
export function newRunId(now: number): string {
  return `${now}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRun(runId: string): void {
  RUNS_DIR.create({ idempotent: true, intermediates: true });
  runFile(runId).create();
}

/** Throws if the write fails (e.g. disk full). */
export function appendEvent(runId: string, event: RunEvent): void {
  runFile(runId).write(`${JSON.stringify(event)}\n`, { append: true });
}

/**
 * Every complete event in the file. A crash mid-write can leave a partial
 * last line, so lines that don't parse are skipped rather than failing
 * the whole run.
 */
export function readEvents(runId: string): RunEvent[] {
  const file = runFile(runId);
  if (!file.exists) return [];
  const events: RunEvent[] = [];
  for (const line of file.textSync().split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch {
      // Torn write from an interrupted append.
    }
  }
  return events;
}

export function deleteRun(runId: string): void {
  const file = runFile(runId);
  if (file.exists) file.delete();
}

/** Ids of run files on disk, oldest first. */
export function listRuns(): string[] {
  if (!RUNS_DIR.exists) return [];
  return RUNS_DIR.list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(EXTENSION))
    .map((file) => file.name.slice(0, -EXTENSION.length))
    .sort();
}
