import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { onPrimary, primary } from '@/theme/colors';

type Props = {
  title: string;
  onCancel: () => void;
  onSave: () => void;
  /** Folosite doar ca accessibilityLabel — butoanele sunt icon-only. */
  cancelLabel?: string;
  saveLabel?: string;
  saving?: boolean;
  saveDisabled?: boolean;
  cancelDisabled?: boolean;
  /** Fundal propriu (ex. cropper); implicit transparent. */
  backgroundColor?: string;
  /** Padding sus suplimentar (ecrane full-screen fără sheet). */
  paddingTop?: number;
};

const BTN = 40;

/**
 * Header unic pentru modale/sheet-uri: ✕ stânga, titlu centru, ✓ dreapta.
 * Butoanele au lățime fixă și maxFontSizeMultiplier → nu se mai suprapun cu
 * titlul pe telefoane mici sau cu Dynamic Type mare; titlul se micșorează/taie.
 */
export function SheetHeader({
  title,
  onCancel,
  onSave,
  cancelLabel = 'Anulează',
  saveLabel = 'Salvează',
  saving = false,
  saveDisabled = false,
  cancelDisabled = false,
  backgroundColor,
  paddingTop,
}: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const saveOff = saving || saveDisabled;
  const cancelOff = saving || cancelDisabled;

  return (
    <View
      style={[
        styles.header,
        { borderBottomColor: C.border, backgroundColor },
        paddingTop != null && { paddingTop },
      ]}
    >
      <Pressable
        onPress={onCancel}
        disabled={cancelOff}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: C.card, borderColor: C.border, borderWidth: 1.5 },
          cancelOff && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="close" size={22} color={C.text} />
      </Pressable>

      <Text
        style={[styles.title, { color: C.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        maxFontSizeMultiplier={1.3}
      >
        {title}
      </Text>

      <Pressable
        onPress={onSave}
        disabled={saveOff}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={saving ? 'Salvez...' : saveLabel}
        accessibilityState={{ disabled: saveOff, busy: saving }}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: primary },
          saveOff && !saving && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={onPrimary} />
        ) : (
          <Ionicons name="checkmark" size={24} color={onPrimary} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
