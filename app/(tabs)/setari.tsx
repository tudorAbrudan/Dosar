import { useEffect, useState, useRef } from 'react';
import * as localModel from '@/services/localModel';
import type { LocalModelEntry } from '@/services/localModel';
import * as FileSystem from 'expo-file-system/legacy';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Switch,
  View as RNView,
  Text as RNText,
  TextInput,
  Platform,
  Modal,
  Linking,
  DeviceEventEmitter,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useThemePreference } from '@/hooks/useThemeScheme';
import { PRIVACY_URL, SUPPORT_URL } from '@/constants/AppLinks';
import { InfoRow } from '@/components/settings/InfoRow';
import { LegalModal } from '@/components/settings/LegalModal';
import { buildTermsText, buildPrivacyText } from '@/components/settings/legalTexts';
import { OnboardingSection } from '@/components/settings/OnboardingSection';
import { AboutSection } from '@/components/settings/AboutSection';
import { AsistentAiSection } from '@/components/settings/AsistentAiSection';
import { PrivacyGdprSection } from '@/components/settings/PrivacyGdprSection';
import { ContactSection } from '@/components/settings/ContactSection';
import { DiagnosticSection } from '@/components/settings/DiagnosticSection';
import { SecuritateSection } from '@/components/settings/SecuritateSection';
import { AspectSection } from '@/components/settings/AspectSection';
import { NotificariSection } from '@/components/settings/NotificariSection';
import { VizibilitateEntitatiSection } from '@/components/settings/VizibilitateEntitatiSection';
import { VizibilitateDocTypesSection } from '@/components/settings/VizibilitateDocTypesSection';
import { BackupSection } from '@/components/settings/BackupSection';
import { LocalModelWarningBanner } from '@/components/settings/LocalModelWarningBanner';
import { LocalModelCatalog } from '@/components/settings/LocalModelCatalog';
import { OrphanModelsBanner } from '@/components/settings/OrphanModelsBanner';
import { AiProviderSelector } from '@/components/settings/AiProviderSelector';
import { AiExternalProviderConfig } from '@/components/settings/AiExternalProviderConfig';
import { LocalModelSelector } from '@/components/settings/LocalModelSelector';
import { AiConsentBar } from '@/components/settings/AiConsentBar';
import { AiPrivacyInfoCard } from '@/components/settings/AiPrivacyInfoCard';
import { AiConfigModal } from '@/components/settings/AiConfigModal';
import AppLockPinModal from '@/components/AppLockPinModal';
import { primary, statusColors } from '@/theme/colors';
import * as settings from '@/services/settings';
import * as aiProvider from '@/services/aiProvider';
import type { AiProviderType } from '@/services/aiProvider';
import { AI_CONSENT_KEY } from '@/services/aiProvider';
import { scheduleExpirationReminders } from '@/services/notifications';
import { exportBackup, importBackup } from '@/services/backup';
import { checkForUpdateForced, openAppStore } from '@/services/updateCheck';
import {
  getLastCrash,
  clearLastCrash,
  formatCrashForClipboard,
  type NativeCrashReport,
} from '@/services/crashReporter';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '@/services/db';
import { emit } from '@/services/events';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { ONBOARDING_RESET_EVENT } from '@/app/_layout';
import { useRouter } from 'expo-router';
import {
  ALL_ENTITY_TYPES,
  STANDARD_DOC_TYPES,
  ENTITY_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_EMOJI,
} from '@/types';
import type { EntityType, DocumentType } from '@/types';
type ModelWithCompat = LocalModelEntry & { incompatibilityReason: string | null };

const ENTITY_LABELS = ENTITY_TYPE_LABELS;
const ENTITY_ICONS = ENTITY_TYPE_EMOJI;

// ─── Constante contact ────────────────────────────────────────────────────────
// TODO: înlocuiește cu datele reale înainte de publish
const CONTACT_EMAIL = 'apps.tudor@gmail.com';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const APP_NAME = Constants.expoConfig?.name ?? 'Documente';

const TERMS_TEXT = buildTermsText({
  appName: APP_NAME,
  contactEmail: CONTACT_EMAIL,
  privacyUrl: PRIVACY_URL,
});
const PRIVACY_TEXT = buildPrivacyText({
  appName: APP_NAME,
  contactEmail: CONTACT_EMAIL,
  privacyUrl: PRIVACY_URL,
});

// ─── Ecranul principal ────────────────────────────────────────────────────────

