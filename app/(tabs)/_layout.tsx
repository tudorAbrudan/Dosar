import React, { useEffect } from 'react';
import { SymbolView } from 'expo-symbols';
import { Tabs, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { scheduleExpirationReminders } from '@/services/notifications';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const router = useRouter();
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    scheduleExpirationReminders().catch(() => {});
  }, []);

  useEffect(() => {
    const data = lastResponse?.notification.request.content.data as { documentId?: string } | undefined;
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
      }}>
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
        name="chat"
        options={{
          title: 'Asistent',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
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
