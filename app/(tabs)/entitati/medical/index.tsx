import { useState, useCallback, useEffect } from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary } from '@/theme/colors';
import { listMedicalRecords } from '@/services/medicalRecord';
import { db } from '@/services/db';
import { CreateMedicalRecordModal } from '@/components/medical/CreateMedicalRecordModal';
import type { MedicalRecord } from '@/types';

type EnrichedRecord = MedicalRecord & { personName: string };

export default function MedicalRecordsList() {
  const router = useRouter();
  const params = useLocalSearchParams<{ create?: string }>();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [records, setRecords] = useState<EnrichedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Auto-deschide modalul când se navighează cu `?create=1` (ex: din „Adaugă
  // entitate" → „Dosar medical"). Param-ul se folosește o singură dată.
  useEffect(() => {
    if (params.create === '1') {
      setShowCreate(true);
      router.setParams({ create: undefined });
    }
  }, [params.create, router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const recs = await listMedicalRecords();
      const enriched = await Promise.all(
        recs.map(async r => {
          const p = await db.getFirstAsync<{ name: string }>(
            'SELECT name FROM persons WHERE id = ?',
            [r.person_id]
          );
          return { ...r, personName: p?.name ?? 'Necunoscut' };
        })
      );
      setRecords(enriched);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Stack.Screen
        options={{
          title: 'Dosare medicale',
          headerBackTitle: 'Înapoi',
        }}
      />
      <FlatList
        data={records}
        keyExtractor={r => r.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
            onPress={() => router.push(`/entitati/medical/${item.id}`)}
          >
            <View style={[styles.iconWrap, { backgroundColor: '#FCE4EC' }]}>
              <MaterialCommunityIcons name="medical-bag" size={26} color="#C2185B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: palette.text }]}>{item.name}</Text>
              <Text style={[styles.cardSubtitle, { color: palette.textSecondary }]}>
                {item.personName}
                {item.ai_consent_at ? ' · AI activ' : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={palette.textSecondary} />
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="medical-bag" size={48} color={palette.textSecondary} />
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
                Niciun dosar medical încă.
              </Text>
              <Text style={[styles.emptyHint, { color: palette.textSecondary }]}>
                Apasă „+" pentru a crea un dosar pentru o persoană.
              </Text>
            </View>
          )
        }
      />

      <Pressable
        style={[styles.fab, { backgroundColor: primary }]}
        onPress={() => setShowCreate(true)}
        accessibilityRole="button"
        accessibilityLabel="Adaugă dosar medical"
      >
        <Ionicons name="add" size={28} color={onPrimary} />
      </Pressable>

      <CreateMedicalRecordModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={id => {
          refresh();
          router.push(`/entitati/medical/${id}`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSubtitle: { fontSize: 13, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 24 },
  emptyText: { fontSize: 16, marginTop: 12, textAlign: 'center' },
  emptyHint: { fontSize: 13, marginTop: 4, textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
});
