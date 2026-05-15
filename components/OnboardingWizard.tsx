import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Switch,
  Linking,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { SUPPORT_URL } from '@/constants/AppLinks';
import AppLockPinModal from '@/components/AppLockPinModal';
import { AiStep } from '@/components/onboarding/AiStep';
import { CloudBackupStep } from '@/components/onboarding/CloudBackupStep';
import { EntitiesStep } from '@/components/onboarding/EntitiesStep';
import { DocsStep } from '@/components/onboarding/DocsStep';
import {
  ALL_ENTITY_TYPES,
  DEFAULT_VISIBLE_DOC_TYPES,
  ENTITY_DOCUMENT_TYPES,
  ENTITY_TYPE_LABELS,
} from '@/types';
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
import { primary, statusColors } from '@/theme/colors';
import { radius, spacing } from '@/theme/layout';
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

const NOTIF_DAY_OPTIONS = [7, 14, 30] as const;

const ENTITY_LABELS = ENTITY_TYPE_LABELS;

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

  const welcomeBullets = [
    'Datele și fișierele stau pe acest dispozitiv (SQLite, local). Nu există cont online obligatoriu.',
    'Poți atașa fotografii, scan-uri și fișiere PDF la orice document — totul rămâne local.',
    'Asistentul AI (chat) este opțional: îl activezi explicit din tabul Asistent. Poate fi configurat sau dezactivat oricând din Setări → Date și confidențialitate.',
    'Exportul de backup (JSON) este opțional și sub controlul tău (Drive, iCloud, Fișiere).',
  ];

  const securityBullets = [
    'Recomandăm Face ID / Touch ID sau PIN pentru a limita accesul la acte și documente.',
    'Nu salva codul CVV al cardurilor sau parole în câmpurile de note.',
    'Fișierele sunt izolate în sandbox-ul sistemului; alte aplicații nu le văd.',
  ];

  const isNextDisabled =
    !canProceedFromAiStep() ||
    (step === CLOUD_BACKUP && (cloudCheck.status === 'checking' || cloudRestoring));

  return (
    <View style={[styles.overlay, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: C.border }]}>
        <Text style={[styles.stepIndicator, { color: C.textSecondary }]}>
          {currentIdx + 1} / {totalActive}
        </Text>
        <Text style={[styles.title, { color: C.text }]}>{stepTitle(step)}</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>{stepSubtitle(step)}</Text>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: C.border }]}>
        <View style={{ flex: currentIdx + 1, backgroundColor: primary }} />
        <View style={{ flex: Math.max(0, totalActive - currentIdx - 1), minWidth: 0 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === WELCOME && (
          <View style={styles.bulletBlock}>
            {welcomeBullets.map((line, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={[styles.bulletDot, { color: C.primary }]}>•</Text>
                <Text style={[styles.bulletText, { color: C.text }]}>{line}</Text>
              </View>
            ))}
          </View>
        )}

        {step === APPEARANCE && (
          <View style={[styles.notifCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.notifLabel, { color: C.text }]}>Temă de culori</Text>
            <View style={[styles.chipRow, { marginTop: 14 }]}>
              {(
                [
                  ['auto', 'Automat'],
                  ['light', 'Clar'],
                  ['dark', 'Întunecat'],
                ] as const
              ).map(([value, label]) => {
                const active = themePref === value;
                return (
                  <Pressable
                    key={value}
                    style={[
                      styles.chip,
                      active
                        ? [styles.chipActive, { borderColor: C.primary }]
                        : { borderColor: C.border, backgroundColor: C.background },
                    ]}
                    onPress={() => setThemePref(value)}
                  >
                    <Text style={[styles.chipText, { color: active ? '#fff' : C.text }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.notifSub, { color: C.textSecondary, marginTop: 12 }]}>
              „Automat" urmărește setarea telefonului.
            </Text>
          </View>
        )}

        {step === SECURITY && (
          <>
            <View style={styles.bulletBlock}>
              {securityBullets.map((line, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={[styles.bulletDot, { color: C.primary }]}>•</Text>
                  <Text style={[styles.bulletText, { color: C.text }]}>{line}</Text>
                </View>
              ))}
            </View>
            {Platform.OS === 'web' ? (
              <Text style={[styles.webNote, { color: C.textSecondary }]}>
                Pe web, blocarea cu PIN / biometrie nu este disponibilă.
              </Text>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryCta,
                  { borderColor: C.primary, opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={() => setPinModalVisible(true)}
              >
                <Text style={[styles.secondaryCtaText, { color: C.primary }]}>
                  Activează PIN acum
                </Text>
              </Pressable>
            )}
          </>
        )}

        {step === ENTITIES && (
          <EntitiesStep
            scheme={scheme}
            selectedEntities={selectedEntities}
            onToggle={toggleEntity}
          />
        )}

        {step === VEHICLE_MGMT && (
          <View style={styles.bulletBlock}>
            {[
              {
                icon: 'car-sport-outline' as const,
                title: 'Acte vehicul într-un singur loc',
                desc: 'Talon, carte auto, RCA, CASCO, ITP, vignetă, revizie — fiecare cu data de expirare.',
              },
              {
                icon: 'notifications-outline' as const,
                title: 'Remindere automate',
                desc: 'Cu 7, 14 sau 30 zile înainte de expirare. Notificări locale, fără server.',
              },
              {
                icon: 'speedometer-outline' as const,
                title: 'Alimentări și statistici consum',
                desc: 'Înregistrezi alimentările și vezi consumul mediu, costul pe 100 km, evoluția lunară.',
              },
              {
                icon: 'scan-outline' as const,
                title: 'Scanare cu OCR',
                desc: 'Fotografiezi talonul sau cartea auto — datele esențiale se completează automat.',
              },
            ].map(item => (
              <View
                key={item.icon}
                style={[styles.notifCard, { backgroundColor: C.card, borderColor: C.border }]}
              >
                <View style={styles.cardRow}>
                  <Ionicons name={item.icon} size={22} color={C.primary} />
                  <View style={{ flex: 1, marginLeft: spacing.gap }}>
                    <Text style={[styles.cardTitle, { color: C.text }]}>{item.title}</Text>
                    <Text style={[styles.cardSubtitle, { color: C.textSecondary }]}>
                      {item.desc}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
            <Text style={[styles.notifSub, { color: C.textSecondary, marginTop: 4 }]}>
              Adaugi vehiculele tale ulterior din tabul Entități → Vehicul.
            </Text>
          </View>
        )}

        {step === DOCS && (
          <DocsStep
            scheme={scheme}
            selectedDocTypes={selectedDocTypes}
            onToggle={toggleDocType}
          />
        )}

        {step === NOTIFICATIONS && (
          <View style={[styles.notifCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={styles.notifRow}>
              <View style={styles.notifRowText}>
                <Text style={[styles.notifLabel, { color: C.text }]}>Remindere expirări</Text>
                <Text style={[styles.notifSub, { color: C.textSecondary }]}>
                  Notificări locale când se apropie data expirării
                </Text>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={handlePushSwitchToggle}
                trackColor={{ false: C.border, true: primary }}
              />
            </View>
            {notifPermStatus === 'denied' && (
              <View style={styles.permDeniedRow}>
                <Text style={[styles.permDeniedText, { color: statusColors.warning }]}>
                  Notificările sunt blocate. Activează-le din Setări sistem.
                </Text>
                <Pressable onPress={() => Linking.openSettings()}>
                  <Text style={[styles.permDeniedLink, { color: C.primary }]}>Deschide Setări</Text>
                </Pressable>
              </View>
            )}
            {pushEnabled && notifPermStatus !== 'denied' && (
              <>
                <Text style={[styles.notifDaysLabel, { color: C.textSecondary }]}>
                  Câte zile înainte să te anunțăm
                </Text>
                <View style={styles.chipRow}>
                  {NOTIF_DAY_OPTIONS.map(d => {
                    const active = notifDays === d;
                    return (
                      <Pressable
                        key={d}
                        style={[
                          styles.chip,
                          active
                            ? [styles.chipActive, { borderColor: C.primary }]
                            : { borderColor: C.border, backgroundColor: C.background },
                        ]}
                        onPress={() => setNotifDays(d)}
                      >
                        <Text style={[styles.chipText, { color: active ? '#fff' : C.text }]}>
                          {d} zile
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </View>
        )}

        {step === BACKUP && (
          <View style={styles.bulletBlock}>
            <Text style={[styles.backupBody, { color: C.text }]}>
              Din Setări poți exporta toate datele într-un fișier JSON și atașamentele într-o
              arhivă. Recomandăm export periodic — la dezinstalare, datele dispar de pe dispozitiv.
            </Text>
            <Pressable
              onPress={() => Linking.openURL(SUPPORT_URL)}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, marginTop: spacing.gap }]}
            >
              <Text style={[styles.link, { color: C.primary }]}>Deschide ghidul și suportul</Text>
            </Pressable>
          </View>
        )}

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
          <View style={[styles.summaryCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.summaryLine, { color: C.text }]}>
              <Text style={styles.summaryKey}>Temă: </Text>
              {themePref === 'auto' ? 'Automat' : themePref === 'light' ? 'Clar' : 'Întunecat'}
            </Text>
            <Text style={[styles.summaryLine, { color: C.text }]}>
              <Text style={styles.summaryKey}>Entități: </Text>
              {selectedEntities.map(e => ENTITY_LABELS[e]).join(', ')}
            </Text>
            <Text style={[styles.summaryLine, { color: C.text }]}>
              <Text style={styles.summaryKey}>Tipuri documente vizibile: </Text>
              {selectedDocTypes.length}
            </Text>
            <Text style={[styles.summaryLine, { color: C.text }]}>
              <Text style={styles.summaryKey}>Notificări expirări: </Text>
              {pushEnabled ? `Da (${notifDays} zile înainte)` : 'Nu'}
            </Text>
            <Text style={[styles.summaryLine, { color: C.text }]}>
              <Text style={styles.summaryKey}>Blocare aplicație: </Text>
              {lockEnabled ? 'Activă (PIN / biometrie)' : 'Nu'}
            </Text>
            <Text style={[styles.summaryLine, { color: C.text }]}>
              <Text style={styles.summaryKey}>Asistent AI: </Text>
              {aiProvider.PROVIDER_DEFAULTS[aiProviderChoice]?.label ?? aiProviderChoice}
            </Text>
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            borderTopColor: C.border,
            backgroundColor: C.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            ...Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -3 },
                shadowOpacity: 0.06,
                shadowRadius: 10,
              },
              android: { elevation: 12 },
              default: {},
            }),
          },
        ]}
      >
        <View style={styles.footerRow}>
          {step > WELCOME && (
            <Pressable
              style={({ pressed }) => [
                styles.btnBack,
                { borderColor: C.primary, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={handleBack}
            >
              <Text style={[styles.btnBackText, { color: C.primary }]}>Înapoi</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.btnNext,
              step === WELCOME && styles.btnNextSingle,
              { backgroundColor: C.primary, opacity: isNextDisabled ? 0.4 : pressed ? 0.85 : 1 },
            ]}
            onPress={handleFooterPrimary}
            disabled={isNextDisabled}
          >
            <Text style={styles.btnNextText}>{step === SUMMARY ? 'Finalizează' : 'Continuă'}</Text>
          </Pressable>
        </View>
        {step < SUMMARY && step !== AI_STEP && (
          <Pressable
            style={({ pressed }) => [
              styles.btnSkip,
              { opacity: cloudRestoring ? 0.4 : pressed ? 0.6 : 1 },
            ]}
            onPress={() => void handleComplete()}
            disabled={cloudRestoring}
          >
            <Text style={[styles.btnSkipText, { color: C.textSecondary }]}>
              Sari peste configurare
            </Text>
          </Pressable>
        )}
      </View>

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
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  progressTrack: {
    height: 3,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },

  bulletBlock: { gap: 12 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { fontSize: 18, lineHeight: 22, width: 14 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 22 },
  webNote: { marginTop: 16, fontSize: 14, lineHeight: 20 },
  secondaryCta: {
    marginTop: 20,
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  secondaryCtaText: { fontSize: 15, fontWeight: '600' },

  groupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  groupOptional: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipActive: { backgroundColor: primary },
  chipText: { fontSize: 13, fontWeight: '500' },

  notifCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  notifRowText: { flex: 1 },
  notifLabel: { fontSize: 16, fontWeight: '600' },
  notifSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  notifDaysLabel: { fontSize: 13, marginTop: 16, marginBottom: 10, fontWeight: '500' },
  permDeniedRow: { marginTop: 12, gap: 6 },
  permDeniedText: { fontSize: 13, lineHeight: 18 },
  permDeniedLink: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },

  backupBody: { fontSize: 15, lineHeight: 22 },
  link: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },

  summaryCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  summaryLine: { fontSize: 15, lineHeight: 22 },
  summaryKey: { fontWeight: '700' },

  // OCR Privacy step
  stepContent: { gap: 0 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, lineHeight: 18 },
  infoText: { fontSize: 13, lineHeight: 18, fontStyle: 'italic' },


  footer: {
    flexDirection: 'column',
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnBack: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnBackText: { fontSize: 16, fontWeight: '600' },
  btnNext: {
    flex: 2,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnNextSingle: { flex: 1 },
  btnNextText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnSkip: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  btnSkipText: {
    fontSize: 13,
    textDecorationLine: 'underline',
  },

  cloudRestoreOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
