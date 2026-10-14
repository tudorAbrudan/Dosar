import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { aiRouteLeavesDevice, getAiRoute, type AiProviderType } from '@/services/aiProvider';
import type { LocalModelEntry, OrphanModelFile } from '@/services/localModel';
import { AiActionBar, type AiTestStatus } from './AiActionBar';
import { AiConsentBar } from './AiConsentBar';
import { AiModeCards } from './AiModeCards';
import { AiPrivacyInfoCard } from './AiPrivacyInfoCard';
import { AiExternalProviderConfig } from './AiExternalProviderConfig';
import { LocalModePanel } from './LocalModePanel';
import { OrphanModelsBanner } from './OrphanModelsBanner';
import { AiBuiltinDescription } from './AiBuiltinDescription';

type ModelWithCompat = LocalModelEntry & { incompatibilityReason: string | null };

interface ChatFields {
  url: string;
  apiKey: string;
  model: string;
}

interface VisionFields {
  url: string;
  apiKey: string;
  model: string;
}

export interface AiConfigModalProps {
  visible: boolean;
  scheme: 'light' | 'dark';

  // Provider config state
  providerType: AiProviderType;
  chat: ChatFields;
  chatModelSupportsVision: boolean;
  separateVision: boolean;
  vision: VisionFields;

  // Test state
  testStatus: AiTestStatus;
  testMessage: string;

  // Consent
  consentChecked: boolean;

  // Dosar AI
  builtinUsedToday: number;

  // Local models
  compatibleModels: ModelWithCompat[];
  recommendedModel: LocalModelEntry | null;
  downloadedIds: string[];
  downloadingId: string | null;
  downloadProgress: number;
  downloadedMb: number;
  downloadTotalMb: number;
  selectedLocalModelId: string | null;
  orphanModels: OrphanModelFile[];

  // Alegerile per tip sensibil („Permite" / „Nu întreba din nou")
  hasSensitiveChoices: boolean;

  // Actions
  onClose: () => void;
  onSave: () => void;
  onTest: () => void;
  onConsentToggle: () => void;
  onProviderSelect: (type: AiProviderType) => void;
  onChangeChat: (patch: Partial<ChatFields>) => void;
  onChangeVision: (patch: Partial<VisionFields>) => void;
  onToggleSeparateVision: (value: boolean) => void;
  onToggleChatModelSupportsVision: (value: boolean) => void;
  onMarkTestStale: () => void;
  onSelectLocalModel: (id: string) => void;
  onDownloadModel: (id: string) => void;
  onDeleteModel: (id: string) => void;
  onCancelDownload: () => void;
  onDeleteOrphanModels: () => void;
  onResetSensitiveChoices: () => void;
  onContactDeveloper: () => void;
}

/**
 * Modal pageSheet pentru Setări → Asistent AI.
 *
 * Structura urmează întrebarea pe care și-o pune userul — „unde merg datele?":
 * 1. cele 4 moduri (AiModeCards, aceleași ca la onboarding);
 * 2. configurarea modului ales (model local / Dosar AI / cheie proprie), cu
 *    opțiunile rare ascunse sub „Avansat";
 * 3. „Ce pleacă de pe telefon" pentru configurația din formular.
 * Bara de acord apare doar când ceva pleacă de pe telefon (`getAiRoute`).
 *
 * State-ul AI rămâne în setari.tsx; modalul primește totul prin props.
 */
