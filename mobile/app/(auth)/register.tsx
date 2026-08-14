/**
 * app/(auth)/register.tsx
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

export default function Register() {
  const { register } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    username.trim() && email.trim() && password && confirm && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;

    setErrors({});

    if (password !== confirm) {
      setErrors({ password_confirm: ["Passwords don't match."] });
      return;
    }

    setSubmitting(true);

    try {
      await register({
        username: username.trim(),
        email: email.trim(),
        password,
        password_confirm: confirm,
      });
    } catch (err: any) {
      // DRF returns field-keyed arrays of messages, which map cleanly
      // onto per-field errors below.
      const data = err?.response?.data;
      if (data && typeof data === "object") {
        setErrors(data);
      } else {
        setErrors({ detail: ["Couldn't reach the server. Try again."] });
      }
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
            Get started
          </Text>
          <Text className="font-display mt-1 text-4xl leading-tight text-ink">
            Create account
          </Text>

          <View className="mt-8 gap-4">
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              errors={errors.username}
              editable={!submitting}
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              errors={errors.email}
              editable={!submitting}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              errors={errors.password}
              editable={!submitting}
            />
            <Field
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              errors={errors.password_confirm}
              editable={!submitting}
            />
          </View>

          {errors.detail && (
            <View className="mt-5 rounded-lg bg-ember-50 px-4 py-3">
              <Text className="font-sans text-sm text-ember-600">
                {errors.detail[0]}
              </Text>
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            className={`mt-8 h-14 items-center justify-center rounded-xl ${
              canSubmit ? "bg-ember-400" : "bg-cloud-dark"
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
                Create account
              </Text>
            )}
          </Pressable>

          <View className="mt-8 flex-row justify-center">
            <Text className="font-sans text-sm text-fog">
              Already have an account?{" "}
            </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable>
                <Text className="font-sans-semibold text-sm text-ember-400">
                  Sign in
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
  errors,
  ...props
}: {
  label: string;
  errors?: string[];
} & React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(errors?.length);

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
          hasError
            ? "border-ember-400 bg-ember-50"
            : focused
              ? "border-ember-400 bg-white"
              : "border-cloud-dark bg-cloud"
        }`}
      />
      {hasError && (
        <Text className="font-sans mt-1.5 text-xs text-ember-500">
          {errors![0]}
        </Text>
      )}
    </View>
  );
}
