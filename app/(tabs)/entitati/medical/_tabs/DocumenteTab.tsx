import { useState, useEffect, useCallback } from 'react';
import {
  View,
  FlatList,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, statusColors } from '@/theme/colors';
import { db } from '@/services/db';
import { batchReExtract, estimateBatch, type BatchDocReport } from '@/services/medicalExtractor';
import {
  getObservationCountsByDocument,
  type DocumentObservationStats,
} from '@/services/medicalObservations';
import { getDocumentIdentifier } from '@/services/documentIdentifier';
import { on as subscribe } from '@/services/events';
import {
  MEDICAL_DOC_TYPES,
  DOCUMENT_TYPE_LABELS,
  type MedicalRecord,
  type DocumentType,
} from '@/types';

interface Props {
  record: MedicalRecord;
}

interface DocRow {
  id: string;
  type: string;
  issue_date: string | null;
  note: string | null;
  metadata: string | null;
  ai_summary: string | null;
}

/**
 * Identificator scurt pentru un document medical, în contextul listei dosarului.
 * Folosește helper-ul comun `getDocumentIdentifier` (sursă unică, fără PII), cu
 * fallback pe eticheta tipului. `DocRow.metadata` e string JSON din SQLite →
 * îl parsăm la obiect înainte.
 */
function getDocIdentifier(row: DocRow): string {
  let metadata: Record<string, string> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, string>;
    } catch {
      /* metadata corupt sau gol */
    }
  }
  const id = getDocumentIdentifier({ note: row.note, metadata });
  return id ?? DOCUMENT_TYPE_LABELS[row.type as DocumentType] ?? row.type;
}

interface BatchState {
  running: boolean;
  cancelled: boolean;
  total: number;
  done: number;
  failed: number;
  inserted: number;
  noData: number;
  noConsent: number;
}

interface ExtractBadge {
  label: string;
  bg: string;
  fg: string;
  border: string;
  icon: keyof typeof Ionicons.glyphMap;
  a11y: string;
}

function computeBadge(
  stats: DocumentObservationStats | undefined,
  palette: typeof light,
  processed: boolean
): ExtractBadge {
  if (!stats || stats.total === 0) {
    // Diferențiem „procesat de AI, dar fără valori numerice" (ex. scrisoare
    // medicală, bilet de trimitere) de „neprocesat încă". Altfel ambele arătau
    // „—" și păreau o eroare.
    if (processed) {
      return {
        label: 'fără valori',
        bg: palette.surface,
        fg: palette.textSecondary,
        border: palette.border,
        icon: 'checkmark-circle-outline',
        a11y: 'Procesat de AI — fără valori numerice de extras',
      };
    }
    return {
      label: 'neextras',
      bg: palette.surface,
      fg: palette.textSecondary,
      border: palette.border,
      icon: 'ellipse-outline',
      a11y: 'Neprocesat încă — apasă „Extrage observații"',
    };
  }
  if (stats.needsReview > 0) {
    return {
      label: `${stats.total} (${stats.needsReview}?)`,
      bg: statusColors.warningSurface,
      fg: statusColors.warning,
      border: statusColors.warning,
      icon: 'alert-circle-outline',
      a11y: `${stats.total} observații extrase, ${stats.needsReview} de verificat`,
    };
  }
  return {
    label: `${stats.total}`,
    bg: `${primary}22`,
    fg: primary,
    border: primary,
    icon: 'checkmark-circle-outline',
    a11y: `${stats.total} observații extrase`,
  };
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  no_data: 'fără date',
  failed: 'eroare AI',
  too_large: 'text prea lung',
  ai_unavailable: 'AI indisponibil',
  unsupported_type: 'tip nesuportat',
  no_record: 'fără dosar',
  no_consent: 'fără consent',
};

