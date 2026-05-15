import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Platform, Linking, Alert, Modal } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import AppLockPinModal from '@/components/AppLockPinModal';
import { OnboardingHeader } from '@/components/onboarding/OnboardingHeader';
import { OnboardingFooter } from '@/components/onboarding/OnboardingFooter';
import { AiStep } from '@/components/onboarding/AiStep';
import { AppearanceStep } from '@/components/onboarding/AppearanceStep';
import { BackupStep } from '@/components/onboarding/BackupStep';
import { CloudBackupStep } from '@/components/onboarding/CloudBackupStep';
import { DocsStep } from '@/components/onboarding/DocsStep';
import { EntitiesStep } from '@/components/onboarding/EntitiesStep';
import { NotificationsStep } from '@/components/onboarding/NotificationsStep';
import { SecurityStep } from '@/components/onboarding/SecurityStep';
import { SummaryStep } from '@/components/onboarding/SummaryStep';
import { VehicleMgmtStep } from '@/components/onboarding/VehicleMgmtStep';
import { WelcomeStep } from '@/components/onboarding/WelcomeStep';
import { ALL_ENTITY_TYPES, DEFAULT_VISIBLE_DOC_TYPES, ENTITY_DOCUMENT_TYPES } from '@/types';
import type { EntityType, DocumentType } from '@/types';
import * as settings from '@/services/settings';
import * as aiProvider from '@/services/aiProvider';
import type { AiProviderType } from '@/services/aiProvider';
import { AI_CONSENT_KEY } from '@/services/aiProvider';
import {
  requestNotificationPermission,
  scheduleExpirationReminders,
} from '@/services/notifications';
import * as cloudStorage from '@/services/cloudStorage';
import * as cloudSync from '@/services/cloudSync';
import type { RestoreProgress } from '@/services/cloudSync';
import { CloudRestoreProgress } from '@/components/CloudRestoreProgress';
import { useThemePreference } from '@/hooks/useThemeScheme';

const WELCOME = 0;
const APPEARANCE = 1;
const SECURITY = 2;
const ENTITIES = 3;
const VEHICLE_MGMT = 4;
const DOCS = 5;
const NOTIFICATIONS = 6;
const BACKUP = 7;
const CLOUD_BACKUP = 8;
const AI_STEP = 9;
const SUMMARY = 10;

interface Props {
  onComplete: () => void;
}

function stepTitle(step: number): string {
  switch (step) {
    case WELCOME:
      return 'Bun venit';
    case APPEARANCE:
      return 'Aspect';
    case SECURITY:
      return 'Securitate';
    case ENTITIES:
      return 'Ce vei gestiona?';
    case VEHICLE_MGMT:
      return 'Gestiune auto';
    case DOCS:
      return 'Ce documente te interesează?';
    case NOTIFICATIONS:
      return 'Notificări expirări';
    case BACKUP:
      return 'Backup';
    case CLOUD_BACKUP:
      return 'Backup automat';
    case AI_STEP:
      return 'Asistent AI';
    case SUMMARY:
      return 'Rezumat';
    default:
      return '';
  }
}

function stepSubtitle(step: number): string {
  switch (step) {
    case WELCOME:
      return 'Iată ce trebuie să știi înainte să începi.';
    case APPEARANCE:
      return 'Alege cum arată aplicația. Poți schimba oricând din Setări.';
    case SECURITY:
      return 'Câteva recomandări pentru datele tale sensibile.';
    case ENTITIES:
      return 'Alege tipurile de entități pe care le vei folosi. Poți schimba oricând din Setări.';
    case VEHICLE_MGMT:
      return 'Talon, RCA, ITP, alimentări, statistici de consum — într-un singur loc.';
    case DOCS:
      return 'Am preselectat documentele aferente entităților alese. Aici alegi doar lista globală — când adaugi un document direct pe o entitate, toate tipurile relevante apar oricum.';
    case NOTIFICATIONS:
      return 'Primești remindere locale pe telefon — fără server, fără cont online.';
    case BACKUP:
      return 'Exportul periodic (fișier ZIP) îți protejează datele la schimbare de telefon sau reinstalare.';
    case CLOUD_BACKUP:
      return 'Salvare automată în iCloud-ul tău. Datele rămân la tine — Apple le păstrează în contul tău.';
    case AI_STEP:
      return 'Complet opțional. Datele tale rămân pe dispozitiv — AI-ul e activat doar când îl folosești.';
    case SUMMARY:
      return 'Verifică setările. Poți modifica totul din Setări oricând.';
    default:
      return '';
  }
}

