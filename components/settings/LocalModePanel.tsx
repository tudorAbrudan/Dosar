import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary, onPrimary, statusColors } from '@/theme/colors';
import type { LocalModelEntry } from '@/services/localModel';
import { AiDisclosure } from './AiDisclosure';
import { AiVisionProviderSection } from './AiVisionProviderSection';
import { LocalModelCatalog } from './LocalModelCatalog';
import { LocalModelSelector } from './LocalModelSelector';
import { LocalModelWarningBanner } from './LocalModelWarningBanner';

type ModelWithCompat = LocalModelEntry & { incompatibilityReason: string | null };

interface VisionFields {
  url: string;
  apiKey: string;
  model: string;
}

interface LocalModePanelProps {
  scheme: 'light' | 'dark';
  models: ModelWithCompat[];
  recommended: LocalModelEntry | null;
  downloadedIds: string[];
  selectedId: string | null;
  downloadingId: string | null;
  downloadProgress: number;
  downloadedMb: number;
  downloadTotalMb: number;
  separateVision: boolean;
  vision: VisionFields;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  onCancelDownload: () => void;
  onToggleSeparateVision: (value: boolean) => void;
  onChangeVision: (patch: Partial<VisionFields>) => void;
  onMarkTestStale: () => void;
  onContactDeveloper: () => void;
}

/**
 * Panoul modului „Model local" din Setări → Asistent AI. Calea obișnuită e
 * vizibilă (modelele instalate + modelul recomandat pentru telefon, cu un buton
 * de descărcare); catalogul complet și citirea pozelor în cloud stau sub
 * „Alte modele" / „Avansat".
 */
export function LocalModePanel({
  scheme,
  models,
  recommended,
  downloadedIds,
  selectedId,
  downloadingId,
  downloadProgress,
  downloadedMb,
  downloadTotalMb,
  separateVision,
  vision,
  onSelect,
  onDownload,
  onDelete,
  onCancelDownload,
  onToggleSeparateVision,
  onChangeVision,
  onMarkTestStale,
  onContactDeveloper,
}: LocalModePanelProps) {
  const C = Colors[scheme];
  const downloading = downloadingId ? models.find(m => m.id === downloadingId) : undefined;
  const showRecommended =
    recommended !== null &&
    downloadedIds.length === 0 &&
    downloadingId === null &&
    !downloadedIds.includes(recommended.id);

  return (
    <View style={styles.container}>
      {recommended === null && downloadedIds.length === 0 && (
        <Text style={[styles.hint, { color: C.textSecondary }]}>
          Telefonul tău nu îndeplinește cerințele pentru un model local. Alege „Dosar AI" sau „Cheie
          API proprie".
        </Text>
      )}

      <LocalModelSelector
        downloadedIds={downloadedIds}
        allModels={models}
        providerType="local"
        selectedId={selectedId}
        scheme={scheme}
        onSelect={onSelect}
      />

      {showRecommended && recommended && (
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.cardLabel, { color: C.textSecondary }]}>
            Recomandat pentru telefonul tău
          </Text>
          <Text style={[styles.cardTitle, { color: C.text }]}>
            {recommended.name} · {recommended.sizeLabel}
          </Text>
          <Text style={[styles.hint, { color: C.textSecondary }]}>{recommended.description}</Text>
          <Pressable
            style={[styles.btn, { backgroundColor: primary }]}
            onPress={() => onDownload(recommended.id)}
            accessibilityRole="button"
            accessibilityLabel={`Descarcă ${recommended.name}`}
          >
            <Text style={[styles.btnText, { color: onPrimary }]}>Descarcă modelul</Text>
          </Pressable>
        </View>
      )}

      {downloading && (
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>Se descarcă {downloading.name}</Text>
          <View style={[styles.progressTrack, { backgroundColor: C.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: primary, width: `${Math.round(downloadProgress * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.hint, { color: C.textSecondary }]}>
            {Math.round(downloadedMb)} din {Math.round(downloadTotalMb)} MB. Poți închide ecranul —
            descărcarea continuă, iar modelul devine activ când e gata.
          </Text>
          <Pressable onPress={onCancelDownload} accessibilityRole="button">
            <Text style={[styles.cancel, { color: statusColors.critical }]}>Anulează</Text>
          </Pressable>
        </View>
      )}

      <AiDisclosure title={`Alte modele (${models.length})`} scheme={scheme}>
        <LocalModelCatalog
          models={models}
          downloadedIds={downloadedIds}
          downloadingId={downloadingId}
          downloadProgress={downloadProgress}
          downloadedMb={downloadedMb}
          downloadTotalMb={downloadTotalMb}
          scheme={scheme}
          onDownload={onDownload}
          onDelete={onDelete}
          onCancel={onCancelDownload}
        />
      </AiDisclosure>

      <LocalModelWarningBanner onContactDeveloper={onContactDeveloper} />

      <AiDisclosure title="Avansat" scheme={scheme} initiallyOpen={separateVision}>
        <AiVisionProviderSection
          scheme={scheme}
          enabled={separateVision}
          vision={vision}
          toggleTitle="Citește pozele documentelor în cloud"
          toggleHintEnabled="Pozele pleacă la providerul de mai jos doar când apeși „Trimite documentul la AI”. Chat-ul și textul rămân pe telefon."
          toggleHintDisabled="Modelul local citește doar text. Activează ca pozele documentelor să fie citite de un provider din cloud (ex. Mistral, Anthropic)."
          onAnyChange={onMarkTestStale}
          onToggle={onToggleSeparateVision}
          onChangeVision={onChangeVision}
        />
      </AiDisclosure>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  cardLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
  btn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  btnText: { fontSize: 15, fontWeight: '600' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%' },
  cancel: { fontSize: 13, fontWeight: '600' },
});
