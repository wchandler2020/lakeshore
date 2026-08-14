/**
 * app/(auth)/login.tsx
 */

import { Link } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth-context";

export default function Login() {
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = identifier.trim().length > 0 && password.length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      await login(identifier.trim(), password);
      // Navigation is handled by the root layout reacting to `user`.
    } catch (err: any) {
      // 401 from SimpleJWT means bad credentials. Anything else is
      // likely the server being unreachable, which is worth saying
      // plainly rather than blaming the password.
      const status = err?.response?.status;
      setError(
        status === 401
          ? "That email or password doesn't look right."
          : "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-12"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="font-sans text-xs uppercase tracking-widest text-fog">
            Welcome back
          </Text>
          <Text className="font-display mt-1 text-4xl leading-tight text-ink">
            Sign in
          </Text>

          <View className="mt-10">
            <Field
              label="Email or username"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoComplete="username"
              keyboardType="email-address"
              editable={!submitting}
            />

            <View className="h-4" />

            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              editable={!submitting}
              onSubmitEditing={handleSubmit}
              returnKeyType="go"
            />
          </View>

          {error && (
            <View className="mt-5 rounded-lg bg-ember-50 px-4 py-3">
              <Text className="font-sans text-sm text-ember-600">{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`mt-8 h-14 items-center justify-center rounded-xl ${
              canSubmit && !submitting ? "bg-ember-400" : "bg-cloud-dark"
            }`}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                className={`font-sans-semibold text-base ${
                  canSubmit ? "text-white" : "text-fog-light"
                }`}
              >
                Sign in
              </Text>
            )}
          </Pressable>

          <View className="mt-8 flex-row justify-center">
            <Text className="font-sans text-sm text-fog">New here? </Text>
            <Link href="/(auth)/register" asChild>
              <Pressable>
                <Text className="font-sans-semibold text-sm text-ember-400">
                  Create an account
                </Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text className="font-sans mb-2 text-xs uppercase tracking-wider text-fog">
        {label}
      </Text>
      <TextInput
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor="#A9A4AF"
        className={`font-sans h-14 rounded-xl border px-4 text-base text-ink ${
          focused ? "border-ember-400 bg-white" : "border-cloud-dark bg-cloud"
        }`}
      />
    </View>
  );
}