export default function OnboardingWizard({ onComplete }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { preference: themePref, setPreference: setThemePref } = useThemePreference();

  const [step, setStep] = useState(WELCOME);
  const [selectedEntities, setSelectedEntities] = useState<EntityType[]>([...ALL_ENTITY_TYPES]);
  const [selectedDocTypes, setSelectedDocTypes] = useState<DocumentType[]>([
    ...DEFAULT_VISIBLE_DOC_TYPES,
  ]);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [notifDays, setNotifDays] = useState(7);
  const [notifPermStatus, setNotifPermStatus] = useState<'undetermined' | 'granted' | 'denied'>(
    'undetermined'
  );
  const [lockEnabled, setLockEnabled] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [aiProviderChoice, setAiProviderChoice] = useState<AiProviderType>('builtin');
  const [aiExternalUrl, setAiExternalUrl] = useState('');
  const [aiExternalApiKey, setAiExternalApiKey] = useState('');
  const [aiExternalModel, setAiExternalModel] = useState('');
  const [aiConsentChecked, setAiConsentChecked] = useState(false);

  type CloudCheck =
    | { status: 'checking' }
    | { status: 'available'; meta: { count: number; date: string } | null }
    | { status: 'unavailable' };

  const [cloudCheck, setCloudCheck] = useState<CloudCheck>({ status: 'checking' });
  const [cloudOptIn, setCloudOptIn] = useState(true);
  const [cloudRestoring, setCloudRestoring] = useState(false);
  const [cloudRestoreProgress, setCloudRestoreProgress] = useState<RestoreProgress | null>(null);

  // Lista de pași activi (VEHICLE_MGMT apare doar dacă utilizatorul a ales vehicul).
  const activeSteps: number[] = [
    WELCOME,
    APPEARANCE,
    SECURITY,
    ENTITIES,
    ...(selectedEntities.includes('vehicle') ? [VEHICLE_MGMT] : []),
    DOCS,
    NOTIFICATIONS,
    BACKUP,
    CLOUD_BACKUP,
    AI_STEP,
    SUMMARY,
  ];
  const currentIdx = Math.max(0, activeSteps.indexOf(step));
  const totalActive = activeSteps.length;

  useEffect(() => {
    settings.getPushEnabled().then(setPushEnabled);
    settings.getNotificationDays().then(d => {
      setNotifDays(d === 7 || d === 14 || d === 30 ? d : 7);
    });
    settings.getAppLockEnabled().then(setLockEnabled);
    if (Platform.OS !== 'web') {
      Notifications.getPermissionsAsync().then(({ status }) => {
        if (status === 'granted') setNotifPermStatus('granted');
        else if (status === 'denied') setNotifPermStatus('denied');
        else setNotifPermStatus('undetermined');
      });
    }

    let cancelled = false;
    (async () => {
      try {
        const ok = await cloudStorage.isAvailable();
        if (cancelled) return;
        if (!ok) {
          setCloudCheck({ status: 'unavailable' });
          return;
        }
        const meta = await cloudSync.readCloudMeta();
        if (cancelled) return;
        setCloudCheck({
          status: 'available',
          meta: meta
            ? {
                count: meta.documentCount,
                date: new Date(meta.uploadedAt).toLocaleDateString('ro-RO'),
              }
            : null,
        });
      } catch {
        if (!cancelled) setCloudCheck({ status: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleEntity(entityType: EntityType) {
    setSelectedEntities(prev => {
      const isSelected = prev.includes(entityType);
      if (isSelected && prev.length <= 1) return prev;
      return isSelected ? prev.filter(e => e !== entityType) : [...prev, entityType];
    });
  }

  function toggleDocType(docType: DocumentType) {
    setSelectedDocTypes(prev => {
      const isSelected = prev.includes(docType);
      if (isSelected && prev.length <= 1) return prev;
      return isSelected ? prev.filter(d => d !== docType) : [...prev, docType];
    });
  }

  async function handlePushSwitchToggle(value: boolean) {
    if (!value) {
      setPushEnabled(false);
      return;
    }
    if (notifPermStatus === 'granted') {
      setPushEnabled(true);
      return;
    }
    if (notifPermStatus === 'denied') {
      Alert.alert(
        'Notificări blocate',
        'Ai refuzat anterior permisiunea. Activează notificările din Setări sistem.',
        [
          { text: 'Nu acum', style: 'cancel' },
          { text: 'Deschide Setări', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    const granted = await requestNotificationPermission();
    if (granted) {
      setNotifPermStatus('granted');
      setPushEnabled(true);
    } else {
      setNotifPermStatus('denied');
    }
  }

  async function goNextFromNotifications() {
    await settings.setPushEnabled(pushEnabled);
    await settings.setNotificationDays(notifDays);
    await scheduleExpirationReminders();
    gotoNextActive();
  }

  async function goNextFromCloudBackup() {
    if (cloudCheck.status === 'available') {
      // Variant A: persistă alegerea utilizatorului. Variant B (skip restore): tot
      // activăm backup-ul ca să nu pierdem fișierele viitoare.
      const enable = cloudCheck.meta ? true : cloudOptIn;
      await settings.setCloudBackupEnabled(enable);
    }
    // Variant C (unavailable): nimic de persistat — defaultul OFF rămâne.
    gotoNextActive();
  }

  async function handleCloudRestore() {
    if (cloudCheck.status !== 'available' || !cloudCheck.meta) return;
    setCloudRestoring(true);
    setCloudRestoreProgress({
      phase: 'manifest',
      current: 0,
      total: 0,
      bytesDone: 0,
      bytesTotal: 0,
    });
    try {
      await settings.setCloudBackupEnabled(true);
      await cloudSync.restoreFromCloud(p => setCloudRestoreProgress(p));
      setCloudRestoring(false);
      setCloudRestoreProgress(null);
      gotoNextActive();
    } catch (e) {
      setCloudRestoring(false);
      setCloudRestoreProgress(null);
      Alert.alert('Eroare la restaurare', e instanceof Error ? e.message : 'Eroare necunoscută');
    }
  }

  async function handleComplete() {
    await settings.setVisibleEntityTypes(selectedEntities);
    await settings.setVisibleDocTypes(selectedDocTypes);
    await settings.setPushEnabled(pushEnabled);
    await settings.setNotificationDays(notifDays);
    await scheduleExpirationReminders();

    const isRemote = aiProviderChoice === 'builtin' || aiProviderChoice === 'external';
    // Local: fără transmitere externă, acord implicit; none: fără AI
    const consentValue =
      (isRemote && aiConsentChecked) || aiProviderChoice === 'local' ? 'true' : 'false';
    await AsyncStorage.setItem(AI_CONSENT_KEY, consentValue);
    await aiProvider.saveAiConfig({
      type: aiProviderChoice,
      url:
        aiProviderChoice === 'external'
          ? aiExternalUrl
          : (aiProvider.PROVIDER_DEFAULTS[aiProviderChoice]?.url ?? ''),
      model:
        aiProviderChoice === 'external'
          ? aiExternalModel
          : (aiProvider.PROVIDER_DEFAULTS[aiProviderChoice]?.model ?? ''),
      // Onboarding nu cere provider OCR separat — userul îl poate configura din
      // Setări → AI după onboarding. Toate goale = fallback la provider-ul de chat
      // pentru cereri vision.
      visionUrl: '',
      visionModel: '',
    });
    if (aiProviderChoice === 'external') {
      await aiProvider.saveAiApiKey(aiExternalApiKey);
    }
    await settings.setOnboardingDone();
    onComplete();
  }

  const canProceedFromAiStep = (): boolean => {
    if (step !== AI_STEP) return true;
    const isRemote = aiProviderChoice === 'builtin' || aiProviderChoice === 'external';
    if (isRemote && !aiConsentChecked) return false;
    if (
      aiProviderChoice === 'external' &&
      (!aiExternalUrl.trim() || !aiExternalApiKey.trim() || !aiExternalModel.trim())
    )
      return false;
    return true;
  };

  function gotoNextActive() {
    const idx = activeSteps.indexOf(step);
    if (idx < 0 || idx >= activeSteps.length - 1) return;
    setStep(activeSteps[idx + 1]);
  }

  function handleFooterPrimary() {
    if (step === SUMMARY) {
      void handleComplete();
      return;
    }
    if (step === ENTITIES) {
      // Pre-selectează tipuri documente pe baza entităților alese,
      // apoi sare la pasul următor activ (VEHICLE_MGMT dacă e ales vehicul, altfel DOCS).
      const entityDocs = new Set<DocumentType>();
      selectedEntities.forEach(entity => {
        ENTITY_DOCUMENT_TYPES[entity].forEach(doc => entityDocs.add(doc));
      });
      const preselected = DEFAULT_VISIBLE_DOC_TYPES.filter(doc => entityDocs.has(doc));
      setSelectedDocTypes(preselected.length > 0 ? preselected : [...DEFAULT_VISIBLE_DOC_TYPES]);
      gotoNextActive();
      return;
    }
    if (step === NOTIFICATIONS) {
      void goNextFromNotifications();
      return;
    }
    if (step === CLOUD_BACKUP) {
      void goNextFromCloudBackup();
      return;
    }
    gotoNextActive();
  }

  function handleBack() {
    const idx = activeSteps.indexOf(step);
    if (idx > 0) setStep(activeSteps[idx - 1]);
  }

  const isNextDisabled =
    !canProceedFromAiStep() ||
    (step === CLOUD_BACKUP && (cloudCheck.status === 'checking' || cloudRestoring));

  return (
    <View style={[styles.overlay, { backgroundColor: C.background }]}>
      <OnboardingHeader
        scheme={scheme}
        paddingTop={insets.top}
        currentIdx={currentIdx}
        totalActive={totalActive}
        title={stepTitle(step)}
        subtitle={stepSubtitle(step)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === WELCOME && <WelcomeStep scheme={scheme} />}

        {step === APPEARANCE && (
          <AppearanceStep scheme={scheme} value={themePref} onChange={setThemePref} />
        )}

        {step === SECURITY && (
          <SecurityStep scheme={scheme} onActivatePin={() => setPinModalVisible(true)} />
        )}

        {step === ENTITIES && (
          <EntitiesStep
            scheme={scheme}
            selectedEntities={selectedEntities}
            onToggle={toggleEntity}
          />
        )}

        {step === VEHICLE_MGMT && <VehicleMgmtStep scheme={scheme} />}

        {step === DOCS && (
          <DocsStep scheme={scheme} selectedDocTypes={selectedDocTypes} onToggle={toggleDocType} />
        )}

        {step === NOTIFICATIONS && (
          <NotificationsStep
            scheme={scheme}
            pushEnabled={pushEnabled}
            notifDays={notifDays}
            notifPermStatus={notifPermStatus}
            onTogglePush={handlePushSwitchToggle}
            onChangeDays={setNotifDays}
          />
        )}

        {step === BACKUP && <BackupStep scheme={scheme} />}

        {step === CLOUD_BACKUP && (
          <CloudBackupStep
            scheme={scheme}
            cloudCheck={cloudCheck}
            cloudOptIn={cloudOptIn}
            cloudRestoring={cloudRestoring}
            onChangeOptIn={setCloudOptIn}
            onRestore={() => void handleCloudRestore()}
          />
        )}

        {step === AI_STEP && (
          <AiStep
            scheme={scheme}
            aiProviderChoice={aiProviderChoice}
            aiExternalUrl={aiExternalUrl}
            aiExternalApiKey={aiExternalApiKey}
            aiExternalModel={aiExternalModel}
            aiConsentChecked={aiConsentChecked}
            onChangeProvider={value => {
              setAiProviderChoice(value);
              setAiConsentChecked(false);
            }}
            onChangeUrl={setAiExternalUrl}
            onChangeApiKey={setAiExternalApiKey}
            onChangeModel={setAiExternalModel}
            onToggleConsent={() => setAiConsentChecked(v => !v)}
          />
        )}

        {step === SUMMARY && (
          <SummaryStep
            scheme={scheme}
            themePref={themePref}
            selectedEntities={selectedEntities}
            selectedDocTypes={selectedDocTypes}
            pushEnabled={pushEnabled}
            notifDays={notifDays}
            lockEnabled={lockEnabled}
            aiProviderChoice={aiProviderChoice}
          />
        )}
      </ScrollView>

      <OnboardingFooter
        scheme={scheme}
        paddingBottom={insets.bottom}
        showBack={step > WELCOME}
        showSkip={step < SUMMARY && step !== AI_STEP}
        isLastStep={step === SUMMARY}
        isSingleButton={step === WELCOME}
        nextDisabled={isNextDisabled}
        skipDisabled={cloudRestoring}
        onBack={handleBack}
        onNext={handleFooterPrimary}
        onSkip={() => void handleComplete()}
      />

      <AppLockPinModal
        visible={pinModalVisible}
        onDismiss={() => setPinModalVisible(false)}
        showSuccessAlert={false}
        onPinSaved={() => setLockEnabled(true)}
      />

      <Modal visible={cloudRestoring} transparent animationType="fade">
        <View style={styles.cloudRestoreOverlay}>
          <CloudRestoreProgress progress={cloudRestoreProgress} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 1000,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },
  cloudRestoreOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
