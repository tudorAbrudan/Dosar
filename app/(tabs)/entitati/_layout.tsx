import { Stack } from 'expo-router';

export default function EntitatiLayout() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Înapoi' }}>
      <Stack.Screen name="index" options={{ title: 'Entități', headerShown: false }} />
      <Stack.Screen name="add" options={{ title: 'Adaugă' }} />
      <Stack.Screen name="[id]" options={{ title: 'Detaliu' }} />
      <Stack.Screen name="wizard-masina" options={{ title: 'Adaugă mașină' }} />
      <Stack.Screen name="wizard-proprietate" options={{ title: 'Adaugă proprietate' }} />
      <Stack.Screen name="fuel" options={{ title: 'Carburant & Revizii' }} />
      <Stack.Screen name="fuel-stats" options={{ title: 'Statistici carburant' }} />
    </Stack>
  );
}
