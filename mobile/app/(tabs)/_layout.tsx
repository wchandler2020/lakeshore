/**
 * app/(tabs)/_layout.tsx
 */

import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#E8452C",
        tabBarInactiveTintColor: "#A9A4AF",
        tabBarStyle: {
          borderTopColor: "#E6E3E8",
          backgroundColor: "#FFFFFF",
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
    </Tabs>
  );
}
