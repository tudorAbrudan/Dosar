// app/components/ui/FormPageScreen.tsx
import { ReactNode } from 'react';
import { Text, Pressable, ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { Stack, router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { BottomActionBar } from './BottomActionBar';
import { KeyboardSafeView } from './KeyboardSafeView';

type Props = {
  title: string;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  /** Override pentru butonul stâng din header. Default: „Înapoi" → router.back(). */
  headerLeft?: ReactNode;
  /** Acțiunea butonului „Înapoi" implicit (ex. revenire pe alt tab). Default: router.back(). */
  onBack?: () => void;
  headerRight?: ReactNode;
  scrollContentStyle?: ViewStyle;
  /** Comportament dismiss tastatură la scroll. Default: niciunul. */
  keyboardDismissMode?: 'none' | 'on-drag' | 'interactive';
  /** iOS: ajustează automat insets-urile când apare tastatura. */
  automaticallyAdjustKeyboardInsets?: boolean;
  children: ReactNode;
};

function DefaultBack({ onBack }: { onBack?: () => void }) {
  return (
    <Pressable onPress={onBack ?? (() => router.back())} style={{ paddingRight: 8 }} hitSlop={8}>
      <Text style={{ color: primary, fontSize: 16 }}>Înapoi</Text>
    </Pressable>
  );
}

export function FormPageScreen({
  title,
  onSave,
  saving = false,
  saveDisabled = false,
  saveLabel = 'Salvează',
  headerLeft,
  onBack,
  headerRight,
  scrollContentStyle,
  keyboardDismissMode,
  automaticallyAdjustKeyboardInsets,
  children,
}: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => headerLeft ?? <DefaultBack onBack={onBack} />,
          headerRight: headerRight ? () => headerRight : undefined,
        }}
      />
      <KeyboardSafeView style={{ backgroundColor: C.background }}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, scrollContentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={keyboardDismissMode}
          automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        <BottomActionBar
          label={saveLabel}
          onPress={onSave}
          loading={saving}
          disabled={saveDisabled}
          safeArea
        />
      </KeyboardSafeView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16 },
});
