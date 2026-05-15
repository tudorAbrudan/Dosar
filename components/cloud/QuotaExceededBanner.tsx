/**
 * Banner afișat în ecranul de Cloud Backup când iCloud-ul user-ului e plin.
 * Conține buton pentru a deschide direct setările iCloud Storage.
 *
 * Extras din `app/cloud-backup.tsx`.
 */
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';

interface QuotaExceededBannerProps {
  scheme: 'light' | 'dark';
}

export function QuotaExceededBanner({ scheme }: QuotaExceededBannerProps) {
  const C = Colors[scheme];
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: `${statusColors.critical}1A`, borderColor: statusColors.critical },
      ]}
    >
      <View style={styles.header}>
        <Ionicons name="cloud-offline" size={20} color={statusColors.critical} />
        <Text style={[styles.title, { color: statusColors.critical }]}>
          iCloud-ul tău este plin
        </Text>
      </View>
      <Text style={[styles.body, { color: C.text }]}>
        Backup-ul nu a putut fi finalizat fiindcă nu mai e spațiu liber în contul tău iCloud.
        Eliberează spațiu sau extinde planul iCloud, apoi încearcă din nou.
      </Text>
      {Platform.OS === 'ios' && (
        <Pressable
          onPress={() => {
            void Linking.openURL('App-Prefs:APPLE_ACCOUNT&path=ICLOUD_SERVICE/STORAGE_USAGE');
          }}
          style={({ pressed }) => [
            styles.cta,
            { borderColor: statusColors.critical, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.ctaText, { color: statusColors.critical }]}>
            Deschide setări iCloud
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 18 },
  cta: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  ctaText: { fontSize: 14, fontWeight: '600' },
});
