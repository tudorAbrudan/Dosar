import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, statusColors } from '@/theme/colors';
import { BottomActionBar } from '@/components/BottomActionBar';
import { useMedicalRecord } from '@/hooks/useMedicalRecord';
import { deleteMedicalRecord } from '@/services/medicalRecord';
import {
  getDocuments,
  addEntityLinkToDocument,
} from '@/services/documents';
import { db } from '@/services/db';
import { MEDICAL_DOC_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document, DocumentType } from '@/types';
import { TimelineTab } from '../_tabs/TimelineTab';
import { DocumenteTab } from '../_tabs/DocumenteTab';
import { ChatTab } from '../_tabs/ChatTab';

type TabKey = 'timeline' | 'documente' | 'chat';

const TAB_LABELS: Record<TabKey, string> = {
  timeline: 'Timeline',
  documente: 'Documente',
  chat: 'Chat',
};

export default function MedicalRecordDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { record, stats, loading, error, refresh } = useMedicalRecord(id ?? null);
  const [tab, setTab] = useState<TabKey>('timeline');
  const [linkDocVisible, setLinkDocVisible] = useState(false);
  const [unlinkedMedDocs, setUnlinkedMedDocs] = useState<Document[]>([]);

  // ── Asociere documente medicale existente care nu sunt încă „atașate" la
  //    dosar prin entity_links. Acoperă scenariul: ai documente medicale
  //    uploadate înainte să creezi dosarul SAU pe alte persoane.
  //    Prioritizare: prima dată documentele persoanei dosarului, apoi restul.
  const loadUnlinked = useCallback(async () => {
    if (!record) return;
    const all = await getDocuments();
    const linkedRows = await db.getAllAsync<{ document_id: string }>(
      'SELECT document_id FROM document_entities WHERE entity_type = ? AND entity_id = ?',
      ['medical_record', record.id]
    );
    const linkedSet = new Set(linkedRows.map(r => r.document_id));
    const candidates = all
      .filter(
        d =>
          (MEDICAL_DOC_TYPES as string[]).includes(d.type) &&
          !linkedSet.has(d.id)
      )
      // Persoana dosarului apare prima; alte persoane / fără persoană la final.
      .sort((a, b) => {
        const aMatch = a.person_id === record.person_id ? 0 : 1;
        const bMatch = b.person_id === record.person_id ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return (b.issue_date ?? '').localeCompare(a.issue_date ?? '');
      });
    setUnlinkedMedDocs(candidates);
  }, [record]);

  useEffect(() => {
    if (linkDocVisible) loadUnlinked();
  }, [linkDocVisible, loadUnlinked]);

  const openLinkDoc = useCallback(async () => {
    setLinkDocVisible(true);
  }, []);

  const handleLinkDoc = useCallback(
    async (docId: string) => {
      if (!record) return;
      try {
        await addEntityLinkToDocument(docId, {
          entityType: 'medical_record',
          entityId: record.id,
        });
        setUnlinkedMedDocs(prev => prev.filter(d => d.id !== docId));
      } catch (e) {
        Alert.alert(
          'Eroare',
          e instanceof Error ? e.message : 'Nu s-a putut asocia documentul.'
        );
      }
    },
    [record]
  );

  const handleDelete = useCallback(() => {
    if (!record) return;
    const obs = stats?.observations_total ?? 0;
    const docs = stats?.documents_total ?? 0;
    const threads = stats?.threads_total ?? 0;
    const lines = [
      `Vei șterge dosarul „${record.name}" definitiv.`,
      '',
      'Acum conține:',
      `• ${obs} observații (analize/valori extrase)`,
      `• ${threads} conversații cu asistentul AI`,
      `• ${docs} documente medicale (rămân atașate persoanei, NU se șterg)`,
      '',
      'Continui?',
    ].join('\n');
    Alert.alert('Șterge dosar medical', lines, [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMedicalRecord(record.id);
            router.back();
          } catch (e) {
            Alert.alert(
              'Eroare',
              e instanceof Error ? e.message : 'Nu s-a putut șterge dosarul.'
            );
          }
        },
      },
    ]);
  }, [record, stats, router]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Stack.Screen
        options={{
          title: record?.name ?? 'Dosar medical',
          headerBackTitle: 'Înapoi',
        }}
      />

      <View
        style={[
          styles.tabBar,
          { borderBottomColor: palette.border, backgroundColor: palette.surface },
        ]}
      >
        {(Object.keys(TAB_LABELS) as TabKey[]).map(t => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              style={[styles.tab, active && { borderBottomColor: primary, borderBottomWidth: 2 }]}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={{
                  color: active ? primary : palette.textSecondary,
                  fontWeight: active ? '700' : '500',
                }}
              >
                {TAB_LABELS[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading && !record ? (
        <View style={styles.center}>
          <ActivityIndicator color={primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: palette.textSecondary }}>{error}</Text>
        </View>
      ) : !record ? (
        <View style={styles.center}>
          <Text style={{ color: palette.textSecondary }}>Dosar negăsit.</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {tab === 'timeline' && (
            <TimelineTab recordId={record.id} stats={stats} onChange={refresh} />
          )}
          {tab === 'documente' && <DocumenteTab record={record} />}
          {tab === 'chat' && <ChatTab record={record} />}
        </View>
      )}

      {/* ── Bottom actions — identic cu detail entitate normală ── */}
      {record ? (
        <BottomActionBar
          actions={[
            {
              icon: 'add-circle-outline',
              label: 'Adaugă doc',
              onPress: () =>
                router.push({
                  pathname: '/(tabs)/documente/add',
                  params: { person_id: record.person_id, restrict_to: 'medical' },
                }),
            },
            {
              icon: 'link-outline',
              label: 'Asociază',
              onPress: openLinkDoc,
            },
            {
              icon: 'trash-outline',
              label: 'Șterge',
              onPress: handleDelete,
              danger: true,
            },
          ]}
        />
      ) : null}

      {/* ── Link existing document modal ── */}
      <Modal
        visible={linkDocVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setLinkDocVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>
              Asociază document medical
            </Text>
            {unlinkedMedDocs.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: palette.textSecondary }]}>
                Nu există documente medicale neasociate pentru această persoană.
                Adaugă unul nou cu „Adaugă doc".
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {unlinkedMedDocs.map(d => (
                  <Pressable
                    key={d.id}
                    style={[styles.linkDocRow, { borderBottomColor: palette.border }]}
                    onPress={() => handleLinkDoc(d.id)}
                  >
                    <Text style={[styles.linkDocType, { color: primary }]}>
                      {DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type}
                    </Text>
                    {d.issue_date ? (
                      <Text
                        style={[styles.linkDocSub, { color: palette.textSecondary }]}
                        numberOfLines={1}
                      >
                        Data: {d.issue_date}
                      </Text>
                    ) : null}
                    {d.note ? (
                      <Text
                        style={[styles.linkDocSub, { color: palette.textSecondary }]}
                        numberOfLines={1}
                      >
                        {d.note}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable
              style={[styles.modalCloseBtn, { backgroundColor: primary }]}
              onPress={() => setLinkDocVisible(false)}
            >
              <Text style={styles.modalCloseText}>Închide</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: { borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalEmpty: { fontSize: 14, lineHeight: 20, marginVertical: 12 },
  linkDocRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkDocType: { fontSize: 15, fontWeight: '600' },
  linkDocSub: { fontSize: 12, marginTop: 2 },
  modalCloseBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
