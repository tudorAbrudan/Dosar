import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useState, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import 'react-native-reanimated';

import AppLockScreen from '@/components/AppLockScreen';
import OnboardingWizard from '@/components/OnboardingWizard';
import { useColorScheme } from '@/components/useColorScheme';
import { AppLightTheme, AppDarkTheme } from '@/constants/Theme';
import { useAppLock } from '@/hooks/useAppLock';
import { db } from '@/services/db';
import * as settings from '@/services/settings';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function parseDeepLink(url: string): string | null {
  const match = url.match(/documente\/([a-zA-Z0-9\-]+)/);
  return match?.[1] ?? null;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const appLock = useAppLock();
  const router = useRouter();
  const notifListener = useRef<Notifications.EventSubscription | null>(null);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    notifListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (typeof data?.url === 'string') {
        Linking.openURL(data.url);
      }
    });
    return () => { notifListener.current?.remove(); };
  }, []);

  // Deep link handler: app:///documente/{id} → deschide documentul
  useEffect(() => {
    const handleURL = (url: string) => {
      const docId = parseDeepLink(url);
      if (docId) router.push(`/(tabs)/documente/${docId}`);
    };

    // App pornită din deep link (cold start)
    Linking.getInitialURL().then(url => { if (url) handleURL(url); });

    // App deja pornită, primește deep link
    const sub = Linking.addEventListener('url', ({ url }) => handleURL(url));
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function checkOnboarding() {
      const done = await settings.isOnboardingDone();
      if (done) {
        setOnboardingDone(true);
        return;
      }
      // Utilizatori existenți care nu au trecut prin onboarding
      const result = db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM persons');
      const hasData = (result?.cnt ?? 0) > 0;
      if (hasData) {
        await settings.setOnboardingDone();
        setOnboardingDone(true);
      } else {
        setOnboardingDone(false);
      }
    }
    checkOnboarding();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? AppDarkTheme : AppLightTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      {appLock.locked && (
        <AppLockScreen
          biometricAvailable={appLock.biometricAvailable}
          onUnlockBiometric={appLock.unlockWithBiometric}
          onUnlockPin={appLock.unlockWithPin}
        />
      )}
      {onboardingDone === false && (
        <OnboardingWizard onComplete={() => setOnboardingDone(true)} />
      )}
    </ThemeProvider>
  );
}
