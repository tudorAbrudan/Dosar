/**
 * Pasul VEHICLE_MGMT din OnboardingWizard — 4 carduri cu feature-uri:
 * acte vehicul, remindere, alimentări + statistici consum, OCR.
 *
 * Afișat doar dacă userul a ales „Vehicul" la pasul ENTITIES.
 */
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { radius, spacing } from '@/theme/layout';

const FEATURES = [
  {
    icon: 'car-sport-outline' as const,
    title: 'Acte vehicul într-un singur loc',
    desc: 'Talon, carte auto, RCA, CASCO, ITP, vignetă, revizie — fiecare cu data de expirare.',
  },
  {
    icon: 'notifications-outline' as const,
    title: 'Remindere automate',
    desc: 'Cu 7, 14 sau 30 zile înainte de expirare. Notificări locale, fără server.',
  },
  {
    icon: 'speedometer-outline' as const,
    title: 'Alimentări și statistici consum',
    desc: 'Înregistrezi alimentările și vezi consumul mediu, costul pe 100 km, evoluția lunară.',
  },
  {
    icon: 'scan-outline' as const,
    title: 'Scanare cu OCR',
    desc: 'Fotografiezi talonul sau cartea auto — datele esențiale se completează automat.',
  },
];

interface VehicleMgmtStepProps {
  scheme: 'light' | 'dark';
}

export function VehicleMgmtStep({ scheme }: VehicleMgmtStepProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.block}>
      {FEATURES.map(item => (
        <View
          key={item.icon}
          style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}
        >
          <View style={styles.row}>
            <Ionicons name={item.icon} size={22} color={C.primary} />
            <View style={styles.text}>
              <Text style={[styles.title, { color: C.text }]}>{item.title}</Text>
              <Text style={[styles.sub, { color: C.textSecondary }]}>{item.desc}</Text>
            </View>
          </View>
        </View>
      ))}
      <Text style={[styles.note, { color: C.textSecondary }]}>
        Adaugi vehiculele tale ulterior din tabul Entități → Vehicul.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 14,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  text: { flex: 1, marginLeft: spacing.gap },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  sub: { fontSize: 13, lineHeight: 18 },
  note: { fontSize: 13, marginTop: 4, lineHeight: 18 },
});
