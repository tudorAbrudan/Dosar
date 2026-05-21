import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { SectionCard } from './SectionCard';

interface SecuritateSectionProps {
  appLockEnabled: boolean;
  medicalAppLockEnabled: boolean;
  scheme: 'light' | 'dark';
  onToggle: (value: boolean) => void;
  onToggleMedicalLock: (value: boolean) => void;
}

export function SecuritateSection({
  appLockEnabled,
  medicalAppLockEnabled,
  scheme,
  onToggle,
  onToggleMedicalLock,
}: SecuritateSectionProps) {
  const C = Colors[scheme];
  return (
    <>
      <SectionCard title="Securitate" scheme={scheme}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={[styles.rowIcon, { backgroundColor: iconColors.pink.bg }]}>
              <Ionicons name="lock-closed-outline" size={18} color={iconColors.pink.fg} />
            </View>
            <View style={styles.rowLabelWrap}>
              <Text style={[styles.rowLabel, { color: C.text }]}>Blocare aplicație</Text>
              <Text style={[styles.rowSub, { color: C.textSecondary }]}>
                Face ID / Touch ID / PIN
              </Text>
            </View>
          </View>
          <Switch
            value={appLockEnabled}
            onValueChange={onToggle}
            trackColor={{ false: C.border, true: primary }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.rowLast}>
          <View style={styles.rowLeft}>
            <View style={[styles.rowIcon, { backgroundColor: iconColors.pink.bg }]}>
              <Ionicons name="medkit-outline" size={18} color={iconColors.pink.fg} />
            </View>
            <View style={styles.rowLabelWrap}>
              <Text style={[styles.rowLabel, { color: C.text }]}>App Lock pentru dosare medicale</Text>
              <Text style={[styles.rowSub, { color: C.textSecondary }]}>
                Cere autentificare la deschiderea unui dosar medical, independent de App Lock-ul
                global. Timeout 5 minute.
              </Text>
            </View>
          </View>
          <Switch
            value={medicalAppLockEnabled}
            onValueChange={onToggleMedicalLock}
            trackColor={{ false: C.border, true: primary }}
            thumbColor="#fff"
          />
        </View>
      </SectionCard>
      {appLockEnabled && (
        <Text style={[styles.lockHint, { color: C.textSecondary }]}>
          Dacă ai Face ID configurat pe telefon, poți debloca aplicația cu el chiar dacă uiți
          PIN-ul. Dacă ai uitat PIN-ul și nu ai Face ID, dezactivează blocarea din Setări iPhone →
          Parolă și Face ID → resetează datele aplicației.
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
  },
  rowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  rowLabelWrap: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 16 },
  lockHint: { fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 4, paddingHorizontal: 4 },
});
