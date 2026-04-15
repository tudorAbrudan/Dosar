import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useState, useEffect, useRef } from 'react';
import { Linking, DeviceEventEmitter, useColorScheme as useColorSchemeNative } from 'react-native';

export const ONBOARDING_RESET_EVENT = 'onboarding_reset';
import 'react-native-reanimated';

import AppLockScreen from '@/components/AppLockScreen';
import OnboardingWizard from '@/components/OnboardingWizard';
import { UpdateBanner } from '@/components/UpdateBanner';
import { UpdateBlocker } from '@/components/UpdateBlocker';
import { checkForUpdate, dismissUpdate } from '@/services/updateCheck';
import type { UpdateInfo } from '@/services/updateCheck';
import { AppLightTheme, AppDarkTheme } from '@/constants/Theme';
import { ThemePreferenceContext } from '@/hooks/useThemeScheme';
import type { ThemePreference } from '@/hooks/useThemeScheme';
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
  const systemScheme = useColorSchemeNative();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('auto');
  const appLock = useAppLock();
  const router = useRouter();
  const notifListener = useRef<Notifications.EventSubscription | null>(null);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    notifListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (typeof data?.url === 'string') {
        Linking.openURL(data.url);
      } else if (typeof data?.documentId === 'string') {
        router.push(`/(tabs)/documente/${data.documentId}`);
      }
    });
    return () => {
      notifListener.current?.remove();
    };
  }, []);

  // Deep link handler: acte:///documente/{id} → deschide documentul
  useEffect(() => {
    const handleURL = (url: string) => {
      const docId = parseDeepLink(url);
      if (docId) router.push(`/(tabs)/documente/${docId}`);
    };

    // App pornită din deep link (cold start)
    Linking.getInitialURL().then(url => {
      if (url) handleURL(url);
    });

    // App deja pornită, primește deep link
    const sub = Linking.addEventListener('url', ({ url }) => handleURL(url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    settings.getThemePreference().then(setThemePreferenceState);
  }, []);

  function setPreference(p: ThemePreference) {
    setThemePreferenceState(p);
    void settings.setThemePreference(p);
  }

  const effectiveScheme: 'light' | 'dark' =
    themePreference === 'auto' ? (systemScheme === 'dark' ? 'dark' : 'light') : themePreference;

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

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(ONBOARDING_RESET_EVENT, () => {
      setOnboardingDone(false);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    checkForUpdate().then(info => {
      if (info) setUpdateInfo(info);
    });
  }, []);

  return (
    <ThemePreferenceContext.Provider value={{ preference: themePreference, setPreference }}>
      <ThemeProvider value={effectiveScheme === 'dark' ? AppDarkTheme : AppLightTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
        {updateInfo && onboardingDone === true && updateInfo.mandatory && (
          <UpdateBlocker version={updateInfo.version} url={updateInfo.url} />
        )}
        {updateInfo && !appLock.locked && onboardingDone === true && !updateInfo.mandatory && (
          <UpdateBanner
            version={updateInfo.version}
            url={updateInfo.url}
            onDismiss={() => {
              dismissUpdate(updateInfo.version);
              setUpdateInfo(null);
            }}
          />
        )}
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
    </ThemePreferenceContext.Provider>
  );
}
