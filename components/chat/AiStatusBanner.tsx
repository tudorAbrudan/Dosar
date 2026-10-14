import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, statusColors } from '@/theme/colors';

interface AiStatusBannerProps {
  /** null = AI-ul poate răspunde; altfel motivul (banner de avertizare). */
  unavailableReason: string | null;
  /** Cine răspunde, ex. „Dosar AI, în cloud · 7 din 10 cereri azi". */
  label: string;
  /** Răspunsul se generează pe telefon. */
  onDevice: boolean;
  onOpenSettings: () => void;
}

/**
 * Rândul de sub header-ul ambelor chat-uri (general și medical): spune mereu
 * cine răspunde și dacă întrebarea pleacă de pe telefon; când AI-ul nu poate
 * răspunde, devine avertizare cu trimitere la Setări.
 */
export function AiStatusBanner({
  unavailableReason,
  label,
  onDevice,
  onOpenSettings,
}: AiStatusBannerProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  if (unavailableReason) {
    return (
      <Pressable
        style={[styles.banner, { backgroundColor: palette.surface, borderColor: palette.border }]}
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Asistentul AI nu este disponibil. Deschide Setări."
      >
        <Ionicons name="warning-outline" size={20} color={statusColors.warning} />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color: palette.text }]}>
            Asistentul AI nu este disponibil
          </Text>
          <Text style={[styles.bannerBody, { color: palette.textSecondary }]}>
            {unavailableReason}
          </Text>
          <Text style={[styles.bannerCta, { color: primary }]}>Apasă pentru Setări →</Text>
        </View>
      </Pressable>
    );
  }

  if (!label) return null;

  return (
    <Pressable
      style={styles.badge}
      onPress={onOpenSettings}
      accessibilityRole="button"
      accessibilityLabel={`Răspunde: ${label}. Schimbă din Setări.`}
    >
      <Ionicons
        name={onDevice ? 'phone-portrait-outline' : 'cloud-outline'}
        size={14}
        color={palette.textSecondary}
      />
      <Text style={[styles.badgeText, { color: palette.textSecondary }]} numberOfLines={2}>
        Răspunde: {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 14, fontWeight: '700' },
  bannerBody: { fontSize: 13, lineHeight: 18 },
  bannerCta: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  badgeText: { fontSize: 12, flexShrink: 1 },
});
