/**
 * app/workouts/[id].tsx
 *
 * A single workout: the recorded path, server-computed totals and
 * per-mile splits. Minimal for now — it's where the Record tab lands
 * after a run is saved.
 */

import Mapbox, { Camera, LineLayer, MapView, ShapeSource } from "@rnmapbox/maps";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { workouts } from "@/lib/api/endpoints";
import type { WorkoutDetail } from "@/lib/api/types";

interface Split {
  index: number;
  distance_m: number;
  elapsed_s: number;
  duration_s: number;
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [workout, setWorkout] = useState<WorkoutDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    workouts
      .get(Number(id))
      .then((w) => !cancelled && setWorkout(w))
      .catch(() => !cancelled && setError("Couldn't load this workout."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const line = workout?.geometry ?? null;
  const splits = (Array.isArray(workout?.splits) ? workout.splits : []) as Split[];

  const bounds = line
    ? {
        ne: [
          Math.max(...line.coordinates.map((c) => c[0])),
          Math.max(...line.coordinates.map((c) => c[1])),
        ],
        sw: [
          Math.min(...line.coordinates.map((c) => c[0])),
          Math.min(...line.coordinates.map((c) => c[1])),
        ],
        paddingTop: 40,
        paddingBottom: 40,
        paddingLeft: 40,
        paddingRight: 40,
      }
    : undefined;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white">
      <View className="flex-row items-center px-4 py-2">
        <Pressable
          onPress={() => router.back()}
          className="h-10 justify-center rounded-full bg-cloud px-4"
        >
          <Text className="font-sans-medium text-sm text-ink">Back</Text>
        </Pressable>
      </View>

      {error ? (
        <Text className="font-sans px-5 text-sm text-ember-500">{error}</Text>
      ) : !workout ? (
        <ActivityIndicator className="mt-10" color="#E8452C" />
      ) : (
        <ScrollView contentContainerClassName="pb-10">
          {line && (
            <View className="mx-4 h-64 overflow-hidden rounded-2xl">
              <MapView
                style={{ flex: 1 }}
                styleURL={Mapbox.StyleURL.Light}
                scaleBarEnabled={false}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
              >
                <Camera bounds={bounds} animationDuration={0} />
                <ShapeSource
                  id="workout-path"
                  shape={{ type: "Feature", properties: {}, geometry: line }}
                >
                  <LineLayer
                    id="workout-path-casing"
                    style={{
                      lineColor: "#FFFFFF",
                      lineWidth: 8,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                  <LineLayer
                    id="workout-path-line"
                    style={{
                      lineColor: "#E8452C",
                      lineWidth: 4.5,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                </ShapeSource>
              </MapView>
            </View>
          )}

          <View className="px-5 pt-5">
            <Text className="font-sans text-sm text-fog">
              {new Date(workout.started_at).toLocaleString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>

            <View className="mt-1 flex-row items-baseline">
              <Text className="font-display text-6xl text-ink">
                {workout.distance_mi.toFixed(2)}
              </Text>
              <Text className="font-sans ml-2 text-base text-fog">mi</Text>
            </View>

            <View className="mt-3 flex-row flex-wrap gap-x-8 gap-y-3">
              <Meta label="Moving time" value={formatClock(workout.moving_time_s ?? 0)} />
              <Meta label="Pace" value={formatPace(workout.pace_s_per_mi)} />
              <Meta
                label="Elevation"
                value={`${Math.round((workout.elevation_gain_m ?? 0) * 3.28084)} ft`}
              />
            </View>

            {splits.length > 0 && (
              <View className="mt-8">
                <Text className="font-sans text-[11px] uppercase tracking-wider text-fog">
                  Splits
                </Text>
                {splits.map((s) => (
                  <View
                    key={s.index}
                    className="flex-row justify-between border-b border-cloud-dark py-3"
                  >
                    <Text className="font-sans-medium text-base text-ink">Mile {s.index}</Text>
                    <Text className="font-display-medium text-base text-ink">
                      {formatClock(s.duration_s)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="font-sans text-[11px] uppercase tracking-wider text-fog">
        {label}
      </Text>
      <Text className="font-display-medium text-xl text-ink">{value}</Text>
    </View>
  );
}

function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function formatPace(sPerMi: number): string {
  if (!sPerMi || !Number.isFinite(sPerMi)) return "–:––";
  return `${formatClock(sPerMi)} /mi`;
}
