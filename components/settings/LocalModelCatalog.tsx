import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import type { LocalModelEntry } from '@/services/localModel';

type ModelWithCompat = LocalModelEntry & { incompatibilityReason: string | null };

interface LocalModelCatalogProps {
  models: ModelWithCompat[];
  downloadedIds: string[];
  downloadingId: string | null;
  downloadProgress: number;
  downloadedMb: number;
  downloadTotalMb: number;
  scheme: 'light' | 'dark';
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}

/**
 * Catalog modele AI on-device. Pentru fiecare model:
 * - dacă e incompatibil (RAM/iOS), afișează „Incompatibil" + motiv
 * - dacă nu e descărcat, afișează buton „Descarcă"
 * - dacă se descarcă, afișează progress bar + buton „Anulează"
 * - dacă e descărcat, afișează „Șterge" + bifa „✓ Instalat"
 */
export function LocalModelCatalog({
  models,
  downloadedIds,
  downloadingId,
  downloadProgress,
  downloadedMb,
  downloadTotalMb,
  scheme,
  onDownload,
  onDelete,
  onCancel,
}: LocalModelCatalogProps) {
  const C = Colors[scheme];
  if (models.length === 0) return null;

  return (
    <View>
      <Text style={[styles.label, { color: C.textSecondary }]}>Modele disponibile</Text>
      {models.map(model => {
        const isDownloaded = downloadedIds.includes(model.id);
        const isDownloading = downloadingId === model.id;
        const incompatible = model.incompatibilityReason !== null;
        return (
          <View
            key={model.id}
            style={[
              styles.card,
              {
                backgroundColor: C.card,
                borderColor: C.border,
                opacity: incompatible ? 0.6 : 1,
              },
            ]}
          >
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: C.text }]}>{model.name}</Text>
                <Text style={[styles.label, { color: C.textSecondary, marginTop: 2 }]}>
                  {'★'.repeat(model.qualityStars)}
                  {'☆'.repeat(5 - model.qualityStars)} · {model.sizeLabel}
                </Text>
              </View>
              {isDownloaded && !isDownloading && (
                <Pressable
                  onPress={() => onDelete(model.id)}
                  hitSlop={8}
                  accessibilityLabel={`Șterge ${model.name}`}
                >
                  <Text style={[styles.label, { color: statusColors.critical }]}>Șterge</Text>
                </Pressable>
              )}
              {!isDownloaded && !isDownloading && incompatible && (
                <View style={[styles.btnDisabled, { backgroundColor: C.border }]}>
                  <Text style={[styles.btnText, { color: C.textSecondary }]}>Incompatibil</Text>
                </View>
              )}
              {!isDownloaded && !isDownloading && !incompatible && (
                <Pressable
                  onPress={() => onDownload(model.id)}
                  style={[styles.btn, { backgroundColor: primary }]}
                  accessibilityLabel={`Descarcă ${model.name}`}
                >
                  <Text style={styles.btnText}>Descarcă</Text>
                </Pressable>
              )}
            </View>
            <Text style={[styles.description, { color: C.textSecondary }]}>
              {model.description}
            </Text>
            {isDownloading && (
              <View style={styles.progressBlock}>
                <View style={[styles.progressBar, { backgroundColor: C.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: primary,
                        width: `${Math.round(downloadProgress * 100)}%` as `${number}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.label, { color: C.textSecondary, marginTop: 4 }]}>
                  {Math.round(downloadedMb)}MB / {Math.round(downloadTotalMb)}MB (
                  {Math.round(downloadProgress * 100)}%)
                </Text>
                <Pressable
                  onPress={onCancel}
                  style={{ marginTop: 4 }}
                  accessibilityLabel="Anulează descărcarea"
                >
                  <Text style={[styles.label, { color: statusColors.critical }]}>Anulează</Text>
                </Pressable>
              </View>
            )}
            {incompatible && (
              <Text style={[styles.label, { color: statusColors.warning, marginTop: 4 }]}>
                ⚠ Incompatibil: {model.incompatibilityReason}
              </Text>
            )}
            {isDownloaded && !isDownloading && (
              <Text style={[styles.label, { color: statusColors.ok, marginTop: 4 }]}>
                ✓ Instalat
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
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
  description: {
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  btnDisabled: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBlock: { marginTop: 8 },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
});
