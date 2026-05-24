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
}

/**
 * Identificator scurt pentru un document medical, în contextul listei dosarului
 * (entitatea = persoana → numele pacientului e redundant). Prioritate:
 *   1. metadata.lab / clinic / spital / cabinet / emitent — sursa documentului.
 *   2. Linie „Laborator/Clinică/Spital/Cabinet: <X>" din note → returnează X.
 *   3. Prima pereche „Câmp: Valoare" din note unde câmpul nu e personal —
 *      returnează doar valoarea. Liniile narrative fără `:` sunt sărite,
 *      evităm leak de PII când AI nu respectă formatul Câmp:Valoare.
 *   4. Eticheta tipului.
 */
const PERSONAL_FIELD_PATTERN =
  /^(pacient|nume|prenume|cnp|adres[aă]|jude[tț]|cas|cod\s*pacient|sex(ul)?|v[aâ]rsta|telefon|email|data\s*na[sș]terii|n[aă]scut[aă]?|asigurat[aă]?|tip\s*document)\b/i;
const ISSUER_LINE_PATTERN =
  /^(laborator(?:ul)?|clinic[aă]|spital(?:ul)?|cabinet(?:ul)?\s*medical|cabinet|unitate\s*medical[aă]|emitent|furnizor|medic|doctor|policlinic[aă]|centru\s*medical)\s*[:\-]\s*(.+)/i;
const FIELD_VALUE_PATTERN = /^([^:]+?)\s*:\s*(.+)$/;

function stripLinePrefix(line: string): string {
  return line.replace(/^[\s\-•*·▪►‐-―\d.()]+/, '').trim();
}

function getDocIdentifier(row: DocRow): string {
  if (row.metadata) {
    try {
      const m = JSON.parse(row.metadata) as Record<string, unknown>;
      for (const key of [
        'lab',
        'clinic',
        'clinica',
        'supplier',
        'unitate_medicala',
        'spital',
        'cabinet',
        'emitent',
        'furnizor',
      ]) {
        const v = m[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    } catch {
      /* metadata corupt sau gol */
    }
  }
  if (row.note?.trim()) {
    const lines = row.note.split('\n').map(stripLinePrefix).filter(Boolean);
    for (const line of lines) {
      const m = line.match(ISSUER_LINE_PATTERN);
      if (m && m[2]?.trim()) return m[2].trim();
    }
    for (const line of lines) {
      const fv = line.match(FIELD_VALUE_PATTERN);
      if (!fv) continue;
      if (PERSONAL_FIELD_PATTERN.test(fv[1].trim())) continue;
      const value = fv[2].trim();
      if (value) return value;
    }
  }
  return DOCUMENT_TYPE_LABELS[row.type as DocumentType] ?? row.type;
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
  palette: typeof light
): ExtractBadge {
  if (!stats || stats.total === 0) {
    return {
      label: '—',
      bg: palette.surface,
      fg: palette.textSecondary,
      border: palette.border,
      icon: 'remove-outline',
      a11y: 'Niciun rezultat extras',
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
        `SELECT DISTINCT d.id, d.type, d.issue_date, d.note, d.metadata
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

  const onReExtract = useCallback(async (skipAlreadyExtracted: boolean) => {
    if (batchState.running) return;
    try {
      const e = await estimateBatch(record.id, { skipAlreadyExtracted });
      if (e.total_documents === 0) {
        Alert.alert('Niciun document', 'Nu ai documente medicale de procesat.');
        return;
      }
      if (e.to_process === 0) {
        Alert.alert(
          'Toate documentele au fost procesate',
          `Cele ${e.already_extracted} documente au deja observații extrase. Folosește „Re-extrage TOATE" dacă vrei să rulezi din nou peste ele.`
        );
        return;
      }
      const title = skipAlreadyExtracted
        ? 'Extrage observații'
        : 'Re-extrage TOATE observațiile';
      const skipNote = skipAlreadyExtracted && e.already_extracted > 0
        ? `\n(${e.already_extracted} documente cu observații deja extrase vor fi sărite.)`
        : '';
      Alert.alert(
        title,
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
                { skipAlreadyExtracted }
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
                          onPress: () => setDiagnosticVisible(true),
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
          const badge = computeBadge(stats, palette);
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
                  {getDocIdentifier(item)}
                </Text>
                <Text style={[styles.docDate, { color: palette.textSecondary }]} numberOfLines={1}>
                  {`${DOCUMENT_TYPE_LABELS[item.type as DocumentType] ?? item.type} · ${item.issue_date ?? 'Fără dată'}`}
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
                <Text style={[styles.extractBadgeText, { color: badge.fg }]}>{badge.label}</Text>
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
      ) : docs.length > 0 ? (
        <View>
          <Pressable
            style={[
              styles.reExtractBtn,
              { borderColor: primary, backgroundColor: `${primary}15` },
            ]}
            onPress={() => onReExtract(true)}
          >
            <Ionicons name="sparkles-outline" size={18} color={primary} />
            <Text style={[styles.reExtractText, { color: primary, fontWeight: '600' }]}>
              Extrage observații din documente noi
            </Text>
            <View style={styles.reExtractSpacer} />
          </Pressable>
          <Pressable
            style={[
              styles.reExtractSecondaryBtn,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
            onPress={() => onReExtract(false)}
          >
            <Ionicons name="refresh" size={14} color={palette.textSecondary} />
            <Text style={[styles.reExtractSecondaryText, { color: palette.textSecondary }]}>
              Re-extrage TOATE (inclusiv documente deja procesate)
            </Text>
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
  reExtractSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reExtractSecondaryText: { fontSize: 12, fontStyle: 'italic' },
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
