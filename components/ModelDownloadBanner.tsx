import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';
import { radius, spacing } from '@/theme/layout';
import { useModelDownload } from '@/hooks/useModelDownload';

interface ModelDownloadBannerProps {
  /** Navighează la Setări → Asistent AI, unde se poate schimba sau șterge modelul. */
  onPress: () => void;
}

/**
 * Status pentru descărcarea unui model AI local, pornită din onboarding sau din
 * Setări. Apare cât timp transferul e activ, ca userul să vadă că merge mai
 * departe după ce a închis onboarding-ul — altfel descărcarea ar fi complet
 * invizibilă și ar părea că nu s-a întâmplat nimic.
 *
 * Nu randează nimic când nu e nicio descărcare în curs.
 */
export function ModelDownloadBanner({ onPress }: ModelDownloadBannerProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { active, modelName, progress, downloadedMb, totalMb } = useModelDownload();

  if (!active) return null;

  const percent = Math.round(progress * 100);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Se descarcă ${modelName ?? 'modelul AI'}, ${percent}%. Apasă pentru setări.`}
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
    >
      <Text style={[styles.title, { color: palette.text }]}>
        Se descarcă {modelName ?? 'modelul AI'} · {percent}%
      </Text>
      <View style={[styles.track, { backgroundColor: palette.border }]}>
        <View style={[styles.fill, { backgroundColor: palette.primary, width: `${percent}%` }]} />
      </View>
      <Text style={[styles.sub, { color: palette.textSecondary }]}>
        {Math.round(downloadedMb)} din {Math.round(totalMb)} MB · Apasă pentru detalii
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.cardPadding,
    marginBottom: spacing.gap,
    gap: 6,
  },
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 13 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
