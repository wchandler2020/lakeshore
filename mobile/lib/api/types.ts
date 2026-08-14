/**
 * lib/api/types.ts
 *
 * Convenience aliases over the generated schema. Import from here rather
 * than reaching into schema.d.ts directly — if a serializer name changes
 * on the backend, this is the only file that needs updating.
 */

import type { components } from "./schema";

export type User = components["schemas"]["User"];
export type UserProfile = components["schemas"]["UserProfile"];

export type Workout = components["schemas"]["WorkoutList"];
export type WorkoutDetail = components["schemas"]["WorkoutDetail"];

export type ActivityType = "run" | "walk" | "hike" | "ride";
export type Privacy = "public" | "followers" | "private";

/** A single GPS sample, as sent to the ingest endpoint. */
export interface TrackPoint {
  lat: number;
  lng: number;
  timestamp: string;
  elevation?: number | null;
  heart_rate?: number | null;
  cadence?: number | null;
}

/** One generated loop from the route service. */
export interface GeneratedRoute {
  distance_m: number;
  distance_mi: number;
  duration_s: number;
  error_m: number;
  error_pct: number;
  ascend_m: number;
  descend_m: number;
  seed: number;
  geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat]
  };
  instructions: {
    text: string;
    distance_m: number;
    sign: number;
    street_name: string;
    interval: number[];
  }[];
}

export interface RouteGenerationResponse {
  requested_distance_m: number;
  count: number;
  routes: GeneratedRoute[];
}