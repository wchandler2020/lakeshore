/**
 * app/(tabs)/record.tsx
 *
 * Live run recording. The map follows the runner with the path drawn
 * behind them; the sheet shows distance, time and pace, with start,
 * pause/resume and finish controls.
 *
 * Everything shown here is a live estimate. On finish the raw points are
 * uploaded and the server computes the real totals, so the detail screen
 * may differ slightly from the last number shown here.
 */

import Mapbox, {
  Camera,
  LineLayer,
  LocationPuck,
  MapView,
  ShapeSource,
  UserTrackingMode,
} from "@rnmapbox/maps";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { workouts } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth-context";
import { useRunRecorder, type RecordedRun } from "@/lib/useRunRecorder";

const METERS_PER_MILE = 1609.344;

/** Chicago — the Bean. Where the camera starts before the first fix. */
const FALLBACK: [number, number] = [-87.6233, 41.8827];

export default function Record() {
  const router = useRouter();
  const { user } = useAuth();
  const recorder = useRunRecorder(user?.id ?? null);
  const { status, points, start, pause, resume, stop, reset } = recorder;

  // A stopped run waiting to upload. The recorder keeps it on disk until
  // reset(), so a failed upload — or a relaunch — never loses the run.
  const pending = recorder.stoppedRun;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const active = status === "recording" || status === "paused";

  const path = useMemo(
    () =>
      points.length < 2
        ? null
        : {
            type: "Feature" as const,
            properties: {},
            geometry: {
              type: "LineString" as const,
              coordinates: points.map((p) => [p.lng, p.lat]),
            },
          },
    [points],
  );

  const upload = useCallback(
    async (run: RecordedRun) => {
      setUploading(true);
      setUploadError(null);
      try {
        const created = await workouts.create({
          activity_type: "run",
          source: "phone",
          started_at: run.started_at,
          ended_at: run.ended_at,
          points: run.points,
        });
        reset();
        router.push(`/workouts/${created.id}`);
      } catch {
        setUploadError("Couldn't save your run. Check your connection and try again.");
      } finally {
        setUploading(false);
      }
    },
    [reset, router],
  );

  const finish = useCallback(() => {
    Alert.alert("Finish run?", undefined, [
      { text: "Keep going", style: "cancel" },
      {
        text: "Finish",
        onPress: () => {
          const run = stop();
          if (!run || run.points.length < 2) {
            reset();
            Alert.alert("Too short to save", "Not enough GPS points were recorded.");
            return;
          }
          upload(run);
        },
      },
    ]);
  }, [reset, stop, upload]);

  const discard = useCallback(() => {
    Alert.alert("Discard this run?", "It hasn't been saved and can't be recovered.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          setUploadError(null);
          reset();
        },
      },
    ]);
  }, [reset]);

  const miles = recorder.distanceM / METERS_PER_MILE;

  return (
    <View className="flex-1 bg-white">
      <MapView
        style={{ flex: 1 }}
        styleURL={Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        logoPosition={{ bottom: 8, left: 8 }}
        attributionPosition={{ bottom: 8, left: 92 }}
      >
        <Camera
          defaultSettings={{ centerCoordinate: FALLBACK, zoomLevel: 13 }}
          followUserLocation
          followUserMode={UserTrackingMode.Follow}
          followZoomLevel={16}
          // Keep the runner above the sheet rather than hidden under it.
          followPadding={{ paddingBottom: 280 }}
        />

        {path && (
          <ShapeSource id="recorded-path" shape={path}>
            {/* Casing underneath keeps the line legible over parks
                and water, where a single stroke disappears. */}
            <LineLayer
              id="recorded-path-casing"
              style={{
                lineColor: "#FFFFFF",
                lineWidth: 8,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <LineLayer
              id="recorded-path-line"
              style={{
                lineColor: "#E8452C",
                lineWidth: 4.5,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </ShapeSource>
        )}

        <LocationPuck puckBearingEnabled />
      </MapView>

      <SafeAreaView
        edges={["bottom"]}
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white px-5 pt-5"
        style={{
          shadowColor: "#1C1523",
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        }}
      >
        {recorder.error || uploadError ? (
          <Text className="font-sans mb-3 text-sm text-ember-500">
            {uploadError ?? recorder.error}
          </Text>
        ) : (
          recorder.recovered && (
            <Text className="font-sans mb-3 text-sm text-fog">
              {pending
                ? "This run didn't finish saving. Save it now or discard it."
                : "Your run was interrupted. Resume it or finish to save."}
            </Text>
          )
        )}

        <View className="flex-row items-baseline">
          <Text className="font-display text-7xl text-ink">
            {miles.toFixed(2)}
          </Text>
          <Text className="font-sans ml-2 text-base text-fog">mi</Text>
        </View>

        <View className="mt-2 flex-row gap-8">
          <Meta label="Time" value={formatElapsed(recorder.elapsedMs)} />
          <Meta label="Pace" value={formatPace(recorder.paceSPerMi)} />
        </View>

        <View className="mb-2 mt-5">
          {pending ? (
            <View className="flex-row gap-3">
              <Pressable
                onPress={discard}
                disabled={uploading}
                className="h-14 flex-1 items-center justify-center rounded-xl bg-cloud"
              >
                <Text className="font-sans-semibold text-base text-ink">Discard</Text>
              </Pressable>
              <Pressable
                onPress={() => upload(pending)}
                disabled={uploading}
                className={`h-14 flex-[2] items-center justify-center rounded-xl ${
                  uploading ? "bg-cloud-dark" : "bg-ember-400"
                }`}
              >
                {uploading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="font-sans-semibold text-base text-white">
                    Retry save
                  </Text>
                )}
              </Pressable>
            </View>
          ) : active ? (
            <View className="flex-row gap-3">
              <Pressable
                onPress={status === "recording" ? pause : resume}
                className="h-14 flex-1 items-center justify-center rounded-xl bg-ink"
              >
                <Text className="font-sans-semibold text-base text-white">
                  {status === "recording" ? "Pause" : "Resume"}
                </Text>
              </Pressable>
              <Pressable
                onPress={finish}
                className="h-14 flex-1 items-center justify-center rounded-xl bg-ember-400"
              >
                <Text className="font-sans-semibold text-base text-white">Finish</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={start}
              disabled={status === "starting"}
              className={`h-14 items-center justify-center rounded-xl ${
                status === "starting" ? "bg-cloud-dark" : "bg-ember-400"
              }`}
            >
              {status === "starting" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="font-sans-semibold text-base text-white">Start run</Text>
              )}
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
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

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function formatPace(sPerMi: number | null): string {
  if (sPerMi === null) return "–:––";
  const total = Math.round(sPerMi);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} /mi`;
}
