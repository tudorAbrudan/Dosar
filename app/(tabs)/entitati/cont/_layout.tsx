import { HeaderBackButton } from '@react-navigation/elements';
import { Stack, router } from 'expo-router';

export default function ContLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: 'Înapoi',
        headerLeft: (props) => (
          <HeaderBackButton
            {...props}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/entitati');
            }}
          />
        ),
      }}
    >
      <Stack.Screen name="add" options={{ title: 'Adaugă cont financiar' }} />
      <Stack.Screen name="[id]" options={{ title: 'Detaliu cont' }} />
      <Stack.Screen name="edit" options={{ title: 'Editează cont' }} />
      <Stack.Screen name="tranzactie" options={{ title: 'Tranzacție' }} />
      <Stack.Screen name="import" options={{ title: 'Import extras' }} />
    </Stack>
  );
}