export default function SetariScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { preference: themePref, setPreference: setThemePref } = useThemePreference();

  const { customTypes, createCustomType, deleteCustomType } = useCustomTypes();
  const { visibleEntityTypes, visibleDocTypes, updateVisibleEntityTypes, updateVisibleDocTypes } =
    useVisibilitySettings();
  const [newTypeName, setNewTypeName] = useState('');
  const [notifDays, setNotifDays] = useState(7);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appLockPinModal, setAppLockPinModal] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [aiConsentGiven, setAiConsentGiven] = useState(false);
  const [aiMedicalAllowed, setAiMedicalAllowedState] = useState(false);
  const [medicalAppLockEnabled, setMedicalAppLockEnabledState] = useState(true);

  // ── AI Provider ─────────────────────────────────────────────────────────────
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiProviderType, setAiProviderType] = useState<AiProviderType>('none');
  const [aiProviderUrl, setAiProviderUrl] = useState('');
  const [aiProviderModel, setAiProviderModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  // Provider OCR / vision separat (opțional). Dacă userul nu vrea provider separat,
  // toate cele 3 câmpuri rămân goale și la save se persistă goale = fallback la chat.
  const [aiSeparateVision, setAiSeparateVision] = useState(false);
  const [aiVisionUrl, setAiVisionUrl] = useState('');
  const [aiVisionModel, setAiVisionModel] = useState('');
  const [aiVisionApiKey, setAiVisionApiKey] = useState('');
  const [aiChatModelSupportsVision, setAiChatModelSupportsVision] = useState(false);
  const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [aiTestMessage, setAiTestMessage] = useState('');
  const [aiModalConsentChecked, setAiModalConsentChecked] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [compatibleModels, setCompatibleModels] = useState<ModelWithCompat[]>([]);
  const [downloadedModelIds, setDownloadedModelIds] = useState<string[]>([]);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedMb, setDownloadedMb] = useState(0);
  const [downloadTotalMb, setDownloadTotalMb] = useState(0);
  const [selectedLocalModelId, setSelectedLocalModelId] = useState<string | null>(null);
  const [orphanModels, setOrphanModels] = useState<localModel.OrphanModelFile[]>([]);
  const downloadResumableRef = useRef<ReturnType<typeof localModel.createModelDownload> | null>(
    null
  );
  const savedExternalRef = useRef({
    url: '',
    model: '',
    apiKey: '',
    visionUrl: '',
    visionModel: '',
    visionApiKey: '',
    chatModelSupportsVision: false,
  });
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupImporting, setBackupImporting] = useState(false);
  const [backupCollapsed, setBackupCollapsed] = useState(true);
  const [entitiesCollapsed, setEntitiesCollapsed] = useState(true);
  const [docTypesCollapsed, setDocTypesCollapsed] = useState(true);
  const [aspectCollapsed, setAspectCollapsed] = useState(true);
  const [lastCrash, setLastCrash] = useState<NativeCrashReport | null>(null);
  const router = useRouter();

  useEffect(() => {
    settings.getNotificationDays().then(setNotifDays);
    settings.getPushEnabled().then(setPushEnabled);
    settings.getShowOrphansOnHome().then(setShowOrphans);
    settings.getAppLockEnabled().then(setAppLockEnabled);
    settings.getAiMedicalAllowed().then(setAiMedicalAllowedState);
    settings.getMedicalAppLockEnabled().then(setMedicalAppLockEnabledState);
    AsyncStorage.getItem(AI_CONSENT_KEY).then(v => setAiConsentGiven(v === 'true'));
    aiProvider.getAiConfig().then(cfg => {
      setAiProviderType(cfg.type);
      setAiProviderUrl(cfg.url);
      setAiProviderModel(cfg.model);
      setAiApiKey(cfg.apiKey);
      setAiVisionUrl(cfg.visionUrl);
      setAiVisionModel(cfg.visionModel);
      setAiVisionApiKey(cfg.visionApiKey);
      setAiChatModelSupportsVision(cfg.chatModelSupportsVision);
      // Toggle „provider OCR diferit" e pornit dacă oricare din cele 3 câmpuri vision
      // a fost completat anterior; altfel oprit (default = același provider ca chat).
      const hasSeparate =
        cfg.visionUrl.trim() !== '' ||
        cfg.visionModel.trim() !== '' ||
        cfg.visionApiKey.trim() !== '';
      setAiSeparateVision(hasSeparate);
    });
    // Snapshot „Cheie proprie" — persistat în AsyncStorage + SecureStore, deci
    // populat indiferent de tipul activ. Astfel, comutarea spre „Dosar AI" și
    // înapoi nu pierde URL/model/cheia API setate anterior.
    aiProvider.getExternalChatSnapshot().then(snap => {
      savedExternalRef.current = snap;
    });
    // Modele locale
    void (async () => {
      const models = localModel.getAllModels();
      setCompatibleModels(models);
      const downloaded: string[] = [];
      for (const m of models) {
        if (await localModel.isModelDownloaded(m.id)) downloaded.push(m.id);
      }
      setDownloadedModelIds(downloaded);
      localModel.getSelectedModelId().then(setSelectedLocalModelId);
      try {
        const orphans = await localModel.listOrphanModels();
        setOrphanModels(orphans);
      } catch {
        // best-effort
      }
    })();
    getLastCrash().then(setLastCrash);
  }, []);

  // ── Diagnostic / crash report ────────────────────────────────────────────────
  const handleCopyCrash = async () => {
    if (!lastCrash) return;
    try {
      await Clipboard.setStringAsync(formatCrashForClipboard(lastCrash));
      Alert.alert('Copiat', 'Detaliile crash-ului au fost copiate în clipboard.');
    } catch {
      Alert.alert('Eroare', 'Nu am putut copia în clipboard.');
    }
  };

  const handleClearCrash = () => {
    if (!lastCrash) return;
    Alert.alert(
      'Șterge raportul',
      'Vrei să ștergi raportul de crash salvat? Nu mai poate fi recuperat.',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            await clearLastCrash();
            setLastCrash(null);
          },
        },
      ]
    );
  };

  // ── App lock ─────────────────────────────────────────────────────────────────
  const handleAppLockToggle = (value: boolean) => {
    if (value) {
      setAppLockPinModal(true);
    } else {
      settings.setAppLockEnabled(false);
      settings.clearAppLockPin();
      setAppLockEnabled(false);
    }
  };

  // ── Notificări ───────────────────────────────────────────────────────────────
  const handleNotifDays = (v: string) => {
    const n = parseInt(v, 10);
    if (!isNaN(n)) {
      const clamped = Math.max(1, Math.min(90, n));
      setNotifDays(clamped);
      settings.setNotificationDays(clamped);
      scheduleExpirationReminders().catch(() => {});
    }
  };

  const handlePushToggle = (v: boolean) => {
    setPushEnabled(v);
    settings.setPushEnabled(v);
    scheduleExpirationReminders().catch(() => {});
  };

  const handleShowOrphansToggle = (v: boolean) => {
    setShowOrphans(v);
    settings.setShowOrphansOnHome(v).catch(() => {});
  };

  // ── Backup ───────────────────────────────────────────────────────────────────
  const handleExportBackup = async () => {
    setBackupExporting(true);
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Export eșuat');
    } finally {
      setBackupExporting(false);
    }
  };

  const handleImportBackup = async () => {
    Alert.alert(
      'Import backup',
      'Vor fi importate înregistrările noi. Entitățile și documentele deja existente vor fi ignorate automat.',
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Importă',
          onPress: async () => {
            setBackupImporting(true);
            try {
              const { imported, skipped, errors } = await importBackup();
              const skippedNote = skipped > 0 ? `\n${skipped} deja existente (ignorate).` : '';
              if (errors.length > 0) {
                Alert.alert(
                  'Import parțial',
                  `${imported} înregistrări importate.${skippedNote}\n\nErori:\n${errors.slice(0, 5).join('\n')}`
                );
              } else {
                Alert.alert(
                  'Succes',
                  `${imported} înregistrări importate cu succes.${skippedNote}`
                );
              }
            } catch (e) {
              if ((e as Error)?.message === 'Anulat') return;
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Import eșuat');
            } finally {
              setBackupImporting(false);
            }
          },
        },
      ]
    );
  };

  // ── Tipuri personalizate ─────────────────────────────────────────────────────
  const handleAddCustomType = async () => {
    const name = newTypeName.trim();
    if (!name) return;
    try {
      await createCustomType(name);
      setNewTypeName('');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga');
    }
  };

  const handleDeleteCustomType = (id: string, name: string) => {
    Alert.alert(
      'Șterge tip',
      `Ștergi tipul „${name}"? Documentele existente vor apărea ca „Tip personalizat".`,
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: () => deleteCustomType(id).catch(() => {}),
        },
      ]
    );
  };

  const handleToggleEntityType = async (entityType: EntityType) => {
    const isVisible = visibleEntityTypes.includes(entityType);
    if (isVisible && visibleEntityTypes.length <= 1) {
      Alert.alert('Minim unul', 'Trebuie să ai cel puțin un tip de entitate activat.');
      return;
    }

    const next = isVisible
      ? visibleEntityTypes.filter(e => e !== entityType)
      : [...visibleEntityTypes, entityType];
    await updateVisibleEntityTypes(next);
  };

  const handleToggleDocType = (docType: DocumentType) => {
    const isVisible = visibleDocTypes.includes(docType);
    if (isVisible && visibleDocTypes.length <= 1) {
      Alert.alert('Minim unul', 'Trebuie să ai cel puțin un tip de document activat.');
      return;
    }
    const next = isVisible
      ? visibleDocTypes.filter(d => d !== docType)
      : [...visibleDocTypes, docType];
    updateVisibleDocTypes(next);
  };

  // ── AI Provider ─────────────────────────────────────────────────────────────
  const handleAiProviderSelect = async (type: AiProviderType) => {
    if (aiProviderType === 'external') {
      savedExternalRef.current = {
        url: aiProviderUrl,
        model: aiProviderModel,
        apiKey: aiApiKey,
        visionUrl: aiVisionUrl,
        visionModel: aiVisionModel,
        visionApiKey: aiVisionApiKey,
        chatModelSupportsVision: aiChatModelSupportsVision,
      };
    }
    if (aiProviderType === 'local' && type !== 'local') {
      await localModel.disposeLocalModel().catch(() => {});
    }
    setAiProviderType(type);
    if (type === 'external') {
      setAiProviderUrl(savedExternalRef.current.url);
      setAiProviderModel(savedExternalRef.current.model);
      setAiApiKey(savedExternalRef.current.apiKey);
      setAiVisionUrl(savedExternalRef.current.visionUrl);
      setAiVisionModel(savedExternalRef.current.visionModel);
      setAiVisionApiKey(savedExternalRef.current.visionApiKey);
      setAiChatModelSupportsVision(savedExternalRef.current.chatModelSupportsVision);
      const hasSeparate =
        savedExternalRef.current.visionUrl.trim() !== '' ||
        savedExternalRef.current.visionModel.trim() !== '' ||
        savedExternalRef.current.visionApiKey.trim() !== '';
      setAiSeparateVision(hasSeparate);
    } else {
      const defaults = aiProvider.PROVIDER_DEFAULTS[type];
      setAiProviderUrl(defaults.url);
      setAiProviderModel(defaults.model);
      // Pentru `local` păstrăm câmpurile vision (provider remote diferit) și
      // toggle-ul existent — userul poate cupla chat local + vision remote.
      // Pentru `builtin` / `none` resetăm vision (Pixtral built-in are vision
      // implicit; `none` nu rulează nimic).
      if (type !== 'local') {
        setAiVisionUrl('');
        setAiVisionModel('');
        setAiVisionApiKey('');
        setAiSeparateVision(false);
      }
      setAiChatModelSupportsVision(false);
    }
    setAiTestStatus('idle');
    setAiTestMessage('');
    if (type === 'local' || type === 'none') {
      setAiModalConsentChecked(false);
    } else {
      setAiModalConsentChecked(aiConsentGiven);
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    const model = compatibleModels.find(m => m.id === modelId);
    if (!model) return;

    Alert.alert(
      'Descarcă model',
      `${model.name} ocupă ${model.sizeLabel}. Asigură-te că ai spațiu liber și o conexiune Wi-Fi. Continui?`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Descarcă',
          onPress: async () => {
            setDownloadingModelId(modelId);
            setDownloadProgress(0);
            try {
              await FileSystem.makeDirectoryAsync(
                (FileSystem.documentDirectory ?? '') + 'models/',
                { intermediates: true }
              );
              const resumable = localModel.createModelDownload(
                modelId,
                (progress, dlMb, totalMb) => {
                  setDownloadProgress(progress);
                  setDownloadedMb(dlMb);
                  setDownloadTotalMb(totalMb);
                }
              );
              downloadResumableRef.current = resumable;
              await resumable.downloadAsync();
              setDownloadedModelIds(prev => [...prev, modelId]);
              await localModel.setSelectedModelId(modelId);
              setSelectedLocalModelId(modelId);
              setAiProviderType('local');
              await aiProvider.saveAiConfig({
                type: 'local',
                url: '',
                model: modelId,
                visionUrl: '',
                visionModel: '',
                chatModelSupportsVision: false,
              });
            } catch (e) {
              await localModel.deleteModel(modelId);
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Descărcarea a eșuat.');
            } finally {
              setDownloadingModelId(null);
              downloadResumableRef.current = null;
            }
          },
        },
      ]
    );
  };

  const handleCancelDownload = async () => {
    if (downloadResumableRef.current) {
      await downloadResumableRef.current.pauseAsync().catch(() => {});
      downloadResumableRef.current = null;
    }
    if (downloadingModelId) {
      await localModel.deleteModel(downloadingModelId);
    }
    setDownloadingModelId(null);
    setDownloadProgress(0);
  };

  const handleDeleteModel = (modelId: string) => {
    const model = compatibleModels.find(m => m.id === modelId);
    Alert.alert(
      'Șterge model',
      `Ești sigur că vrei să ștergi ${model?.name ?? modelId}? Va trebui să îl descarci din nou.`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            await localModel.deleteModel(modelId);
            setDownloadedModelIds(prev => prev.filter(id => id !== modelId));
            const selected = await localModel.getSelectedModelId();
            if (selected === modelId) {
              await localModel.disposeLocalModel().catch(() => {});
              setAiProviderType('builtin');
              await aiProvider.saveAiConfig({
                type: 'builtin',
                url: aiProvider.PROVIDER_DEFAULTS.builtin.url,
                model: aiProvider.PROVIDER_DEFAULTS.builtin.model,
                visionUrl: '',
                visionModel: '',
                chatModelSupportsVision: false,
              });
            }
          },
        },
      ]
    );
  };

  const handleSelectLocalModel = async (modelId: string) => {
    await localModel.setSelectedModelId(modelId);
    setSelectedLocalModelId(modelId);
    setAiProviderType('local');
    await aiProvider.saveAiConfig({
      type: 'local',
      url: '',
      model: modelId,
      visionUrl: '',
      visionModel: '',
      chatModelSupportsVision: false,
    });
  };

  const handleDeleteOrphanModels = () => {
    if (orphanModels.length === 0) return;
    const totalMb = orphanModels.reduce((s, o) => s + o.sizeBytes, 0) / (1024 * 1024);
    Alert.alert(
      'Șterge modele AI vechi',
      `${orphanModels.length} fișier${orphanModels.length === 1 ? '' : 'e'} (~${totalMb.toFixed(0)} MB) rămase de la versiuni anterioare. Continui?`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            try {
              const { deletedCount, freedBytes } = await localModel.deleteOrphanModels();
              setOrphanModels([]);
              const freedMb = (freedBytes / (1024 * 1024)).toFixed(0);
              Alert.alert(
                'Spațiu eliberat',
                `${deletedCount} fișier${deletedCount === 1 ? '' : 'e'} șterse, ~${freedMb} MB eliberați.`
              );
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Ștergerea a eșuat.');
            }
          },
        },
      ]
    );
  };

  const handleSaveAiConfig = async () => {
    try {
      const isRemote = aiProviderType === 'builtin' || aiProviderType === 'external';
      if (isRemote && !aiModalConsentChecked) {
        Alert.alert('Acord necesar', 'Bifează acordul de utilizare AI pentru a continua.');
        return;
      }
      // Vision provider separat e valid și pentru `local` (chat local + OCR remote),
      // nu doar pentru `external`. Pentru `builtin`/`none` nu are sens (Pixtral
      // built-in are vision implicit; `none` nu rulează nimic).
      const usesSeparateVision =
        (aiProviderType === 'external' || aiProviderType === 'local') && aiSeparateVision;
      await aiProvider.saveAiConfig({
        type: aiProviderType,
        url: aiProviderUrl,
        model: aiProviderModel,
        visionUrl: usesSeparateVision ? aiVisionUrl.trim() : '',
        visionModel: usesSeparateVision ? aiVisionModel.trim() : '',
        chatModelSupportsVision: aiProviderType === 'external' ? aiChatModelSupportsVision : false,
      });
      // Cheile API din SecureStore le modificăm DOAR când userul e activ în
      // modul în care contează — altfel comutarea spre „Dosar AI" ar șterge
      // cheia externă din SecureStore (saveAiApiKey('') = delete). Cheia
      // externă rămâne valabilă chiar dacă userul testează temporar Dosar AI.
      if (aiProviderType === 'external') {
        await aiProvider.saveAiApiKey(aiApiKey);
      }
      if ((aiProviderType === 'external' || aiProviderType === 'local') && usesSeparateVision) {
        await aiProvider.saveAiVisionApiKey(aiVisionApiKey);
      }
      // Snapshot „Cheie proprie" — persistat la fiecare Save indiferent de
      // tipul activ. Dacă userul e pe external, sursa = state-ul curent. Dacă
      // a comutat la builtin/none/local, sursa = ref-ul memorat la tranziție.
      const snapSource =
        aiProviderType === 'external'
          ? {
              url: aiProviderUrl,
              model: aiProviderModel,
              visionUrl: aiVisionUrl.trim(),
              visionModel: aiVisionModel.trim(),
              chatModelSupportsVision: aiChatModelSupportsVision,
            }
          : {
              url: savedExternalRef.current.url,
              model: savedExternalRef.current.model,
              visionUrl: savedExternalRef.current.visionUrl,
              visionModel: savedExternalRef.current.visionModel,
              chatModelSupportsVision: savedExternalRef.current.chatModelSupportsVision,
            };
      await aiProvider.saveExternalChatSnapshot(snapSource);
      // Actualizează ref-ul în memorie cu valorile tocmai salvate, astfel încât
      // următoarea comutare spre „Cheie proprie" în aceeași sesiune să citească
      // sursa de adevăr fără re-mount.
      savedExternalRef.current = {
        ...snapSource,
        apiKey: aiProviderType === 'external' ? aiApiKey : savedExternalRef.current.apiKey,
        visionApiKey:
          (aiProviderType === 'external' || aiProviderType === 'local') && usesSeparateVision
            ? aiVisionApiKey
            : savedExternalRef.current.visionApiKey,
      };
      // Dacă noul provider nu e local, eliberează contextul llama dacă mai e
      // încărcat. Acoperă cazul în care userul a comutat radio-ul prin alte
      // căi (auto-restore, onboarding) fără să treacă prin handleAiProviderSelect.
      if (aiProviderType !== 'local') {
        await localModel.disposeLocalModel().catch(() => {});
      }
      if (isRemote && aiModalConsentChecked) {
        await AsyncStorage.setItem(AI_CONSENT_KEY, 'true');
        setAiConsentGiven(true);
      } else if (aiProviderType === 'local') {
        // Model local: fără transmitere externă, acord implicit
        await AsyncStorage.setItem(AI_CONSENT_KEY, 'true');
        setAiConsentGiven(true);
      } else if (aiProviderType === 'none') {
        const hadConsent = aiConsentGiven;
        await AsyncStorage.removeItem(AI_CONSENT_KEY);
        setAiConsentGiven(false);
        if (hadConsent) {
          Alert.alert(
            'Acord revocat',
            'Consimțământul pentru asistentul AI a fost revocat automat deoarece ai dezactivat asistentul.'
          );
        }
      }
      setAiModalVisible(false);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva configurația');
    }
  };

  /**
   * Trimite un POST minimal către `<url>/chat/completions` cu `messages: [{ user: 'test' }]`
   * și returnează un mesaj scurt de status. Folosit pentru testarea ambelor provider-e
   * (chat și OCR) în `handleTestAiConnection`.
   */
  const probeOpenAiCompatible = async (
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ ok: boolean; message: string }> => {
    if (!url) return { ok: false, message: 'URL lipsă' };
    if (!/^https?:\/\//i.test(url))
      return { ok: false, message: 'URL invalid (trebuie http/https)' };
    if (!apiKey) return { ok: false, message: 'cheie API lipsă' };
    if (!model) return { ok: false, message: 'model lipsă' };

    const baseUrl = url.replace(/\/$/, '');
    const endpoint = `${baseUrl}/chat/completions`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 10,
          temperature: 0.3,
        }),
      });
      if (response.ok) return { ok: true, message: `${model} — conexiune OK` };
      const errText = await response.text().catch(() => '');
      return {
        ok: false,
        message: `Eroare ${response.status}: ${errText.slice(0, 220) || 'răspuns invalid'}`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'eroare rețea' };
    }
  };

  const handleTestAiConnection = async () => {
    setAiTestStatus('loading');
    setAiTestMessage('');
    try {
      if (aiProviderType === 'none') {
        setAiTestStatus('error');
        setAiTestMessage('Selectează un provider AI pentru a testa conexiunea.');
        return;
      }
      if (aiProviderType === 'local') {
        if (!selectedLocalModelId) {
          setAiTestStatus('error');
          setAiTestMessage('Niciun model local selectat. Descarcă și selectează un model.');
          return;
        }
        const lines: string[] = [`✓ Chat: model local „${selectedLocalModelId}" selectat.`];
        if (aiSeparateVision) {
          const ocrResult = await probeOpenAiCompatible(
            aiVisionUrl.trim(),
            aiVisionApiKey.trim(),
            aiVisionModel.trim()
          );
          lines.push(`${ocrResult.ok ? '✓' : '✗'} OCR remote: ${ocrResult.message}`);
          setAiTestStatus(ocrResult.ok ? 'ok' : 'error');
        } else {
          lines.push('• OCR: indisponibil (modelele locale nu duc vision).');
          setAiTestStatus('ok');
        }
        setAiTestMessage(lines.join('\n'));
        return;
      }

      // ─── Test 1: provider chat ────────────────────────────────────────────
      const chatUrl =
        aiProviderType === 'builtin'
          ? aiProvider.PROVIDER_DEFAULTS.builtin.url
          : aiProviderUrl.trim();
      const chatModel =
        aiProviderType === 'builtin'
          ? aiProvider.PROVIDER_DEFAULTS.builtin.model
          : aiProviderModel.trim();
      const chatKey =
        aiProviderType === 'builtin'
          ? (process.env.EXPO_PUBLIC_MISTRAL_API_KEY ?? '')
          : aiApiKey.trim();

      if (aiProviderType === 'builtin' && !chatKey) {
        setAiTestStatus('error');
        setAiTestMessage('Cheia AI inclusă lipsește din build. Folosește „Cheie API proprie".');
        return;
      }

      const chatResult = await probeOpenAiCompatible(chatUrl, chatKey, chatModel);
      const lines: string[] = [`${chatResult.ok ? '✓' : '✗'} Chat: ${chatResult.message}`];

      // ─── Test 2: provider OCR (doar dacă e configurat separat) ────────────
      let ocrOk = true;
      if (aiSeparateVision) {
        const ocrResult = await probeOpenAiCompatible(
          aiVisionUrl.trim(),
          aiVisionApiKey.trim(),
          aiVisionModel.trim()
        );
        ocrOk = ocrResult.ok;
        lines.push(`${ocrResult.ok ? '✓' : '✗'} OCR: ${ocrResult.message}`);

        // Hint specific Anthropic — endpoint-ul lor nativ nu e exact OpenAI-compat
        if (/anthropic\.com/i.test(aiVisionUrl)) {
          lines.push(
            'ℹ Anthropic folosește un layer OpenAI-compatible cu limitări posibile la vision. ' +
              'Dacă OCR cade aici dar cheia e validă, încearcă alt model (claude-sonnet-4-6) sau alt provider.'
          );
        }
      } else {
        lines.push('• OCR: folosește același provider ca chat.');
      }

      const allOk = chatResult.ok && ocrOk;
      setAiTestStatus(allOk ? 'ok' : 'error');
      setAiTestMessage(lines.join('\n'));
    } catch (e) {
      setAiTestStatus('error');
      setAiTestMessage(e instanceof Error ? e.message : 'Eroare de rețea');
    }
  };

  // ── Onboarding ───────────────────────────────────────────────────────────────
  const handleCheckForUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const info = await checkForUpdateForced();
      if (info) {
        Alert.alert(
          'Actualizare disponibilă',
          `Versiunea ${info.version} este disponibilă în App Store.`,
          [
            { text: 'Mai târziu', style: 'cancel' },
            { text: 'Actualizează', onPress: () => openAppStore() },
          ]
        );
      } else {
        Alert.alert('Ești la zi', `Versiunea instalată (${APP_VERSION}) este cea mai recentă.`);
      }
    } catch {
      Alert.alert('Eroare', 'Nu s-a putut verifica disponibilitatea actualizărilor.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleResetOnboarding = () => {
    Alert.alert(
      'Reluare onboarding',
      'Ești sigur? Setările de vizibilitate vor fi resetate la valorile implicite. Documentele și entitățile tale rămân nemodificate.',
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Resetează și reia',
          onPress: async () => {
            try {
              await settings.resetOnboarding();
              DeviceEventEmitter.emit(ONBOARDING_RESET_EVENT);
            } catch (e) {
              Alert.alert(
                'Eroare',
                e instanceof Error ? e.message : 'Nu s-a putut reseta onboarding-ul'
              );
            }
          },
        },
      ]
    );
  };

  // ── GDPR ─────────────────────────────────────────────────────────────────────
  const handleDeleteAllData = () => {
    Alert.alert(
      'Atenție',
      'Vrei să ștergi TOATE datele locale? Aceasta este ireversibilă.\n\nBackup-ul din cloud rămâne intact — îl poți folosi pentru restore.',
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            try {
              // Pune pe pauză cloud backup ca să prevenim un upload de manifest gol
              // care ar suprascrie backup-ul existent din iCloud (last-write-wins).
              // Userul îl reactivează manual după restore.
              await settings.setCloudBackupEnabled(false);

              // Șterge toate datele într-o tranzacție.
              // Păstrăm: app_settings (preferințe UI), cloud_state (device_id + hash
              // pentru sync corect la reactivare), modelele AI descărcate.
              await db.execAsync(`
                BEGIN;
                DELETE FROM document_pages;
                DELETE FROM document_entities;
                DELETE FROM documents;
                DELETE FROM persons;
                DELETE FROM properties;
                DELETE FROM vehicles;
                DELETE FROM cards;
                DELETE FROM animals;
                DELETE FROM companies;
                DELETE FROM custom_document_types;
                DELETE FROM fuel_records;
                DELETE FROM vehicle_maintenance_tasks;
                DELETE FROM chat_messages;
                DELETE FROM chat_threads;
                DELETE FROM entity_order;
                DELETE FROM pending_uploads;
                COMMIT;
              `);

              // Șterge fișierele atașate (poze/PDF-uri documente, foto vehicule).
              const docDir = FileSystem.documentDirectory;
              if (docDir) {
                for (const sub of ['documents', 'vehicles']) {
                  await FileSystem.deleteAsync(`${docDir}${sub}`, { idempotent: true });
                }
              }

              // Notifică hook-urile (useDocuments, useEntities, ...) să dea refresh.
              emit('documents:changed');
              emit('entities:changed');
              emit('customTypes:changed');
              emit('links:changed');
              emit('settings:changed');

              Alert.alert(
                'Date șterse',
                'Toate datele locale au fost șterse. Backup-ul din cloud rămâne disponibil pentru restore.'
              );
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-au putut șterge datele');
            }
          },
        },
      ]
    );
  };

  // ── Contact ──────────────────────────────────────────────────────────────────
  const openEmail = () => {
    const ramMB = Device.totalMemory ? Math.round(Device.totalMemory / 1024 / 1024) : null;
    const ramText = ramMB ? `${ramMB} MB` : 'necunoscut';
    const deviceInfo = [
      `Model: ${Device.modelName ?? 'necunoscut'}`,
      `RAM: ${ramText}`,
      `Tabletă: ${Device.deviceType === 2 ? 'Da' : 'Nu'}`,
      `OS: ${Platform.OS} ${Device.osVersion ?? ''}`.trim(),
      `Dosar: ${APP_VERSION}`,
    ].join('\n');
    const subject = encodeURIComponent(`Suport ${APP_NAME}`);
    const body = encodeURIComponent(
      `Bună ziua,\n\n[Descrie problema ta aici]\n\n---\n${deviceInfo}`
    );
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {
      Alert.alert('Email indisponibil', `Scrieți-ne la: ${CONTACT_EMAIL}`);
    });
  };

  const openSupportUrl = () => {
    Linking.openURL(SUPPORT_URL).catch(() => {
      Alert.alert('Eroare', 'Nu s-a putut deschide pagina.');
    });
  };

  const openPrivacyUrl = () => {
    Linking.openURL(PRIVACY_URL).catch(() => {
      setPrivacyVisible(true);
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        <SecuritateSection
          appLockEnabled={appLockEnabled}
          medicalAppLockEnabled={medicalAppLockEnabled}
          scheme={scheme}
          onToggle={handleAppLockToggle}
          onToggleMedicalLock={async v => {
            await settings.setMedicalAppLockEnabled(v);
            setMedicalAppLockEnabledState(v);
          }}
        />

        <AspectSection
          themePref={themePref}
          collapsed={aspectCollapsed}
          scheme={scheme}
          onToggleCollapsed={() => setAspectCollapsed(v => !v)}
          onSelectPref={setThemePref}
        />

        <NotificariSection
          notifDays={notifDays}
          pushEnabled={pushEnabled}
          showOrphans={showOrphans}
          scheme={scheme}
          onNotifDaysChange={handleNotifDays}
          onPushToggle={handlePushToggle}
          onShowOrphansToggle={handleShowOrphansToggle}
        />

        <VizibilitateEntitatiSection
          visibleEntityTypes={visibleEntityTypes}
          collapsed={entitiesCollapsed}
          scheme={scheme}
          onToggleCollapsed={() => setEntitiesCollapsed(v => !v)}
          onToggleEntityType={handleToggleEntityType}
        />

        <VizibilitateDocTypesSection
          visibleDocTypes={visibleDocTypes}
          customTypes={customTypes}
          collapsed={docTypesCollapsed}
          newTypeName={newTypeName}
          scheme={scheme}
          onToggleCollapsed={() => setDocTypesCollapsed(v => !v)}
          onToggleDocType={handleToggleDocType}
          onChangeNewTypeName={setNewTypeName}
          onAddCustomType={handleAddCustomType}
          onDeleteCustomType={handleDeleteCustomType}
        />

        <BackupSection
          collapsed={backupCollapsed}
          exporting={backupExporting}
          importing={backupImporting}
          scheme={scheme}
          onToggleCollapsed={() => setBackupCollapsed(v => !v)}
          onOpenCloudBackup={() => router.push('/cloud-backup')}
          onExport={handleExportBackup}
          onImport={handleImportBackup}
        />

        <AsistentAiSection
          aiProviderType={aiProviderType}
          aiConsentGiven={aiConsentGiven}
          aiMedicalAllowed={aiMedicalAllowed}
          scheme={scheme}
          onOpenAiModal={() => {
            setAiModalConsentChecked(aiConsentGiven);
            setAiModalVisible(true);
          }}
          onToggleAiMedical={async v => {
            await settings.setAiMedicalAllowed(v);
            setAiMedicalAllowedState(v);
          }}
        />

        <PrivacyGdprSection
          scheme={scheme}
          onShowPrivacy={() => setPrivacyVisible(true)}
          onShowTerms={() => setTermsVisible(true)}
          onDeleteAllData={handleDeleteAllData}
        />

        <ContactSection
          contactEmail={CONTACT_EMAIL}
          supportUrl={SUPPORT_URL}
          scheme={scheme}
          onContact={openEmail}
          onOpenSupport={openSupportUrl}
        />

        <OnboardingSection scheme={scheme} onResetOnboarding={handleResetOnboarding} />

        {lastCrash && (
          <DiagnosticSection
            crash={lastCrash}
            scheme={scheme}
            onCopy={handleCopyCrash}
            onClear={handleClearCrash}
          />
        )}

        <AboutSection
          appName={APP_NAME}
          appVersion={APP_VERSION}
          checkingUpdate={checkingUpdate}
          scheme={scheme}
          onCheckForUpdate={handleCheckForUpdate}
        />

        <RNView style={styles.bottomPad} />
      </ScrollView>

      {/* ── Modal Termeni ── */}
      <LegalModal
        visible={termsVisible}
        title="Termeni și condiții"
        content={TERMS_TEXT}
        onClose={() => setTermsVisible(false)}
        scheme={scheme}
      />

      {/* ── Modal Confidențialitate ── */}
      <LegalModal
        visible={privacyVisible}
        title="Politică de confidențialitate"
        content={PRIVACY_TEXT}
        onClose={() => setPrivacyVisible(false)}
        scheme={scheme}
      />

      <AiConfigModal
        visible={aiModalVisible}
        scheme={scheme}
        providerType={aiProviderType}
        chat={{ url: aiProviderUrl, apiKey: aiApiKey, model: aiProviderModel }}
        chatModelSupportsVision={aiChatModelSupportsVision}
        separateVision={aiSeparateVision}
        vision={{ url: aiVisionUrl, apiKey: aiVisionApiKey, model: aiVisionModel }}
        testStatus={aiTestStatus}
        testMessage={aiTestMessage}
        consentChecked={aiModalConsentChecked}
        compatibleModels={compatibleModels}
        downloadedIds={downloadedModelIds}
        downloadingId={downloadingModelId}
        downloadProgress={downloadProgress}
        downloadedMb={downloadedMb}
        downloadTotalMb={downloadTotalMb}
        selectedLocalModelId={selectedLocalModelId}
        orphanModels={orphanModels}
        onClose={() => setAiModalVisible(false)}
        onSave={handleSaveAiConfig}
        onTest={handleTestAiConnection}
        onConsentToggle={() => setAiModalConsentChecked(v => !v)}
        onProviderSelect={handleAiProviderSelect}
        onChangeChat={patch => {
          if (patch.url !== undefined) setAiProviderUrl(patch.url);
          if (patch.apiKey !== undefined) setAiApiKey(patch.apiKey);
          if (patch.model !== undefined) setAiProviderModel(patch.model);
        }}
        onChangeVision={patch => {
          if (patch.url !== undefined) setAiVisionUrl(patch.url);
          if (patch.apiKey !== undefined) setAiVisionApiKey(patch.apiKey);
          if (patch.model !== undefined) setAiVisionModel(patch.model);
        }}
        onToggleSeparateVision={setAiSeparateVision}
        onToggleChatModelSupportsVision={setAiChatModelSupportsVision}
        onMarkTestStale={() => setAiTestStatus('idle')}
        onSelectLocalModel={handleSelectLocalModel}
        onDownloadModel={handleDownloadModel}
        onDeleteModel={handleDeleteModel}
        onCancelDownload={handleCancelDownload}
        onDeleteOrphanModels={handleDeleteOrphanModels}
        onContactDeveloper={openEmail}
      />

      <AppLockPinModal
        visible={appLockPinModal}
        onDismiss={() => setAppLockPinModal(false)}
        onPinSaved={() => setAppLockEnabled(true)}
      />
    </RNView>
  );
}

// ─── Stiluri ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 40 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 20,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  sectionLabelInline: {
    marginBottom: 0,
    marginTop: 0,
    marginLeft: 0,
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
    marginRight: 4,
  },

  card: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowLabelWrap: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 16 },
  lockHint: { fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 4, paddingHorizontal: 4 },

  versionBadge: {
    fontSize: 12,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },

  inputSmall: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 56,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },

  hint: { fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 12 },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 10,
  },
  btnIcon: { marginRight: 8 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  btnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 6,
  },
  btnOutlineText: { fontSize: 15, fontWeight: '600' },

  customTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  customTypeRowLast: { borderBottomWidth: 0 },
  customTypeName: { fontSize: 15, flex: 1 },

  addTypeRow: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 6 },
  addTypeInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  addTypeBtn: {
    backgroundColor: primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addTypeBtnDisabled: { opacity: 0.35 },
  addTypeBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: primary },
  chipText: { fontSize: 13, fontWeight: '500' },

  bottomPad: { height: 20 },

  // Modal legal
  legalContainer: { flex: 1 },
  legalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legalTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  legalClose: { padding: 4 },
  legalScroll: { flex: 1 },
  legalContent: { padding: 20, paddingBottom: 40 },
  legalText: { fontSize: 14, lineHeight: 22 },

  // Stiluri modal AI
  aiLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  localModelWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  localModelWarningTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  localModelWarningText: {
    fontSize: 13,
    lineHeight: 18,
  },
  aiInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  aiInputReadonly: {
    justifyContent: 'center',
    minHeight: 42,
  },
  aiInputReadonlyText: {
    fontSize: 14,
  },
  aiHint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  aiVisionToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    gap: 12,
  },
  aiVisionToggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  aiVisionGroup: {
    marginTop: 8,
    gap: 12,
  },
  aiVisionGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 0,
  },
  aiRadioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  aiRadioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiRadioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modelCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  modelCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  aiActionBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  aiConsentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  downloadBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  downloadBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  aiToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  aiToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  aiToggleSub: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  aiPrivacyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  aiPrivacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
});
