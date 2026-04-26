import { HeaderBackButton } from '@react-navigation/elements';
import { Stack, router } from 'expo-router';

export default function FinanciarLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Gestiune financiară' }} />
      <Stack.Screen name="evolutie" options={{ title: 'Evoluție' }} />
      <Stack.Screen name="conturi" options={{ title: 'Conturi' }} />
    </Stack>
  );
}
