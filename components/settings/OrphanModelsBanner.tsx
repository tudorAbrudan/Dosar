import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';
import type * as localModel from '@/services/localModel';

interface OrphanModelsBannerProps {
  orphans: localModel.OrphanModelFile[];
  scheme: 'light' | 'dark';
  onCleanup: () => void;
}

/**
 * Banner afișat când există fișiere de model AI rămase de la versiuni anterioare
 * (modele care nu mai sunt în catalogul curent). Permite eliberarea spațiului.
 */
export function OrphanModelsBanner({ orphans, scheme, onCleanup }: OrphanModelsBannerProps) {
  const C = Colors[scheme];
  if (orphans.length === 0) return null;

  const totalMb = Math.round(orphans.reduce((s, o) => s + o.sizeBytes, 0) / (1024 * 1024));
  const fileWord = orphans.length === 1 ? 'fișier' : 'fișiere';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: C.card, borderColor: statusColors.warning },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: C.text }]}>Modele AI vechi</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            {orphans.length} {fileWord} (~{totalMb} MB) rămase de la versiuni anterioare. Nu mai
            sunt folosite.
          </Text>
        </View>
        <Pressable
          onPress={onCleanup}
          style={[styles.btn, { backgroundColor: statusColors.critical }]}
          accessibilityLabel="Eliberează spațiul ocupat de modele vechi"
        >
          <Text style={styles.btnText}>Eliberează</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  sub: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
