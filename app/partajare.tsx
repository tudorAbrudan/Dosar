import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import { dark, light, onPrimary, primary, statusColors } from '@/theme/colors';
import { useEntities } from '@/hooks/useEntities';
import { useSharing } from '@/hooks/useSharing';
import { ENTITY_TYPE_EMOJI, ENTITY_TYPE_LABELS } from '@/types';
import type { EntityType } from '@/types';

interface ShareableRow {
  type: EntityType;
  id: string;
  name: string;
}

export default function PartajareScreen() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const { persons, vehicles, properties, animals, companies } = useEntities();
  const { shares, available, loading, error, share, revoke, sync } = useSharing();

  const shareable = useMemo<ShareableRow[]>(
    () => [
      ...vehicles.map(v => ({ type: 'vehicle' as EntityType, id: v.id, name: v.name })),
      ...persons.map(p => ({ type: 'person' as EntityType, id: p.id, name: p.name })),
      ...properties.map(p => ({ type: 'property' as EntityType, id: p.id, name: p.name })),
      ...animals.map(a => ({ type: 'animal' as EntityType, id: a.id, name: a.name })),
      ...companies.map(c => ({ type: 'company' as EntityType, id: c.id, name: c.name })),
    ],
    [persons, vehicles, properties, animals, companies]
  );

  const ownedShares = useMemo(() => shares.filter(s => s.role === 'owner'), [shares]);
  const receivedShares = useMemo(() => shares.filter(s => s.role === 'participant'), [shares]);

  const isShared = (type: EntityType, id: string) =>
    ownedShares.some(s => s.entity_type === type && s.entity_id === id);

  const onShare = (row: ShareableRow) => {
    share(row.type, row.id).catch(() => {
      Alert.alert('Partajare', 'Nu s-a putut partaja. Verifică iCloud și conexiunea.');
    });
  };

  const onRevoke = (row: ShareableRow) => {
    Alert.alert(
      'Revocă accesul',
      `Oprești partajarea „${row.name}"? Persoana nu va mai primi actualizări (ce a văzut deja rămâne la ea).`,
      [
        { text: 'Anulează', style: 'cancel' },
        { text: 'Revocă', style: 'destructive', onPress: () => void revoke(row.type, row.id) },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: 'Partajare' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Status iCloud */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.statusRow}>
            <Ionicons
              name={available ? 'cloud-done' : 'cloud-offline'}
              size={22}
              color={available ? statusColors.ok : statusColors.warning}
            />
            <Text style={[styles.statusText, { color: palette.text }]}>
              {available ? 'iCloud disponibil' : 'iCloud indisponibil'}
            </Text>
            <TouchableOpacity onPress={() => void sync()} style={styles.syncBtn}>
              <Ionicons name="refresh" size={20} color={primary} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            Partajează o entitate cu familia. Documentele medicale, notele private și cardurile
            rămân doar la tine.
          </Text>
        </View>

        {error ? (
          <Text style={[styles.error, { color: statusColors.critical }]}>{error}</Text>
        ) : null}

        {/* Entitățile mele */}
        <Text style={[styles.section, { color: palette.textSecondary }]}>ENTITĂȚILE MELE</Text>
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          {shareable.length === 0 ? (
            <Text style={[styles.empty, { color: palette.textSecondary }]}>
              {loading ? 'Se încarcă…' : 'Nu ai entități de partajat.'}
            </Text>
          ) : (
            shareable.map((row, idx) => {
              const shared = isShared(row.type, row.id);
              return (
                <View
                  key={`${row.type}-${row.id}`}
                  style={[
                    styles.row,
                    idx > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: palette.border,
                    },
                  ]}
                >
                  <Text style={styles.emoji}>{ENTITY_TYPE_EMOJI[row.type]}</Text>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={[styles.rowSub, { color: palette.textSecondary }]}>
                      {ENTITY_TYPE_LABELS[row.type]}
                    </Text>
                  </View>
                  {shared ? (
                    <TouchableOpacity onPress={() => onRevoke(row)} style={styles.action}>
                      <Text style={[styles.actionText, { color: statusColors.critical }]}>
                        Revocă
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => onShare(row)}
                      style={[styles.actionPrimary, { backgroundColor: primary }]}
                      disabled={!available}
                    >
                      <Ionicons name="share-outline" size={16} color={onPrimary} />
                      <Text style={styles.actionPrimaryText}>Partajează</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* Partajat cu mine */}
        <Text style={[styles.section, { color: palette.textSecondary }]}>PARTAJAT CU MINE</Text>
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          {receivedShares.length === 0 ? (
            <Text style={[styles.empty, { color: palette.textSecondary }]}>
              Nimic încă. Când cineva îți partajează o entitate, apare aici.
            </Text>
          ) : (
            receivedShares.map((s, idx) => (
              <View
                key={s.id}
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
                    {ENTITY_TYPE_LABELS[s.entity_type]}
                  </Text>
                  <Text style={[styles.rowSub, { color: palette.textSecondary }]}>
                    {s.owner_name ?? 'partajat'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <Text style={[styles.beta, { color: palette.textSecondary }]}>
          Funcție în Beta. Sincronizarea live între conturi se validează la testarea pe două
          dispozitive.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { fontSize: 16, fontWeight: '600', flex: 1 },
  syncBtn: { padding: 4 },
  hint: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  error: { fontSize: 13, marginBottom: 8 },
  section: { fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 6, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  emoji: { fontSize: 22 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  action: { paddingHorizontal: 10, paddingVertical: 6 },
  actionText: { fontSize: 14, fontWeight: '600' },
  actionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionPrimaryText: { color: onPrimary, fontSize: 14, fontWeight: '600' },
  empty: { fontSize: 14, paddingVertical: 8, textAlign: 'center' },
  beta: { fontSize: 12, marginTop: 20, textAlign: 'center', lineHeight: 17 },
});
