/**
 * Partajări proprii a căror entitate nu mai există pe telefon (restaurare dintr-un
 * backup fără ea, „Șterge toate datele"). Partajarea rămâne activă în iCloud — nu o
 * revocăm automat — deci trebuie să existe un loc de unde userul o poate opri.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { dark, light, statusColors } from '@/theme/colors';
import { ENTITY_TYPE_EMOJI, ENTITY_TYPE_LABELS } from '@/types';
import type { SharedEntity } from '@/services/sharing';

interface Props {
  shares: SharedEntity[];
  onRevoke: (share: SharedEntity, name: string) => void;
}

function orphanedShareName(share: SharedEntity): string {
  return share.share_title ?? ENTITY_TYPE_LABELS[share.entity_type];
}

export function OrphanedSharesCard({ shares, onRevoke }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  if (shares.length === 0) return null;

  return (
    <>
      <Text style={[styles.section, { color: palette.textSecondary }]}>
        PARTAJĂRI FĂRĂ ENTITATE PE TELEFON
      </Text>
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        {shares.map((s, idx) => {
          const name = orphanedShareName(s);
          return (
            <View
              key={s.zone_name}
              style={[
                styles.row,
                idx > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: palette.border,
                },
              ]}
            >
              <Text style={styles.emoji}>{ENTITY_TYPE_EMOJI[s.entity_type]}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={[styles.rowSub, { color: palette.textSecondary }]}>
                  {ENTITY_TYPE_LABELS[s.entity_type]} • nu mai există pe acest telefon
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onRevoke(s, name)}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={`Revocă partajarea ${name}`}
              >
                <Text style={[styles.actionText, { color: statusColors.critical }]}>Revocă</Text>
              </TouchableOpacity>
            </View>
          );
        })}
        <Text style={[styles.hint, { color: palette.textSecondary }]}>
          Entitatea a fost ștearsă de pe acest telefon (de exemplu la o restaurare), dar partajarea
          e încă activă în iCloud. Revoc-o dacă nu mai vrei ca ceilalți să o vadă.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 6, marginLeft: 4 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  emoji: { fontSize: 22 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  action: { paddingHorizontal: 10, paddingVertical: 6 },
  actionText: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, marginTop: 8, lineHeight: 18 },
});
