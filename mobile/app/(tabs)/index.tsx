/**
 * app/(tabs)/index.tsx
 *
 * Placeholder home. Proves the session is live by showing the signed-in
 * user, and gives logout somewhere to live until the real screens land.
 */

import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-8">
        <Text className="font-sans text-xs uppercase tracking-widest text-fog">
          Signed in as
        </Text>
        <Text className="font-display mt-1 text-3xl text-ink">
          {user?.username ?? "—"}
        </Text>
        <Text className="font-sans mt-1 text-sm text-fog">{user?.email}</Text>

        <View className="mt-8 rounded-xl bg-cloud p-4">
          <Text className="font-sans-medium text-ink">
            Auth is working end to end.
          </Text>
          <Text className="font-sans mt-1 text-sm text-fog">
            Units: {user?.profile?.preferred_units ?? "—"} · Default privacy:{" "}
            {user?.profile?.default_run_privacy ?? "—"}
          </Text>
        </View>

        <Pressable
          onPress={logout}
          className="mt-6 h-12 items-center justify-center rounded-xl border border-cloud-dark"
        >
          <Text className="font-sans-semibold text-sm text-ink">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
