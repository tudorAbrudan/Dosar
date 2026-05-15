/**
 * Cloud backup step din OnboardingWizard — 4 variante în funcție de statusul
 * iCloud:
 *   - `checking`   → spinner
 *   - `available`, fără meta → toggle "Activează backup în iCloud" + bullet list
 *   - `available`, cu meta   → "Am găsit un backup" + buton "Da, restaurează"
 *   - `unavailable`          → mesaj de fallback (iCloud Drive dezactivat)
 *
 * Extras din OnboardingWizard.tsx (~112 linii).
 */
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { radius, spacing } from '@/theme/layout';

export type CloudCheckStatus =
  | { status: 'checking' }
  | { status: 'available'; meta: { count: number; date: string } | null }
  | { status: 'unavailable' };

interface CloudBackupStepProps {
  scheme: 'light' | 'dark';
  cloudCheck: CloudCheckStatus;
  cloudOptIn: boolean;
  cloudRestoring: boolean;
  onChangeOptIn: (value: boolean) => void;
  onRestore: () => void;
}

const BULLETS = [
  'Backup imediat la fiecare document salvat — fără efort.',
  'Restore în câteva minute pe iPhone nou cu același Apple ID.',
  'Datele sunt în iCloud-ul tău; nu trec printr-un server al nostru.',
];

export function CloudBackupStep({
  scheme,
  cloudCheck,
  cloudOptIn,
  cloudRestoring,
  onChangeOptIn,
  onRestore,
}: CloudBackupStepProps) {
  const C = Colors[scheme];

  if (cloudCheck.status === 'checking') {
    return (
      <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={styles.row}>
          <ActivityIndicator color={C.primary} />
          <Text style={[styles.subtitle, { color: C.textSecondary, marginLeft: 12 }]}>
            Verific iCloud...
          </Text>
        </View>
      </View>
    );
  }

  if (cloudCheck.status === 'available' && cloudCheck.meta == null) {
    return (
      <View style={styles.block}>
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={styles.cardRow}>
            <View style={styles.cardRowText}>
              <Text style={[styles.label, { color: C.text }]}>Activează backup în iCloud</Text>
              <Text style={[styles.sub, { color: C.textSecondary }]}>
                Salvăm automat copii ale documentelor în iCloud-ul tău, în folderul „Dosar".
                Poți dezactiva oricând din Setări.
              </Text>
            </View>
            <Switch
              value={cloudOptIn}
              onValueChange={onChangeOptIn}
              trackColor={{ false: C.border, true: primary }}
            />
          </View>
        </View>
        {BULLETS.map(line => (
          <View key={line} style={styles.bullet}>
            <Text style={[styles.bulletDot, { color: C.primary }]}>•</Text>
            <Text style={[styles.bulletText, { color: C.text }]}>{line}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (cloudCheck.status === 'available' && cloudCheck.meta != null) {
    const { count, date } = cloudCheck.meta;
    return (
      <View style={styles.block}>
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.label, { color: C.text }]}>Am găsit un backup</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            În iCloud există un backup din {date} cu {count}{' '}
            {count === 1 ? 'document' : 'documente'}. Vrei să-l restaurezi acum?
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: C.primary, opacity: cloudRestoring || pressed ? 0.85 : 1 },
            ]}
            onPress={onRestore}
            disabled={cloudRestoring}
          >
            <Text style={styles.ctaText}>Da, restaurează backup-ul</Text>
          </Pressable>
          <Text style={[styles.sub, { color: C.textSecondary, marginTop: 12 }]}>
            Dacă alegi „Nu, încep gol", backup-ul automat rămâne activ și începe să se
            sincronizeze de la zero din momentul ăsta.
          </Text>
        </View>
      </View>
    );
  }

  // status === 'unavailable'
  return (
    <View style={styles.block}>
      <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={styles.row}>
          <Ionicons name="cloud-offline-outline" size={22} color={statusColors.warning} />
          <View style={{ flex: 1, marginLeft: spacing.gap }}>
            <Text style={[styles.title, { color: C.text }]}>iCloud nu este disponibil</Text>
            <Text style={[styles.subtitle, { color: C.textSecondary }]}>
              {Platform.OS === 'ios'
                ? 'Pentru backup automat, activează iCloud Drive din Setări iOS și revino în aplicație. Între timp, poți folosi backup manual din pasul anterior.'
                : 'Backup automat în cloud nu este disponibil pe acest device. Folosește backup manual (export ZIP) descris la pasul anterior.'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardRowText: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { fontSize: 18, lineHeight: 22, width: 14 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 22 },
  cta: {
    marginTop: 16,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  // Text peste fundal primary (verde) — alb pe ambele teme, theme-neutral.
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
