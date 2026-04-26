import React, { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Tabs, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { scheduleExpirationReminders } from '@/services/notifications';
import { radius } from '@/theme/layout';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    scheduleExpirationReminders().catch(() => {});
  }, []);

  useEffect(() => {
    const data = lastResponse?.notification.request.content.data as
      | { documentId?: string }
      | undefined;
    if (
      lastResponse &&
      lastResponse.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER &&
      data?.documentId
    ) {
      router.push(`/(tabs)/documente/${data.documentId}`);
    }
  }, [lastResponse, router]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tabIconSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          paddingTop: 6,
          paddingBottom: insets.bottom,
          height: 54 + insets.bottom,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -3 },
              shadowOpacity: 0.06,
              shadowRadius: 10,
            },
            android: { elevation: 12 },
            default: {},
          }),
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
        },
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Acasă',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'house.fill', android: 'home', web: 'home' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="entitati"
        listeners={() => ({
          tabPress: e => {
            e.preventDefault();
            router.navigate('/(tabs)/entitati');
          },
        })}
        options={{
          title: 'Entități',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'people', web: 'people' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="documente"
        listeners={() => ({
          tabPress: e => {
            e.preventDefault();
            router.navigate('/(tabs)/documente');
          },
        })}
        options={{
          title: 'Acte',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'doc.fill', android: 'description', web: 'description' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Asistent',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'message.fill', android: 'chat', web: 'chat' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="expirari"
        options={{
          title: 'Expirări',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'calendar', android: 'event', web: 'event' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="setari"
        options={{
          title: 'Setări',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen name="shared" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabLabel: { fontSize: 10, fontWeight: '600' },
  tabItem: { paddingTop: 2, paddingBottom: 0 },
});
