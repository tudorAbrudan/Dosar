/**
 * Partajări proprii care așteaptă confirmările celorlalți: șterse „și la ei" (zona
 * golită) sau oprite („Revocă", „Șterge doar la mine"). Fiecare rând arată cine a
 * confirmat (a văzut mesajul și a apăsat OK) și cine nu încă. Partajarea se închide
 * singură când confirmă toți sau la termen; „Oprește acum" o închide imediat.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import {
  SHARE_CLOSE_GRACE_DAYS,
  closeSignalSentAt,
  getClosingParticipants,
  shareCloseKind,
  shareClosesAt,
} from '@/services/shareClosing';
import type { ClosingParticipant, ShareCloseKind } from '@/services/shareClosing';
import { dark, light, statusColors } from '@/theme/colors';
import { ENTITY_TYPE_EMOJI, ENTITY_TYPE_LABELS } from '@/types';
import type { SharedEntity } from '@/services/sharing';

interface Props {
  shares: SharedEntity[];
  onCloseNow: (share: SharedEntity, name: string) => void;
}

const SECTIONS: { kind: ShareCloseKind; title: string; hint: string }[] = [
  {
    kind: 'delete',
    title: 'SE ȘTERG LA CEILALȚI',
    hint: 'Le-ai șters și de pe telefoanele celorlalți.',
  },
  {
    kind: 'stop',
    title: 'PARTAJĂRI OPRITE',
    hint: 'Ceilalți păstrează copia și văd un mesaj că ai oprit partajarea.',
  },
];

const CLOSING_HINT =
  'Cineva confirmă când deschide aplicația și apasă OK pe mesaj. Partajarea se închide ' +
  `când confirmă toți, cel târziu după ${SHARE_CLOSE_GRACE_DAYS} de zile.`;

function formatDay(date: Date): string {
  return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' });
}

function closingStatus(share: SharedEntity): string {
  const closesAt = shareClosesAt(share);
  if (!closeSignalSentAt(share) || !closesAt) {
    return shareCloseKind(share) === 'delete'
      ? 'ștergerea pleacă la următoarea conexiune'
      : 'oprirea pleacă la următoarea conexiune';
  }
  const deadline = `se închide cel târziu pe ${formatDay(closesAt)}`;
  const participants = getClosingParticipants(share);
  if (!participants) return `se verifică cine a primit-o • ${deadline}`;
  const confirmed = participants.filter(p => p.confirmedAt).length;
  return `${confirmed} din ${participants.length} au confirmat • ${deadline}`;
}

/** „Ana, Mihai, încă o persoană" — participanții fără nume vizibil se numără. */
function peopleList(people: ClosingParticipant[]): string | null {
  if (people.length === 0) return null;
  const names = people.filter(p => p.name).map(p => p.name as string);
  const unnamed = people.length - names.length;
  if (unnamed === 1) names.push(names.length > 0 ? 'încă o persoană' : 'o persoană');
  if (unnamed > 1)
    names.push(names.length > 0 ? `încă ${unnamed} persoane` : `${unnamed} persoane`);
  return names.join(', ');
}

export function ClosingSharesCard({ shares, onCloseNow }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  if (shares.length === 0) return null;

  return (
    <>
      {SECTIONS.map(section => {
        const rows = shares.filter(s => shareCloseKind(s) === section.kind);
        if (rows.length === 0) return null;
        return (
          <View key={section.kind}>
            <Text style={[styles.section, { color: palette.textSecondary }]}>{section.title}</Text>
            <View
              style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
            >
              {rows.map((s, idx) => {
                const name = s.share_title ?? ENTITY_TYPE_LABELS[s.entity_type];
                const participants = getClosingParticipants(s) ?? [];
                const confirmed = peopleList(participants.filter(p => p.confirmedAt));
                const waiting = peopleList(participants.filter(p => !p.confirmedAt));
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
                        {ENTITY_TYPE_LABELS[s.entity_type]} • {closingStatus(s)}
                      </Text>
                      {confirmed && (
                        <Text style={[styles.people, { color: palette.text }]}>
                          Au confirmat: {confirmed}
                        </Text>
                      )}
                      {waiting && (
                        <Text style={[styles.people, { color: palette.text }]}>
                          Așteaptă: {waiting}
                        </Text>
                      )}
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
                {section.hint} {CLOSING_HINT}
              </Text>
            </View>
          </View>
        );
      })}
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
  people: { fontSize: 13, marginTop: 8 },
  action: { alignSelf: 'flex-start', paddingVertical: 8 },
  actionText: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, marginTop: 8, lineHeight: 18 },
});
