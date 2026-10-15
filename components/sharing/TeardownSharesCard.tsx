/**
 * Partajări proprii golite după „Șterge și la ei": entitatea e ștearsă de pe telefon,
 * dar partajarea rămâne deschisă până ajunge ștergerea la toți, apoi se închide
 * singură. „Oprește acum" o închide imediat.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { shareClosesAt, SHARE_CLOSE_GRACE_DAYS } from '@/services/shareClosing';
import { dark, light, statusColors } from '@/theme/colors';
import { ENTITY_TYPE_EMOJI, ENTITY_TYPE_LABELS } from '@/types';
import type { SharedEntity } from '@/services/sharing';

interface Props {
  shares: SharedEntity[];
  onCloseNow: (share: SharedEntity, name: string) => void;
}

function teardownStatus(share: SharedEntity): string {
  const closesAt = shareClosesAt(share);
  if (!closesAt) return 'ștergerea pleacă la următoarea conexiune';
  const date = closesAt.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' });
  return `se închide pe ${date}`;
}

export function TeardownSharesCard({ shares, onCloseNow }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  if (shares.length === 0) return null;

  return (
    <>
      <Text style={[styles.section, { color: palette.textSecondary }]}>SE ȘTERG LA CEILALȚI</Text>
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        {shares.map((s, idx) => {
          const name = s.share_title ?? ENTITY_TYPE_LABELS[s.entity_type];
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
                  {ENTITY_TYPE_LABELS[s.entity_type]} • {teardownStatus(s)}
                </Text>
                {/* Sub text, nu lângă: la mărimi mari de text rândul ar rămâne fără loc. */}
                <TouchableOpacity
                  onPress={() => onCloseNow(s, name)}
                  style={styles.action}
                  accessibilityRole="button"
                  accessibilityLabel={`Oprește acum partajarea ${name}`}
                >
                  <Text style={[styles.actionText, { color: statusColors.critical }]}>
                    Oprește acum
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        <Text style={[styles.hint, { color: palette.textSecondary }]}>
          Le-ai șters și de pe telefoanele celorlalți. Partajarea rămâne deschisă{' '}
          {SHARE_CLOSE_GRACE_DAYS} de zile, ca ștergerea să ajungă și la cine e offline, apoi se
          închide singură.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 6, marginLeft: 4 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, gap: 12 },
  emoji: { fontSize: 22 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  action: { alignSelf: 'flex-start', paddingVertical: 8 },
  actionText: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, marginTop: 8, lineHeight: 18 },
});
