import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';
import type { AiProviderType } from '@/services/aiProvider';
import type { LocalModelEntry, OrphanModelFile } from '@/services/localModel';
import { AiActionBar, type AiTestStatus } from './AiActionBar';
import { AiConsentBar } from './AiConsentBar';
import { AiPrivacyInfoCard } from './AiPrivacyInfoCard';
import { AiProviderSelector } from './AiProviderSelector';
import { AiExternalProviderConfig } from './AiExternalProviderConfig';
import { LocalModelSelector } from './LocalModelSelector';
import { LocalModelWarningBanner } from './LocalModelWarningBanner';
import { LocalModelCatalog } from './LocalModelCatalog';
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
  separateVision: boolean;
  vision: VisionFields;

  // Test state
  testStatus: AiTestStatus;
  testMessage: string;

  // Consent
  consentChecked: boolean;

  // Local models
  compatibleModels: ModelWithCompat[];
  downloadedIds: string[];
  downloadingId: string | null;
  downloadProgress: number;
  downloadedMb: number;
  downloadTotalMb: number;
  selectedLocalModelId: string | null;
  orphanModels: OrphanModelFile[];

  // Actions
  onClose: () => void;
  onSave: () => void;
  onTest: () => void;
  onConsentToggle: () => void;
  onProviderSelect: (type: AiProviderType) => void;
  onChangeChat: (patch: Partial<ChatFields>) => void;
  onChangeVision: (patch: Partial<VisionFields>) => void;
  onToggleSeparateVision: (value: boolean) => void;
  onMarkTestStale: () => void;
  onSelectLocalModel: (id: string) => void;
  onDownloadModel: (id: string) => void;
  onDeleteModel: (id: string) => void;
  onCancelDownload: () => void;
  onDeleteOrphanModels: () => void;
  onContactDeveloper: () => void;
}

/**
 * Modal pageSheet pentru configurarea Asistentului AI.
 * Compoziție din: header + AiActionBar + AiConsentBar + ScrollView cu
 * AiPrivacyInfoCard, AiProviderSelector, AiExternalProviderConfig (extern),
 * LocalModelSelector/Catalog/Warning (local), OrphanModelsBanner, BuiltinDescription.
 *
 * State-ul AI rămâne în setari.tsx (peste 20 vars + refs); modalul primește
 * totul prin props pentru ușurința testării și reutilizare în alt context.
 */
export function AiConfigModal({
  visible,
  scheme,
  providerType,
  chat,
  separateVision,
  vision,
  testStatus,
  testMessage,
  consentChecked,
  compatibleModels,
  downloadedIds,
  downloadingId,
  downloadProgress,
  downloadedMb,
  downloadTotalMb,
  selectedLocalModelId,
  orphanModels,
  onClose,
  onSave,
  onTest,
  onConsentToggle,
  onProviderSelect,
  onChangeChat,
  onChangeVision,
  onToggleSeparateVision,
  onMarkTestStale,
  onSelectLocalModel,
  onDownloadModel,
  onDeleteModel,
  onCancelDownload,
  onDeleteOrphanModels,
  onContactDeveloper,
}: AiConfigModalProps) {
  const C = Colors[scheme];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <Text style={[styles.title, { color: C.text }]}>Configurare Asistent AI</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityLabel="Închide">
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        </View>

        <AiActionBar testStatus={testStatus} scheme={scheme} onSave={onSave} onTest={onTest} />

        <AiConsentBar
          providerType={providerType}
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
          {(providerType === 'builtin' || providerType === 'external') && (
            <AiPrivacyInfoCard scheme={scheme} />
          )}

          <AiProviderSelector
            selected={providerType}
            scheme={scheme}
            onSelect={onProviderSelect}
          />

          <View>
            {providerType === 'external' && (
              <AiExternalProviderConfig
                chat={chat}
                separateVision={separateVision}
                vision={vision}
                scheme={scheme}
                onAnyChange={onMarkTestStale}
                onChangeChat={onChangeChat}
                onChangeVision={onChangeVision}
                onToggleSeparateVision={onToggleSeparateVision}
              />
            )}
            <LocalModelSelector
              downloadedIds={downloadedIds}
              allModels={compatibleModels}
              providerType={providerType}
              selectedId={selectedLocalModelId}
              scheme={scheme}
              onSelect={onSelectLocalModel}
            />
          </View>

          {providerType === 'local' && (
            <LocalModelWarningBanner onContactDeveloper={onContactDeveloper} />
          )}

          <LocalModelCatalog
            models={compatibleModels}
            downloadedIds={downloadedIds}
            downloadingId={downloadingId}
            downloadProgress={downloadProgress}
            downloadedMb={downloadedMb}
            downloadTotalMb={downloadTotalMb}
            scheme={scheme}
            onDownload={onDownloadModel}
            onDelete={onDeleteModel}
            onCancel={onCancelDownload}
          />

          <OrphanModelsBanner
            orphans={orphanModels}
            scheme={scheme}
            onCleanup={onDeleteOrphanModels}
          />

          {providerType === 'builtin' && <AiBuiltinDescription scheme={scheme} />}

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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  close: { padding: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40, gap: 20 },
  testMessage: { fontSize: 12, lineHeight: 17 },
});