export function DocumenteTab({ record }: Props) {
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [obsCounts, setObsCounts] = useState<Map<string, DocumentObservationStats>>(new Map());
  const [batchState, setBatchState] = useState<BatchState>({
    running: false,
    cancelled: false,
    total: 0,
    done: 0,
    failed: 0,
    inserted: 0,
    noData: 0,
    noConsent: 0,
  });
  const [diagnosticReports, setDiagnosticReports] = useState<BatchDocReport[]>([]);
  const [diagnosticVisible, setDiagnosticVisible] = useState(false);
  const cancelledRef = useState<{ value: boolean }>({ value: false })[0];

  const loadDocs = useCallback(async () => {
    const medicalDocTypesArr = Array.from(MEDICAL_DOC_TYPES);
    const placeholders = medicalDocTypesArr.map(() => '?').join(',');
    const [rows, counts] = await Promise.all([
      db.getAllAsync<DocRow>(
        `SELECT DISTINCT d.id, d.type, d.issue_date, d.note, d.metadata, d.ai_summary
         FROM documents d
         JOIN document_entities de ON de.document_id = d.id
         WHERE d.type IN (${placeholders})
           AND de.entity_type = 'medical_record'
           AND de.entity_id = ?
         ORDER BY d.issue_date DESC, d.created_at DESC`,
        [...medicalDocTypesArr, record.id]
      ),
      getObservationCountsByDocument(record.id),
    ]);
    setDocs(rows);
    setObsCounts(counts);
  }, [record.id]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    const offDocs = subscribe('documents:changed', () => loadDocs());
    const offEntities = subscribe('entities:changed', () => loadDocs());
    return () => {
      offDocs();
      offEntities();
    };
  }, [loadDocs]);

  const onReExtract = useCallback(async () => {
    if (batchState.running) return;
    try {
      const e = await estimateBatch(record.id, { skipAlreadyExtracted: true });
      if (e.total_documents === 0) {
        Alert.alert('Niciun document', 'Nu ai documente medicale de procesat.');
        return;
      }
      if (e.to_process === 0) {
        Alert.alert(
          'Toate documentele au fost procesate',
          `Cele ${e.already_extracted} documente au deja observații extrase.`
        );
        return;
      }
      const skipNote =
        e.already_extracted > 0
          ? `\n(${e.already_extracted} documente cu observații deja extrase vor fi sărite.)`
          : '';
      Alert.alert(
        'Extrage observații',
        `Vor fi procesate ${e.to_process} documente (~${e.estimated_calls} apeluri AI).${skipNote}\n\nContinui?`,
        [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Continuă',
            onPress: () => {
              cancelledRef.value = false;
              setBatchState({
                running: true,
                cancelled: false,
                total: e.to_process,
                done: 0,
                failed: 0,
                inserted: 0,
                noData: 0,
                noConsent: 0,
              });
              setDiagnosticReports([]);
              batchReExtract(
                record.id,
                p => setBatchState({ ...p, running: true }),
                () => cancelledRef.value,
                { skipAlreadyExtracted: true }
              )
                .then(final => {
                  setBatchState({ ...final, running: false });
                  setDiagnosticReports(final.reports);
                  void loadDocs();
                  const title = final.cancelled
                    ? 'Operație anulată'
                    : final.inserted > 0
                      ? 'Extracție finalizată'
                      : 'Niciun rezultat extras';
                  const parts: string[] = [
                    `${final.done}/${final.total} documente procesate.`,
                    `${final.inserted} observații extrase.`,
                  ];
                  if (final.failed > 0) parts.push(`${final.failed} eșuate (erori AI / timeout).`);
                  if (final.noData > 0)
                    parts.push(`${final.noData} fără date (OCR gol sau AI a returnat JSON gol).`);
                  if (final.noConsent > 0)
                    parts.push(
                      `${final.noConsent} blocate de consent / lipsă dosar (verifică toggle AI medical + consent per dosar).`
                    );
                  const showDetails = final.reports.length > 0;
                  const buttons = showDetails
                    ? [
                        { text: 'OK', style: 'cancel' as const },
                        {
                          text: 'Vezi detalii',
                          // iOS: UIAlertController încă se animă în dismiss când
                          // onPress fire-uiește. Prezentarea unui <Modal> imediat
                          // eșuează silent (UIKit refuză present-on-presenting).
                          // Defer cu setTimeout ca să lăsăm alertul să dispară.
                          onPress: () => {
                            setTimeout(() => setDiagnosticVisible(true), 350);
                          },
                        },
                      ]
                    : [{ text: 'OK', style: 'cancel' as const }];
                  Alert.alert(title, parts.join('\n'), buttons);
                })
                .catch(err => {
                  setBatchState(s => ({ ...s, running: false }));
                  Alert.alert('Eroare', err instanceof Error ? err.message : 'Extracția a eșuat.');
                });
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut estima costul.');
    }
  }, [record.id, batchState.running, cancelledRef, loadDocs]);

  const cancelBatch = useCallback(() => {
    cancelledRef.value = true;
  }, [cancelledRef]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={docs}
        keyExtractor={d => d.id}
        contentContainerStyle={{ paddingBottom: 12 }}
        renderItem={({ item }) => {
          const stats = obsCounts.get(item.id);
          const badge = computeBadge(stats, palette, item.ai_summary != null);
          const identifier = getDocIdentifier(item);
          const typeLabel = DOCUMENT_TYPE_LABELS[item.type as DocumentType] ?? item.type;
          const dateLabel = item.issue_date ?? 'Fără dată';
          // Când nu există un emitent distinct, identifier === eticheta tipului →
          // afișăm doar data în subtitlu ca să nu repetăm tipul de două ori.
          const subtitle =
            identifier === typeLabel ? dateLabel : `${typeLabel} · ${dateLabel}`;
          return (
            <Pressable
              style={[styles.row, { backgroundColor: palette.card, borderColor: palette.border }]}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/documente/[id]',
                  params: {
                    id: item.id,
                    from: 'medical',
                    entityId: record.id,
                  },
                })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.docType, { color: palette.text }]} numberOfLines={1}>
                  {identifier}
                </Text>
                <Text style={[styles.docDate, { color: palette.textSecondary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
              <View
                style={[
                  styles.extractBadge,
                  { backgroundColor: badge.bg, borderColor: badge.border },
                ]}
                accessibilityLabel={badge.a11y}
              >
                <Ionicons name={badge.icon} size={12} color={badge.fg} />
                <Text
                  style={[styles.extractBadgeText, { color: badge.fg }]}
                  numberOfLines={1}
                >
                  {badge.label}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textSecondary} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-outline" size={48} color={palette.textSecondary} />
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
              Niciun document medical pentru această persoană.
            </Text>
            <Text style={[styles.emptyHint, { color: palette.textSecondary }]}>
              Apasă „Adaugă doc" din bara de jos pentru a începe.
            </Text>
          </View>
        }
        ListFooterComponent={
          // Acțiunea de extragere face scroll împreună cu lista (nu mai e pinned).
          // În timpul rulării footerul dispare; bara de progres rămâne fixă jos.
          docs.length > 0 && !batchState.running ? (
            <View>
              <Pressable
                style={[
                  styles.reExtractBtn,
                  { borderColor: primary, backgroundColor: `${primary}15` },
                ]}
                onPress={() => onReExtract()}
              >
                <Ionicons name="sparkles-outline" size={18} color={primary} />
                <Text style={[styles.reExtractText, { color: primary, fontWeight: '600' }]}>
                  Extrage observații din documente noi
                </Text>
                <View style={styles.reExtractSpacer} />
              </Pressable>
              {diagnosticReports.length > 0 && (
                <Pressable
                  style={[
                    styles.diagBtn,
                    { borderColor: palette.border, backgroundColor: palette.card },
                  ]}
                  onPress={() => setDiagnosticVisible(true)}
                >
                  <Ionicons name="information-circle-outline" size={16} color={primary} />
                  <Text style={[styles.diagBtnText, { color: primary }]}>
                    Vezi detalii ultima extracție
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
      />

      {batchState.running ? (
        <View
          style={[
            styles.batchBar,
            { backgroundColor: palette.card, borderTopColor: palette.border },
          ]}
        >
          <ActivityIndicator color={primary} />
          <Text style={[styles.batchText, { color: palette.text }]}>
            Procesez {batchState.done}/{batchState.total} documente…
          </Text>
          <Pressable onPress={cancelBatch}>
            <Text style={{ color: primary, fontWeight: '600' }}>Anulează</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={diagnosticVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDiagnosticVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>
              Detalii extracție ({diagnosticReports.length} doc)
            </Text>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              {diagnosticReports.map((r, idx) => {
                const doc = docs.find(d => d.id === r.documentId);
                const docLabel = doc ? getDocIdentifier(doc) : r.documentId.slice(0, 8);
                const statusLabel = STATUS_LABEL[r.status] ?? r.status;
                const lines: string[] = [];
                if (r.ocr_len !== undefined) lines.push(`OCR: ${r.ocr_len} caractere`);
                if (r.ocr_sample) {
                  lines.push('OCR (primele 400 char):');
                  lines.push(r.ocr_sample);
                }
                if (r.llm_raw_obs !== undefined)
                  lines.push(`AI a întors: ${r.llm_raw_obs} observații (validate: ${r.inserted})`);
                if (r.llm_response_sample) {
                  lines.push('Răspuns AI (primele 300 char):');
                  lines.push(r.llm_response_sample);
                }
                return (
                  <View key={idx} style={[styles.diagRow, { borderBottomColor: palette.border }]}>
                    <View style={styles.diagHeader}>
                      <Text style={[styles.diagDocName, { color: palette.text }]} numberOfLines={2}>
                        {docLabel}
                      </Text>
                      <View
                        style={[
                          styles.diagStatusPill,
                          {
                            backgroundColor:
                              r.status === 'ok' ? `${primary}33` : palette.background,
                            borderColor: r.status === 'ok' ? primary : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.diagStatusText,
                            { color: r.status === 'ok' ? primary : palette.textSecondary },
                          ]}
                        >
                          {statusLabel}
                        </Text>
                      </View>
                    </View>
                    {lines.map((l, li) => (
                      <Text
                        key={li}
                        style={[styles.diagLine, { color: palette.textSecondary }]}
                        selectable
                      >
                        {l}
                      </Text>
                    ))}
                  </View>
                );
              })}
              {diagnosticReports.length === 0 && (
                <Text style={{ color: palette.textSecondary, padding: 12 }}>
                  Niciun raport disponibil — rulează „Re-extrage" întâi.
                </Text>
              )}
            </ScrollView>
            <Pressable
              style={[styles.modalCloseBtn, { backgroundColor: primary }]}
              onPress={() => setDiagnosticVisible(false)}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  docType: { fontSize: 15, fontWeight: '500' },
  docDate: { fontSize: 12, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, marginTop: 12, textAlign: 'center' },
  emptyHint: { fontSize: 13, marginTop: 6, textAlign: 'center' },
  reExtractBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  reExtractText: { fontSize: 14, flex: 1, textAlign: 'center' },
  reExtractSpacer: { width: 18 },
  extractBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  extractBadgeText: { fontSize: 11, fontWeight: '600' },
  diagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  diagBtnText: { fontSize: 13, fontWeight: '500' },
  batchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderTopWidth: 1,
  },
  batchText: { flex: 1, fontSize: 14 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: { borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  diagRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  diagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  diagDocName: { flex: 1, fontSize: 14, fontWeight: '600' },
  diagStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  diagStatusText: { fontSize: 11, fontWeight: '600' },
  diagLine: { fontSize: 12, marginTop: 2, lineHeight: 16 },
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