export function AiConfigModal({
  visible,
  scheme,
  providerType,
  chat,
  chatModelSupportsVision,
  separateVision,
  vision,
  testStatus,
  testMessage,
  consentChecked,
  builtinUsedToday,
  compatibleModels,
  recommendedModel,
  downloadedIds,
  downloadingId,
  downloadProgress,
  downloadedMb,
  downloadTotalMb,
  selectedLocalModelId,
  orphanModels,
  hasSensitiveChoices,
  onClose,
  onSave,
  onTest,
  onConsentToggle,
  onProviderSelect,
  onChangeChat,
  onChangeVision,
  onToggleSeparateVision,
  onToggleChatModelSupportsVision,
  onMarkTestStale,
  onSelectLocalModel,
  onDownloadModel,
  onDeleteModel,
  onCancelDownload,
  onDeleteOrphanModels,
  onResetSensitiveChoices,
  onContactDeveloper,
}: AiConfigModalProps) {
  const C = Colors[scheme];

  // Ruta configurației din formular (încă nesalvată) — aceeași funcție ca la runtime.
  const usesSeparateVision =
    (providerType === 'external' || providerType === 'local') && separateVision;
  const route = getAiRoute({
    type: providerType,
    url: chat.url,
    apiKey: chat.apiKey,
    model: chat.model,
    visionUrl: usesSeparateVision ? vision.url : '',
    visionApiKey: usesSeparateVision ? vision.apiKey : '',
    visionModel: usesSeparateVision ? vision.model : '',
    chatModelSupportsVision: providerType === 'external' && chatModelSupportsVision,
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <Text style={[styles.title, { color: C.text }]}>Asistent AI</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.close}
            accessibilityLabel="Închide"
          >
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        </View>

        <AiActionBar testStatus={testStatus} scheme={scheme} onSave={onSave} onTest={onTest} />

        <AiConsentBar
          providerType={providerType}
          leavesDevice={aiRouteLeavesDevice(route)}
          checked={consentChecked}
          scheme={scheme}
          onToggle={onConsentToggle}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>
            Unde rulează asistentul
          </Text>
          <AiModeCards
            selected={providerType}
            scheme={scheme}
            localRecommended={recommendedModel !== null}
            onSelect={onProviderSelect}
          />

          {providerType === 'local' && (
            <LocalModePanel
              scheme={scheme}
              models={compatibleModels}
              recommended={recommendedModel}
              downloadedIds={downloadedIds}
              selectedId={selectedLocalModelId}
              downloadingId={downloadingId}
              downloadProgress={downloadProgress}
              downloadedMb={downloadedMb}
              downloadTotalMb={downloadTotalMb}
              separateVision={separateVision}
              vision={vision}
              onSelect={onSelectLocalModel}
              onDownload={onDownloadModel}
              onDelete={onDeleteModel}
              onCancelDownload={onCancelDownload}
              onToggleSeparateVision={onToggleSeparateVision}
              onChangeVision={onChangeVision}
              onMarkTestStale={onMarkTestStale}
              onContactDeveloper={onContactDeveloper}
            />
          )}

          {providerType === 'builtin' && (
            <AiBuiltinDescription scheme={scheme} usedToday={builtinUsedToday} />
          )}

          {providerType === 'external' && (
            <AiExternalProviderConfig
              chat={chat}
              chatModelSupportsVision={chatModelSupportsVision}
              separateVision={separateVision}
              vision={vision}
              scheme={scheme}
              onAnyChange={onMarkTestStale}
              onChangeChat={onChangeChat}
              onChangeVision={onChangeVision}
              onToggleSeparateVision={onToggleSeparateVision}
              onToggleChatModelSupportsVision={onToggleChatModelSupportsVision}
            />
          )}

          {testMessage ? (
            <Text
              style={[
                styles.testMessage,
                { color: testStatus === 'error' ? statusColors.critical : statusColors.ok },
              ]}
            >
              {testMessage}
            </Text>
          ) : null}

          <AiPrivacyInfoCard route={route} scheme={scheme} />

          {hasSensitiveChoices && (
            <Pressable onPress={onResetSensitiveChoices} accessibilityRole="button">
              <Text style={[styles.link, { color: primary }]}>
                Resetează alegerile pentru documente sensibile
              </Text>
              <Text style={[styles.linkHint, { color: C.textSecondary }]}>
                Ți-am cerut acordul pentru buletin, pașaport, talon etc. la prima trimitere. După
                resetare te întrebăm din nou.
              </Text>
            </Pressable>
          )}

          <OrphanModelsBanner
            orphans={orphanModels}
            scheme={scheme}
            onCleanup={onDeleteOrphanModels}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  close: { padding: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 16 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  testMessage: { fontSize: 12, lineHeight: 17 },
  link: { fontSize: 14, fontWeight: '600' },
  linkHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});
