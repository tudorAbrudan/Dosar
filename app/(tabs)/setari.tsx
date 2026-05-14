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
    AsyncStorage.getItem(AI_CONSENT_KEY).then(v => setAiConsentGiven(v === 'true'));
    aiProvider.getAiConfig().then(cfg => {
      setAiProviderType(cfg.type);
      setAiProviderUrl(cfg.url);
      setAiProviderModel(cfg.model);
      setAiApiKey(cfg.apiKey);
      setAiVisionUrl(cfg.visionUrl);
      setAiVisionModel(cfg.visionModel);
      setAiVisionApiKey(cfg.visionApiKey);
      // Toggle „provider OCR diferit" e pornit dacă oricare din cele 3 câmpuri vision
      // a fost completat anterior; altfel oprit (default = același provider ca chat).
      const hasSeparate =
        cfg.visionUrl.trim() !== '' ||
        cfg.visionModel.trim() !== '' ||
        cfg.visionApiKey.trim() !== '';
      setAiSeparateVision(hasSeparate);
      if (cfg.type === 'external') {
        savedExternalRef.current = {
          url: cfg.url,
          model: cfg.model,
          apiKey: cfg.apiKey,
          visionUrl: cfg.visionUrl,
          visionModel: cfg.visionModel,
          visionApiKey: cfg.visionApiKey,
        };
      }
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
      const hasSeparate =
        savedExternalRef.current.visionUrl.trim() !== '' ||
        savedExternalRef.current.visionModel.trim() !== '' ||
        savedExternalRef.current.visionApiKey.trim() !== '';
      setAiSeparateVision(hasSeparate);
    } else {
      const defaults = aiProvider.PROVIDER_DEFAULTS[type];
      setAiProviderUrl(defaults.url);
      setAiProviderModel(defaults.model);
      setAiVisionUrl('');
      setAiVisionModel('');
      setAiVisionApiKey('');
      setAiSeparateVision(false);
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
      const usesSeparateVision = aiProviderType === 'external' && aiSeparateVision;
      await aiProvider.saveAiConfig({
        type: aiProviderType,
        url: aiProviderUrl,
        model: aiProviderModel,
        visionUrl: usesSeparateVision ? aiVisionUrl.trim() : '',
        visionModel: usesSeparateVision ? aiVisionModel.trim() : '',
      });
      await aiProvider.saveAiApiKey(aiApiKey);
      await aiProvider.saveAiVisionApiKey(usesSeparateVision ? aiVisionApiKey : '');
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
        setAiTestStatus('ok');
        setAiTestMessage(`Model local „${selectedLocalModelId}" selectat.`);
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
      if (aiProviderType === 'external' && aiSeparateVision) {
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
          scheme={scheme}
          onToggle={handleAppLockToggle}
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

        {/* ── Vizibilitate entități ── */}
        <Pressable style={styles.sectionHeader} onPress={() => setEntitiesCollapsed(v => !v)}>
          <RNText
            style={[styles.sectionLabel, styles.sectionLabelInline, { color: C.textSecondary }]}
          >
            ENTITĂȚI ACTIVE
          </RNText>
          <Ionicons
            name={entitiesCollapsed ? 'chevron-down' : 'chevron-up'}
            size={14}
            color={C.textSecondary}
          />
        </Pressable>
        {!entitiesCollapsed && (
          <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
            <RNText style={[styles.hint, { color: C.textSecondary }]}>
              Alege ce tipuri de entități să apară în aplicație. Entitățile dezactivate nu vor
              apărea în formulare sau liste.
            </RNText>
            {ALL_ENTITY_TYPES.map((entityType, idx) => {
              const isActive = visibleEntityTypes.includes(entityType);
              const isLast = idx === ALL_ENTITY_TYPES.length - 1;
              return (
                <RNView
                  key={entityType}
                  style={[isLast ? styles.rowLast : styles.row, { borderBottomColor: C.border }]}
                >
                  <RNView style={styles.rowLeft}>
                    <RNView
                      style={[styles.rowIcon, { backgroundColor: isActive ? '#E8F5E9' : C.border }]}
                    >
                      <RNText style={{ fontSize: 16 }}>{ENTITY_ICONS[entityType]}</RNText>
                    </RNView>
                    <RNText style={[styles.rowLabel, { color: C.text }]}>
                      {ENTITY_LABELS[entityType]}
                    </RNText>
                  </RNView>
                  <Switch
                    value={isActive}
                    onValueChange={() => handleToggleEntityType(entityType)}
                    trackColor={{ false: C.border, true: primary }}
                    thumbColor="#fff"
                  />
                </RNView>
              );
            })}
          </RNView>
        )}

        {/* ── Vizibilitate tipuri documente ── */}
        <Pressable style={styles.sectionHeader} onPress={() => setDocTypesCollapsed(v => !v)}>
          <RNText
            style={[styles.sectionLabel, styles.sectionLabelInline, { color: C.textSecondary }]}
          >
            TIPURI DOCUMENTE ACTIVE
          </RNText>
          <Ionicons
            name={docTypesCollapsed ? 'chevron-down' : 'chevron-up'}
            size={14}
            color={C.textSecondary}
          />
        </Pressable>
        {!docTypesCollapsed && (
          <>
            <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
              <RNText style={[styles.hint, { color: C.textSecondary }]}>
                Alege ce tipuri de documente să apară în lista globală de adăugare. Când adaugi un
                document direct pe o entitate (mașină, casă, persoană…), tipurile relevante pentru
                acea entitate sunt mereu vizibile, indiferent de selecția de aici.
              </RNText>
              <RNView style={styles.chipRow}>
                {STANDARD_DOC_TYPES.map(docType => {
                  const isActive = visibleDocTypes.includes(docType);
                  return (
                    <Pressable
                      key={docType}
                      style={[
                        styles.chip,
                        isActive
                          ? [styles.chipActive, { borderColor: primary }]
                          : { borderColor: C.border },
                      ]}
                      onPress={() => handleToggleDocType(docType)}
                    >
                      <RNText
                        style={[styles.chipText, { color: isActive ? '#fff' : C.textSecondary }]}
                      >
                        {DOCUMENT_TYPE_LABELS[docType]}
                      </RNText>
                    </Pressable>
                  );
                })}
              </RNView>
            </RNView>

            {/* ── Tipuri personalizate de documente ── */}
            <RNText style={[styles.sectionLabel, { color: C.textSecondary, marginTop: 16 }]}>
              TIPURI PERSONALIZATE
            </RNText>
            <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
              <RNText style={[styles.hint, { color: C.textSecondary }]}>
                Adaugă tipuri proprii de documente (ex: „Asigurare viață", „Concediu medical").
                Tipurile de entități (Persoană, Vehicul, Proprietate etc.) sunt fixe și nu pot fi
                modificate.
              </RNText>
              {customTypes.map((ct, idx) => (
                <RNView
                  key={ct.id}
                  style={[
                    styles.customTypeRow,
                    { borderBottomColor: C.border },
                    idx === customTypes.length - 1 && styles.customTypeRowLast,
                  ]}
                >
                  <RNText style={[styles.customTypeName, { color: C.text }]}>{ct.name}</RNText>
                  <Pressable onPress={() => handleDeleteCustomType(ct.id, ct.name)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={statusColors.critical} />
                  </Pressable>
                </RNView>
              ))}
              <RNView style={styles.addTypeRow}>
                <TextInput
                  style={[
                    styles.addTypeInput,
                    { color: C.text, borderColor: C.border, backgroundColor: C.background },
                  ]}
                  placeholder="Nume tip nou (ex: Asigurare viață)"
                  placeholderTextColor={C.textSecondary}
                  value={newTypeName}
                  onChangeText={setNewTypeName}
                  returnKeyType="done"
                  onSubmitEditing={handleAddCustomType}
                />
                <Pressable
                  style={[styles.addTypeBtn, !newTypeName.trim() && styles.addTypeBtnDisabled]}
                  onPress={handleAddCustomType}
                  disabled={!newTypeName.trim()}
                >
                  <RNText style={styles.addTypeBtnText}>Adaugă</RNText>
                </Pressable>
              </RNView>
            </RNView>
          </>
        )}

        {/* ── Backup ── */}
        <Pressable style={styles.sectionHeader} onPress={() => setBackupCollapsed(v => !v)}>
          <RNText
            style={[styles.sectionLabel, styles.sectionLabelInline, { color: C.textSecondary }]}
          >
            BACKUP ȘI RESTAURARE
          </RNText>
          <Ionicons
            name={backupCollapsed ? 'chevron-down' : 'chevron-up'}
            size={14}
            color={C.textSecondary}
          />
        </Pressable>
        {!backupCollapsed && (
          <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
            <InfoRow
              icon="cloud-outline"
              iconBg="#E8F5E9"
              iconColor={primary}
              label="iCloud Backup"
              sub="Backup automat în iCloud Drive"
              onPress={() => router.push('/cloud-backup')}
              scheme={scheme}
            />
            <RNText style={[styles.hint, { color: C.textSecondary }]}>
              Exportă toate datele și pozele ca fișier ZIP și salvează-l în iCloud Drive sau Files.
              La schimbarea telefonului, importă fișierul pentru a restaura complet datele și
              pozele.
            </RNText>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                { opacity: pressed || backupExporting ? 0.85 : 1 },
              ]}
              onPress={handleExportBackup}
              disabled={backupExporting}
            >
              {backupExporting ? (
                <ActivityIndicator size="small" color="#fff" style={styles.btnIcon} />
              ) : (
                <Ionicons
                  name="cloud-upload-outline"
                  size={18}
                  color="#fff"
                  style={styles.btnIcon}
                />
              )}
              <RNText style={styles.btnText}>
                {backupExporting ? 'Se exportă...' : 'Exportă backup (ZIP)'}
              </RNText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btnOutline,
                { borderColor: primary, opacity: pressed || backupImporting ? 0.85 : 1 },
              ]}
              onPress={handleImportBackup}
              disabled={backupImporting}
            >
              {backupImporting ? (
                <ActivityIndicator size="small" color={primary} style={styles.btnIcon} />
              ) : (
                <Ionicons
                  name="cloud-download-outline"
                  size={18}
                  color={primary}
                  style={styles.btnIcon}
                />
              )}
              <RNText style={[styles.btnOutlineText, { color: primary }]}>
                {backupImporting ? 'Se importă...' : 'Importă din fișier backup'}
              </RNText>
            </Pressable>
          </RNView>
        )}

        <AsistentAiSection
          aiProviderType={aiProviderType}
          aiConsentGiven={aiConsentGiven}
          scheme={scheme}
          onOpenAiModal={() => {
            setAiModalConsentChecked(aiConsentGiven);
            setAiModalVisible(true);
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

      {/* ── Modal configurare AI ── */}
      <Modal
        visible={aiModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAiModalVisible(false)}
      >
        <RNView style={[styles.legalContainer, { backgroundColor: C.background }]}>
          <RNView
            style={[styles.legalHeader, { backgroundColor: C.card, borderBottomColor: C.border }]}
          >
            <RNText style={[styles.legalTitle, { color: C.text }]}>Configurare Asistent AI</RNText>
            <Pressable
              onPress={() => setAiModalVisible(false)}
              hitSlop={12}
              style={styles.legalClose}
            >
              <Ionicons name="close" size={22} color={C.textSecondary} />
            </Pressable>
          </RNView>

          {/* Salvează + Testează — fixate sub header, vizibile fără scroll */}
          <RNView
            style={[
              styles.aiActionBar,
              { backgroundColor: C.background, borderBottomColor: C.border },
            ]}
          >
            <Pressable
              style={({ pressed }) => [styles.btn, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleSaveAiConfig}
            >
              <Ionicons name="save-outline" size={18} color="#fff" style={styles.btnIcon} />
              <RNText style={styles.btnText}>Salvează</RNText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btnOutline,
                {
                  flex: 1,
                  borderColor:
                    aiTestStatus === 'error'
                      ? statusColors.critical
                      : aiTestStatus === 'ok'
                        ? statusColors.ok
                        : primary,
                  opacity: pressed || aiTestStatus === 'loading' ? 0.7 : 1,
                },
              ]}
              onPress={handleTestAiConnection}
              disabled={aiTestStatus === 'loading'}
            >
              <Ionicons
                name={
                  aiTestStatus === 'ok'
                    ? 'checkmark-circle-outline'
                    : aiTestStatus === 'error'
                      ? 'close-circle-outline'
                      : 'wifi-outline'
                }
                size={18}
                color={
                  aiTestStatus === 'ok'
                    ? statusColors.ok
                    : aiTestStatus === 'error'
                      ? statusColors.critical
                      : primary
                }
                style={styles.btnIcon}
              />
              <RNText
                style={[
                  styles.btnOutlineText,
                  {
                    color:
                      aiTestStatus === 'ok'
                        ? statusColors.ok
                        : aiTestStatus === 'error'
                          ? statusColors.critical
                          : primary,
                  },
                ]}
              >
                {aiTestStatus === 'loading'
                  ? 'Se testează…'
                  : aiTestStatus === 'ok'
                    ? 'Conexiune OK'
                    : aiTestStatus === 'error'
                      ? 'Eroare'
                      : 'Testează'}
              </RNText>
            </Pressable>
          </RNView>

          {/* Acord utilizare AI — fix sub action bar, vizibil fără scroll */}
          {(aiProviderType === 'builtin' || aiProviderType === 'external') && (
            <Pressable
              style={[
                styles.aiConsentBar,
                {
                  backgroundColor: C.card,
                  borderBottomColor: C.border,
                  borderTopColor: aiModalConsentChecked ? primary : C.border,
                },
              ]}
              onPress={() => setAiModalConsentChecked(v => !v)}
            >
              <RNView
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  borderWidth: 2,
                  borderColor: aiModalConsentChecked ? primary : C.border,
                  backgroundColor: aiModalConsentChecked ? primary : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {aiModalConsentChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
              </RNView>
              <RNView style={{ flex: 1 }}>
                <RNText style={[styles.aiToggleLabel, { color: C.text, fontSize: 13 }]}>
                  {aiProviderType === 'builtin'
                    ? 'Sunt de acord cu trimiterea datelor la serviciul Dosar AI'
                    : 'Sunt de acord cu trimiterea datelor la serviciul AI configurat'}
                </RNText>
                <RNText style={[styles.aiToggleSub, { color: C.textSecondary, fontSize: 11 }]}>
                  Acoperă: text OCR, entități, detalii documente, chat. PIN-ul nu este niciodată
                  trimis.
                </RNText>
              </RNView>
            </Pressable>
          )}

          <ScrollView
            style={styles.legalScroll}
            contentContainerStyle={[styles.legalContent, { gap: 20 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
          >
            {/* Info: ce date se trimit la AI (mirror OCR_PRIVACY onboarding) */}
            {(aiProviderType === 'builtin' || aiProviderType === 'external') && (
              <RNView
                style={[styles.aiPrivacyCard, { backgroundColor: C.card, borderColor: C.border }]}
              >
                <RNView style={styles.aiPrivacyRow}>
                  <Ionicons
                    name="image-outline"
                    size={18}
                    color="#F57F17"
                    style={{ marginTop: 2 }}
                  />
                  <RNView style={{ flex: 1 }}>
                    <RNText style={[styles.aiToggleLabel, { color: C.text }]}>
                      Trimitere imagine/document la AI
                    </RNText>
                    <RNText style={[styles.aiToggleSub, { color: C.textSecondary, marginTop: 2 }]}>
                      Doar la apăsarea butonului „Trimite documentul la AI" din formularul
                      documentului — niciodată automat.
                    </RNText>
                  </RNView>
                </RNView>
                <RNView style={styles.aiPrivacyRow}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={primary}
                    style={{ marginTop: 2 }}
                  />
                  <RNView style={{ flex: 1 }}>
                    <RNText style={[styles.aiToggleLabel, { color: C.text }]}>
                      Câmpul „Notă privată" nu pleacă niciodată la AI
                    </RNText>
                    <RNText style={[styles.aiToggleSub, { color: C.textSecondary, marginTop: 2 }]}>
                      Folosește-l pentru date strict sensibile (CVV, PIN, parole). E separat de
                      câmpul „Notă" normal.
                    </RNText>
                  </RNView>
                </RNView>
              </RNView>
            )}

            {/* Selector AI unificat */}
            <RNView>
              <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>
                Configurare asistent AI
              </RNText>
              {(['none', 'builtin', 'external'] as AiProviderType[]).map(type => (
                <Pressable
                  key={type}
                  style={[
                    styles.aiRadioRow,
                    {
                      borderColor: aiProviderType === type ? primary : C.border,
                      backgroundColor: C.card,
                    },
                  ]}
                  onPress={() => handleAiProviderSelect(type)}
                >
                  <RNView
                    style={[
                      styles.aiRadioDot,
                      { borderColor: aiProviderType === type ? primary : C.border },
                    ]}
                  >
                    {aiProviderType === type && (
                      <RNView style={[styles.aiRadioDotInner, { backgroundColor: primary }]} />
                    )}
                  </RNView>
                  <RNText style={[styles.chipText, { color: C.text, flex: 1 }]}>
                    {aiProvider.PROVIDER_DEFAULTS[type].label}
                  </RNText>
                </Pressable>
              ))}
              {/* Câmpuri pentru external — inline sub selecție */}
              {aiProviderType === 'external' && (
                <RNView style={{ gap: 12, marginTop: 8 }}>
                  <RNView>
                    <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>URL API</RNText>
                    <TextInput
                      style={[
                        styles.aiInput,
                        { color: C.text, borderColor: C.border, backgroundColor: C.card },
                      ]}
                      value={aiProviderUrl}
                      onChangeText={text => {
                        setAiProviderUrl(text);
                        setAiTestStatus('idle');
                      }}
                      placeholder="ex: https://api.mistral.ai/v1"
                      placeholderTextColor={C.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                    />
                  </RNView>
                  <RNView>
                    <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>Cheie API</RNText>
                    <TextInput
                      style={[
                        styles.aiInput,
                        { color: C.text, borderColor: C.border, backgroundColor: C.card },
                      ]}
                      value={aiApiKey}
                      onChangeText={text => {
                        setAiApiKey(text);
                        setAiTestStatus('idle');
                      }}
                      placeholder="••••••••••"
                      placeholderTextColor={C.textSecondary}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </RNView>
                  <RNView>
                    <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>Model chat</RNText>
                    <TextInput
                      style={[
                        styles.aiInput,
                        { color: C.text, borderColor: C.border, backgroundColor: C.card },
                      ]}
                      value={aiProviderModel}
                      onChangeText={text => {
                        setAiProviderModel(text);
                        setAiTestStatus('idle');
                      }}
                      placeholder="ex: mistral-small-latest"
                      placeholderTextColor={C.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </RNView>
                  <Pressable
                    style={[
                      styles.aiVisionToggleRow,
                      { borderColor: C.border, backgroundColor: C.card },
                    ]}
                    onPress={() => {
                      setAiSeparateVision(v => !v);
                      setAiTestStatus('idle');
                    }}
                  >
                    <RNView style={{ flex: 1, backgroundColor: 'transparent' }}>
                      <RNText style={[styles.aiVisionToggleTitle, { color: C.text }]}>
                        Provider OCR diferit
                      </RNText>
                      <RNText style={[styles.aiHint, { color: C.textSecondary }]}>
                        {aiSeparateVision
                          ? 'OCR / vision folosește alt provider decât chat-ul.'
                          : 'OCR și chat folosesc același provider (de mai sus).'}
                      </RNText>
                    </RNView>
                    <Switch
                      value={aiSeparateVision}
                      onValueChange={v => {
                        setAiSeparateVision(v);
                        setAiTestStatus('idle');
                      }}
                      trackColor={{ false: C.border, true: primary }}
                    />
                  </Pressable>
                  {aiSeparateVision && (
                    <RNView style={styles.aiVisionGroup}>
                      <RNText style={[styles.aiVisionGroupTitle, { color: C.textSecondary }]}>
                        Provider OCR / vision
                      </RNText>
                      <RNView>
                        <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>URL</RNText>
                        <TextInput
                          style={[
                            styles.aiInput,
                            { color: C.text, borderColor: C.border, backgroundColor: C.card },
                          ]}
                          value={aiVisionUrl}
                          onChangeText={text => {
                            setAiVisionUrl(text);
                            setAiTestStatus('idle');
                          }}
                          placeholder="ex: https://api.anthropic.com/v1"
                          placeholderTextColor={C.textSecondary}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                        />
                      </RNView>
                      <RNView>
                        <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>
                          Cheie API
                        </RNText>
                        <TextInput
                          style={[
                            styles.aiInput,
                            { color: C.text, borderColor: C.border, backgroundColor: C.card },
                          ]}
                          value={aiVisionApiKey}
                          onChangeText={text => {
                            setAiVisionApiKey(text);
                            setAiTestStatus('idle');
                          }}
                          placeholder="••••••••••"
                          placeholderTextColor={C.textSecondary}
                          secureTextEntry
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </RNView>
                      <RNView>
                        <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>Model</RNText>
                        <TextInput
                          style={[
                            styles.aiInput,
                            { color: C.text, borderColor: C.border, backgroundColor: C.card },
                          ]}
                          value={aiVisionModel}
                          onChangeText={text => {
                            setAiVisionModel(text);
                            setAiTestStatus('idle');
                          }}
                          placeholder="ex: claude-haiku-4-5"
                          placeholderTextColor={C.textSecondary}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <RNText style={[styles.aiHint, { color: C.textSecondary, marginTop: 4 }]}>
                          Modelul TREBUIE să suporte imagini (vision). Recomandat:{' '}
                          <RNText style={{ fontWeight: '600' }}>claude-haiku-4-5</RNText> sau{' '}
                          <RNText style={{ fontWeight: '600' }}>claude-sonnet-4-6</RNText>{' '}
                          (Anthropic, $5 credit gratuit la cont nou),{' '}
                          <RNText style={{ fontWeight: '600' }}>gpt-4o</RNText> (OpenAI),{' '}
                          <RNText style={{ fontWeight: '600' }}>pixtral-large-latest</RNText>{' '}
                          (Mistral, plătit) sau{' '}
                          <RNText style={{ fontWeight: '600' }}>pixtral-12b-2409</RNText> (Mistral,
                          free tier).
                        </RNText>
                      </RNView>
                    </RNView>
                  )}
                </RNView>
              )}
              {downloadedModelIds.length > 0 && (
                <>
                  <RNText style={[styles.aiLabel, { color: C.textSecondary, marginTop: 8 }]}>
                    Modele locale instalate
                  </RNText>
                  {downloadedModelIds.map(modelId => {
                    const model = compatibleModels.find(m => m.id === modelId);
                    if (!model) return null;
                    const isSelected =
                      aiProviderType === 'local' && selectedLocalModelId === modelId;
                    return (
                      <Pressable
                        key={modelId}
                        style={[
                          styles.aiRadioRow,
                          { borderColor: isSelected ? primary : C.border, backgroundColor: C.card },
                        ]}
                        onPress={() => handleSelectLocalModel(modelId)}
                      >
                        <RNView
                          style={[
                            styles.aiRadioDot,
                            { borderColor: isSelected ? primary : C.border },
                          ]}
                        >
                          {isSelected && (
                            <RNView
                              style={[styles.aiRadioDotInner, { backgroundColor: primary }]}
                            />
                          )}
                        </RNView>
                        <RNView style={{ flex: 1 }}>
                          <RNText style={[styles.chipText, { color: C.text }]}>{model.name}</RNText>
                          <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>
                            {'★'.repeat(model.qualityStars)} · {model.sizeLabel}
                          </RNText>
                        </RNView>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </RNView>

            {/* Avertisment model local */}
            {aiProviderType === 'local' && (
              <RNView
                style={[
                  styles.localModelWarning,
                  { backgroundColor: '#FFF8E1', borderColor: '#F9A825' },
                ]}
              >
                <Ionicons
                  name="flask-outline"
                  size={16}
                  color="#F57F17"
                  style={{ marginRight: 6, marginTop: 1 }}
                />
                <RNView style={{ flex: 1 }}>
                  <RNText style={[styles.localModelWarningTitle, { color: '#E65100' }]}>
                    Model local – în testare
                  </RNText>
                  <RNText style={[styles.localModelWarningText, { color: '#6D4C41' }]}>
                    Modelele locale pot produce răspunsuri incorecte (halucinații). Dacă observi
                    erori, te rugăm să contactezi dezvoltatorul.{' '}
                    <RNText
                      style={{ color: primary, textDecorationLine: 'underline' }}
                      onPress={openEmail}
                    >
                      Trimite email
                    </RNText>
                  </RNText>
                </RNView>
              </RNView>
            )}

            {/* Catalog modele locale */}
            {compatibleModels.length > 0 && (
              <RNView>
                <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>
                  Modele disponibile
                </RNText>
                {compatibleModels.map(model => {
                  const isDownloaded = downloadedModelIds.includes(model.id);
                  const isDownloading = downloadingModelId === model.id;
                  const incompatible = model.incompatibilityReason !== null;
                  return (
                    <RNView
                      key={model.id}
                      style={[
                        styles.modelCard,
                        {
                          backgroundColor: C.card,
                          borderColor: C.border,
                          opacity: incompatible ? 0.6 : 1,
                        },
                      ]}
                    >
                      <RNView style={styles.modelCardHeader}>
                        <RNView style={{ flex: 1 }}>
                          <RNText style={[styles.aiToggleLabel, { color: C.text }]}>
                            {model.name}
                          </RNText>
                          <RNText
                            style={[styles.aiLabel, { color: C.textSecondary, marginTop: 2 }]}
                          >
                            {'★'.repeat(model.qualityStars)}
                            {'☆'.repeat(5 - model.qualityStars)} · {model.sizeLabel}
                          </RNText>
                        </RNView>
                        {isDownloaded && !isDownloading && (
                          <Pressable onPress={() => handleDeleteModel(model.id)} hitSlop={8}>
                            <RNText style={[styles.aiLabel, { color: statusColors.critical }]}>
                              Șterge
                            </RNText>
                          </Pressable>
                        )}
                        {!isDownloaded && !isDownloading && incompatible && (
                          <RNView style={[styles.downloadBtn, { backgroundColor: C.border }]}>
                            <RNText style={[styles.downloadBtnText, { color: C.textSecondary }]}>
                              Incompatibil
                            </RNText>
                          </RNView>
                        )}
                        {!isDownloaded && !isDownloading && !incompatible && (
                          <Pressable
                            onPress={() => handleDownloadModel(model.id)}
                            style={[styles.downloadBtn, { backgroundColor: primary }]}
                          >
                            <RNText style={styles.downloadBtnText}>Descarcă</RNText>
                          </Pressable>
                        )}
                      </RNView>
                      <RNText style={[styles.aiToggleSub, { color: C.textSecondary }]}>
                        {model.description}
                      </RNText>
                      {isDownloading && (
                        <RNView style={{ marginTop: 8 }}>
                          <RNView style={[styles.progressBar, { backgroundColor: C.border }]}>
                            <RNView
                              style={[
                                styles.progressFill,
                                {
                                  backgroundColor: primary,
                                  width: `${Math.round(downloadProgress * 100)}%` as `${number}%`,
                                },
                              ]}
                            />
                          </RNView>
                          <RNText
                            style={[styles.aiLabel, { color: C.textSecondary, marginTop: 4 }]}
                          >
                            {Math.round(downloadedMb)}MB / {Math.round(downloadTotalMb)}MB (
                            {Math.round(downloadProgress * 100)}%)
                          </RNText>
                          <Pressable onPress={handleCancelDownload} style={{ marginTop: 4 }}>
                            <RNText style={[styles.aiLabel, { color: statusColors.critical }]}>
                              Anulează
                            </RNText>
                          </Pressable>
                        </RNView>
                      )}
                      {incompatible && (
                        <RNText
                          style={[styles.aiLabel, { color: statusColors.warning, marginTop: 4 }]}
                        >
                          ⚠ Incompatibil: {model.incompatibilityReason}
                        </RNText>
                      )}
                      {isDownloaded && !isDownloading && (
                        <RNText style={[styles.aiLabel, { color: statusColors.ok, marginTop: 4 }]}>
                          ✓ Instalat
                        </RNText>
                      )}
                    </RNView>
                  );
                })}
              </RNView>
            )}

            {/* Banner modele AI orphan (rămase de la versiuni vechi) */}
            {orphanModels.length > 0 && (
              <RNView
                style={[
                  styles.modelCard,
                  {
                    backgroundColor: C.card,
                    borderColor: statusColors.warning,
                    marginTop: 12,
                  },
                ]}
              >
                <RNView style={styles.modelCardHeader}>
                  <RNView style={{ flex: 1 }}>
                    <RNText style={[styles.aiToggleLabel, { color: C.text }]}>
                      Modele AI vechi
                    </RNText>
                    <RNText style={[styles.aiToggleSub, { color: C.textSecondary, marginTop: 2 }]}>
                      {orphanModels.length} fișier{orphanModels.length === 1 ? '' : 'e'} (~
                      {Math.round(
                        orphanModels.reduce((s, o) => s + o.sizeBytes, 0) / (1024 * 1024)
                      )}{' '}
                      MB) rămase de la versiuni anterioare. Nu mai sunt folosite.
                    </RNText>
                  </RNView>
                  <Pressable
                    onPress={handleDeleteOrphanModels}
                    style={[styles.downloadBtn, { backgroundColor: statusColors.critical }]}
                  >
                    <RNText style={styles.downloadBtnText}>Eliberează</RNText>
                  </Pressable>
                </RNView>
              </RNView>
            )}

            {/* Descriere builtin */}
            {aiProviderType === 'builtin' && (
              <RNView
                style={[
                  styles.aiInput,
                  styles.aiInputReadonly,
                  {
                    borderColor: C.border,
                    backgroundColor: C.background,
                    flexDirection: 'column',
                    height: 'auto',
                    paddingVertical: 12,
                  },
                ]}
              >
                <RNText
                  style={[styles.aiInputReadonlyText, { color: C.textSecondary, lineHeight: 20 }]}
                >
                  Utilizează serviciul AI inclus în aplicație. Nu este necesară o cheie API
                  personală.
                </RNText>
              </RNView>
            )}

            {aiTestMessage ? (
              <RNText
                style={[
                  styles.aiHint,
                  { color: aiTestStatus === 'error' ? statusColors.critical : statusColors.ok },
                ]}
              >
                {aiTestMessage}
              </RNText>
            ) : null}
          </ScrollView>
        </RNView>
      </Modal>

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
