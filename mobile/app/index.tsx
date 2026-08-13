import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Home() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-8">
        <Text className="font-sans text-xs uppercase tracking-widest text-fog">
          Lakefront trail
        </Text>

        <View className="mt-1 flex-row items-baseline">
          <Text className="font-display text-6xl text-ink">6.24</Text>
          <Text className="font-sans ml-1 text-base text-fog">mi</Text>
        </View>

        <View className="mt-4 flex-row gap-6">
          <Stat label="Pace" value="8:42" />
          <Stat label="Time" value="54:17" />
          <Stat label="Avg HR" value="148" />
        </View>

        <View className="mt-8 rounded-xl bg-cloud p-4">
          <Text className="font-sans-medium text-ink">
            Styling is wired up.
          </Text>
          <Text className="font-sans mt-1 text-sm text-fog">
            Marigold, ember, ink and fog are available as Tailwind colours.
          </Text>
          <View className="mt-3 flex-row gap-2">
            <View className="h-8 flex-1 rounded bg-marigold-400" />
            <View className="h-8 flex-1 rounded bg-marigold-500" />
            <View className="h-8 flex-1 rounded bg-ember-300" />
            <View className="h-8 flex-1 rounded bg-ember-400" />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="font-sans text-[11px] uppercase tracking-wider text-fog">
        {label}
      </Text>
      <Text className="font-display-medium text-xl text-ink">{value}</Text>
    </View>
  );
}
