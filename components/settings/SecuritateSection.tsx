import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { SectionCard } from './SectionCard';

interface SecuritateSectionProps {
  appLockEnabled: boolean;
  scheme: 'light' | 'dark';
  onToggle: (value: boolean) => void;
}

export function SecuritateSection({
  appLockEnabled,
  scheme,
  onToggle,
}: SecuritateSectionProps) {
  const C = Colors[scheme];
  return (
    <>
      <SectionCard title="Securitate" scheme={scheme}>
        <View style={styles.rowLast}>
          <View style={styles.rowLeft}>
            <View style={[styles.rowIcon, { backgroundColor: '#FCE4EC' }]}>
              <Ionicons name="lock-closed-outline" size={18} color="#C62828" />
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
  rowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  rowLabelWrap: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 16 },
  lockHint: { fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 4, paddingHorizontal: 4 },
});
