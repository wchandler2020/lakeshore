/**
 * app/(tabs)/plan.tsx
 *
 * Route planning. Pick a distance, generate loops from your current
 * location, cycle through the alternatives.
 *
 * The backend samples ~20 seeds per request and returns the three
 * closest to the target, so "another option" costs nothing extra —
 * the alternatives are already in hand.
 */

import Mapbox, {
  Camera,
  LineLayer,
  LocationPuck,
  MapView,
  ShapeSource,
} from "@rnmapbox/maps";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { routes as routesApi } from "@/lib/api/endpoints";
import type { GeneratedRoute } from "@/lib/api/types";

const DISTANCES = [1, 2, 3, 5, 6.2, 10, 13.1] as const;

/** Chicago — the Bean. Fallback when location permission is denied. */
const FALLBACK: [number, number] = [-87.6233, 41.8827];

export default function Plan() {
  const camera = useRef<Camera>(null);

  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [distance, setDistance] = useState<number>(5);

  const [options, setOptions] = useState<GeneratedRoute[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setLocationDenied(true);
        setOrigin(FALLBACK);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setOrigin([position.coords.longitude, position.coords.latitude]);
    })();
  }, []);

  const generate = useCallback(async () => {
    if (!origin || loading) return;

    setLoading(true);
    setError(null);
    setOptions([]);

    try {
      const result = await routesApi.generate({
        lat: origin[1],
        lng: origin[0],
        distance,
        units: "mi",
        samples: 20,
        count: 3,
      });

      setOptions(result);
      setSelected(0);
    } catch (err: any) {
      setError(
        err?.response?.status === 422
          ? "Couldn't find a loop from here. Try a different distance."
          : "Something went wrong generating routes.",
      );
    } finally {
      setLoading(false);
    }
  }, [origin, distance, loading]);

  // Frame the route once it arrives.
  useEffect(() => {
    const route = options[selected];
    if (!route || !camera.current) return;

    const coords = route.geometry.coordinates;
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);

    camera.current.fitBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
      [80, 40, 260, 40],
      600,
    );
  }, [options, selected]);

  const route = options[selected];

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
          ref={camera}
          defaultSettings={{
            centerCoordinate: origin ?? FALLBACK,
            zoomLevel: 13,
          }}
        />

        {!locationDenied && <LocationPuck puckBearingEnabled />}

        {route && (
          <ShapeSource
            id="route"
            shape={{
              type: "Feature",
              properties: {},
              geometry: route.geometry,
            }}
          >
            {/* Casing underneath keeps the line legible over parks
                and water, where a single stroke disappears. */}
            <LineLayer
              id="route-casing"
              style={{
                lineColor: "#FFFFFF",
                lineWidth: 8,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <LineLayer
              id="route-line"
              style={{
                lineColor: "#E8452C",
                lineWidth: 4.5,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      {/* Distance picker */}
      <SafeAreaView edges={["top"]} className="absolute left-0 right-0 top-0">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-4 py-3"
        >
          {DISTANCES.map((d) => {
            const active = d === distance;
            return (
              <Pressable
                key={d}
                onPress={() => setDistance(d)}
                className={`h-10 justify-center rounded-full px-4 ${
                  active ? "bg-ink" : "bg-white/95"
                }`}
                style={
                  active
                    ? undefined
                    : {
                        shadowColor: "#1C1523",
                        shadowOpacity: 0.08,
                        shadowRadius: 6,
                        shadowOffset: { width: 0, height: 2 },
                      }
                }
              >
                <Text
                  className={`font-sans-medium text-sm ${
                    active ? "text-white" : "text-ink"
                  }`}
                >
                  {d === 6.2 ? "10K" : d === 13.1 ? "Half" : `${d} mi`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      {/* Result sheet */}
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
        {error && (
          <Text className="font-sans mb-3 text-sm text-ember-500">{error}</Text>
        )}

        {route ? (
          <View>
            <View className="flex-row items-baseline justify-between">
              <View className="flex-row items-baseline">
                <Text className="font-display text-4xl text-ink">
                  {route.distance_mi.toFixed(2)}
                </Text>
                <Text className="font-sans ml-1 text-sm text-fog">mi</Text>
              </View>

              {options.length > 1 && (
                <Pressable
                  onPress={() => setSelected((s) => (s + 1) % options.length)}
                  className="h-10 justify-center rounded-full bg-cloud px-4"
                >
                  <Text className="font-sans-medium text-sm text-ink">
                    Another route
                  </Text>
                </Pressable>
              )}
            </View>

            <View className="mt-2 flex-row gap-5">
              <Meta label="Turns" value={`${route.instructions.length}`} />
              <Meta
                label="Est. time"
                value={formatDuration(route.duration_s)}
              />
              <Meta
                label="Option"
                value={`${selected + 1} of ${options.length}`}
              />
            </View>
          </View>
        ) : (
          <Text className="font-sans text-sm text-fog">
            {locationDenied
              ? "Location is off, so routes start from downtown Chicago."
              : "Pick a distance and generate a loop from where you are."}
          </Text>
        )}

        <Pressable
          onPress={generate}
          disabled={loading || !origin}
          className={`mb-2 mt-4 h-14 items-center justify-center rounded-xl ${
            loading || !origin ? "bg-cloud-dark" : "bg-ember-400"
          }`}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="font-sans-semibold text-base text-white">
              {options.length ? "Generate again" : "Find a route"}
            </Text>
          )}
        </Pressable>
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
      <Text className="font-display-medium text-base text-ink">{value}</Text>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
