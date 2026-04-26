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
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AI_INFO_URL, SUPPORT_URL } from '@/constants/AppLinks';
import AppLockPinModal from '@/components/AppLockPinModal';
import {
  ALL_ENTITY_TYPES,
  STANDARD_DOC_TYPES,
  DEFAULT_VISIBLE_DOC_TYPES,
  ENTITY_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
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
import { getCategories } from '@/services/categories';
import { createFinancialAccount, getFinancialAccounts } from '@/services/financialAccounts';
import type { ExpenseCategory } from '@/types';
import { primary, statusColors } from '@/theme/colors';
import { radius, spacing } from '@/theme/layout';
import { useThemePreference } from '@/hooks/useThemeScheme';

const WELCOME = 0;
const APPEARANCE = 1;
const SECURITY = 2;
const ENTITIES = 3;
const EXPENSES = 4;
const VEHICLE_MGMT = 5;
const DOCS = 6;
const NOTIFICATIONS = 7;
const BACKUP = 8;
const AI_STEP = 9;
const SUMMARY = 10;

const NOTIF_DAY_OPTIONS = [7, 14, 30] as const;

const ENTITY_LABELS: Record<EntityType, string> = {
  person: 'Persoană',
  vehicle: 'Vehicul',
  property: 'Proprietate',
  card: 'Card',
  animal: 'Animal',
  company: 'Firmă',
  financial_account: 'Cont financiar',
};

const ENTITY_ICONS: Record<EntityType, string> = {
  person: '👤',
  vehicle: '🚗',
  property: '🏠',
  card: '💳',
  animal: '🐾',
  company: '🏢',
  financial_account: '💰',
};

const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  person: 'Buletin, pașaport, permis, rețete',
  vehicle: 'Talon, RCA, ITP, CASCO, vignetă',
  property: 'Acte proprietate, facturi, PAD',
  card: 'Carduri bancare, abonamente',
  animal: 'Vaccinuri, deparazitare, vizite vet',
  company: 'Certificat înregistrare, acte constitutive, TVA',
  financial_account: 'Conturi bancare, numerar, economii, investiții',
};

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
    case EXPENSES:
      return 'Evidență cheltuieli';
    case VEHICLE_MGMT:
      return 'Gestiune auto';
    case DOCS:
      return 'Ce documente te interesează?';
    case NOTIFICATIONS:
      return 'Notificări expirări';
    case BACKUP:
      return 'Backup';
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
    case EXPENSES:
      return 'Urmărește venituri și cheltuieli pe categorii și luni. Totul rămâne pe dispozitiv.';
    case VEHICLE_MGMT:
      return 'Talon, RCA, ITP, alimentări, statistici de consum — într-un singur loc.';
    case DOCS:
      return 'Am preselectat documentele aferente entităților alese. Ajustează după nevoie.';
    case NOTIFICATIONS:
      return 'Primești remindere locale pe telefon — fără server, fără cont online.';
    case BACKUP:
      return 'Exportul periodic (fișier ZIP) îți protejează datele la schimbare de telefon sau reinstalare.';
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
  // În ENTITIES afișăm doar entitățile „de viață" — financial_account e controlat
  // separat din pasul EXPENSES (toggle pentru evidența cheltuielilor).
  const [selectedEntities, setSelectedEntities] = useState<EntityType[]>(
    ALL_ENTITY_TYPES.filter(e => e !== 'financial_account')
  );
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
  const [expensesEnabled, setExpensesEnabled] = useState(true);
  const [systemCategories, setSystemCategories] = useState<ExpenseCategory[]>([]);

  // Lista de pași activi (VEHICLE_MGMT apare doar dacă utilizatorul a ales vehicul).
  const activeSteps: number[] = [
    WELCOME,
    APPEARANCE,
    SECURITY,
    ENTITIES,
    EXPENSES,
    ...(selectedEntities.includes('vehicle') ? [VEHICLE_MGMT] : []),
    DOCS,
    NOTIFICATIONS,
    BACKUP,
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
    getCategories(false)
      .then(cats => setSystemCategories(cats.filter(c => c.is_system)))
      .catch(() => setSystemCategories([]));
    if (Platform.OS !== 'web') {
      Notifications.getPermissionsAsync().then(({ status }) => {
        if (status === 'granted') setNotifPermStatus('granted');
        else if (status === 'denied') setNotifPermStatus('denied');
        else setNotifPermStatus('undetermined');
      });
    }
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

  async function handleComplete() {
    // Hub-ul „Gestiune financiară" e singleton — vizibilitatea lui e controlată
    // exclusiv din toggle-ul EXPENSES. Restul entităților „de viață" (persoană,
    // vehicul etc.) vin din ENTITIES.
    const baseEntities = selectedEntities.filter(e => e !== 'financial_account');
    const finalEntities: EntityType[] = expensesEnabled
      ? [...baseEntities, 'financial_account']
      : baseEntities;
    await settings.setVisibleEntityTypes(finalEntities);
    await settings.setVisibleDocTypes(selectedDocTypes);
    await settings.setPushEnabled(pushEnabled);
    await settings.setNotificationDays(notifDays);
    await scheduleExpirationReminders();

    // Auto-creează „Cheltuieli generale" dacă utilizatorul vrea evidența
    // cheltuielilor și nu are deja un cont financiar.
    if (expensesEnabled) {
      try {
        const existing = await getFinancialAccounts(true);
        if (existing.length === 0) {
          await createFinancialAccount({
            name: 'Cheltuieli generale',
            type: 'cash',
            currency: 'RON',
            initial_balance: 0,
            icon: 'wallet',
          });
        }
      } catch {
        /* eroare neesențială — userul poate crea contul manual din hub */
      }
    }
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
      // apoi sare la pasul următor activ (poate fi EXPENSES sau, sărind peste, DOCS).
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
    gotoNextActive();
  }

  function handleBack() {
    const idx = activeSteps.indexOf(step);
    if (idx > 0) setStep(activeSteps[idx - 1]);
  }

  const DOC_GROUPS: { label: string; types: DocumentType[] }[] = [
    {
      label: 'Identitate',
      types: ['buletin', 'pasaport', 'permis_auto'],
    },
    {
      label: 'Vehicule',
      types: ['talon', 'carte_auto', 'rca', 'casco', 'itp', 'vigneta'],
    },
    {
      label: 'Proprietate',
      types: ['act_proprietate', 'cadastru', 'impozit_proprietate', 'pad', 'stingator_incendiu'],
    },
    {
      label: 'Financiar',
      types: [
        'factura',
        'contract',
        'card',
        'garantie',
        'abonament',
        'bon_cumparaturi',
        'bon_parcare',
      ],
    },
    {
      label: 'Medical',
      types: ['reteta_medicala', 'analize_medicale'],
    },
    {
      label: 'Animale',
      types: ['vaccin_animal', 'deparazitare', 'vizita_vet'],
    },
    {
      label: 'Firmă',
      types: [
        'certificat_inregistrare',
        'autorizatie_activitate',
        'act_constitutiv',
        'certificat_tva',
        'asigurare_profesionala',
      ],
    },
    {
      label: 'Altele',
      types: ['bilet', 'altul'],
    },
  ];

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

  const isNextDisabled = !canProceedFromAiStep();

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

        {step === ENTITIES &&
          ALL_ENTITY_TYPES.filter(e => e !== 'financial_account').map(entityType => {
            const isSelected = selectedEntities.includes(entityType);
            return (
              <Pressable
                key={entityType}
                style={({ pressed }) => [
                  styles.entityCard,
                  {
                    backgroundColor: C.card,
                    shadowColor: C.cardShadow,
                    borderColor: isSelected ? C.primary : 'transparent',
                  },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => toggleEntity(entityType)}
              >
                <View
                  style={[
                    styles.entityIcon,
                    { backgroundColor: isSelected ? C.primaryMuted : C.background },
                  ]}
                >
                  <Text style={styles.entityIconText}>{ENTITY_ICONS[entityType]}</Text>
                </View>
                <View style={styles.entityContent}>
                  <Text style={[styles.entityLabel, { color: C.text }]}>
                    {ENTITY_LABELS[entityType]}
                  </Text>
                  <Text style={[styles.entityDesc, { color: C.textSecondary }]}>
                    {ENTITY_DESCRIPTIONS[entityType]}
                  </Text>
                </View>
                <View
                  style={[
                    styles.checkbox,
                    { borderColor: C.border },
                    isSelected && styles.checkboxActive,
                  ]}
                >
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </Pressable>
            );
          })}

        {step === EXPENSES && (
          <>
            <View style={[styles.notifCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={styles.notifRow}>
                <View style={styles.notifRowText}>
                  <Text style={[styles.notifLabel, { color: C.text }]}>
                    Activează evidența cheltuielilor
                  </Text>
                  <Text style={[styles.notifSub, { color: C.textSecondary }]}>
                    Adaugă venituri și cheltuieli, vezi totaluri lunare pe categorii.
                  </Text>
                </View>
                <Switch
                  value={expensesEnabled}
                  onValueChange={setExpensesEnabled}
                  trackColor={{ false: C.border, true: primary }}
                />
              </View>
              {expensesEnabled && (
                <>
                  <Text
                    style={[
                      styles.notifDaysLabel,
                      { color: C.textSecondary, marginTop: 16, marginBottom: 8 },
                    ]}
                  >
                    Categorii incluse implicit
                  </Text>
                  <View style={styles.chipRow}>
                    {systemCategories.length === 0 ? (
                      <Text style={[styles.notifSub, { color: C.textSecondary }]}>
                        Mâncare, Transport, Utilități, Sănătate, Mașină, Casă, Distracție,
                        Abonamente, Cumpărături, Educație, Călătorii, Venituri.
                      </Text>
                    ) : (
                      systemCategories.map(cat => (
                        <View
                          key={cat.id}
                          style={[
                            styles.chip,
                            { borderColor: C.border, backgroundColor: C.background },
                          ]}
                        >
                          {cat.icon && (
                            <Ionicons
                              name={cat.icon as React.ComponentProps<typeof Ionicons>['name']}
                              size={13}
                              color={cat.color || C.textSecondary}
                              style={{ marginRight: 6 }}
                            />
                          )}
                          <Text style={[styles.chipText, { color: C.text }]}>{cat.name}</Text>
                        </View>
                      ))
                    )}
                  </View>
                  <Text style={[styles.notifSub, { color: C.textSecondary, marginTop: 12 }]}>
                    Vom crea automat un cont „Cheltuieli generale" pentru a începe rapid. Poți
                    adăuga conturi bancare sau de economii separate oricând.
                  </Text>
                  <Text style={[styles.notifSub, { color: C.textSecondary, marginTop: 8 }]}>
                    Bonurile, facturile și abonamentele cu sumă pot deveni tranzacții cu un tap.
                    Bonurile de carburant se transformă automat în tranzacții, iar transferurile
                    între conturile tale sunt detectate și marcate automat.
                  </Text>
                  <Text style={[styles.notifSub, { color: C.textSecondary, marginTop: 8 }]}>
                    ℹ️ Pentru import extras mai precis (PDF trimis direct la AI), poți seta o
                    cheie API proprie din Setări → Asistent AI după onboarding.
                  </Text>
                </>
              )}
            </View>
          </>
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
          <>
            {DOC_GROUPS.map((group, gi) => {
              const groupTypes = group.types.filter(t => STANDARD_DOC_TYPES.includes(t));
              if (groupTypes.length === 0) return null;
              const isDefaultGroup = groupTypes.some(t => DEFAULT_VISIBLE_DOC_TYPES.includes(t));
              return (
                <View key={group.label}>
                  <View style={styles.groupLabelRow}>
                    <Text style={[styles.groupLabel, { color: C.textSecondary }]}>
                      {group.label.toUpperCase()}
                    </Text>
                    {!isDefaultGroup && (
                      <Text style={[styles.groupOptional, { color: C.textSecondary }]}>
                        opțional
                      </Text>
                    )}
                  </View>
                  <View
                    style={[styles.chipRow, gi < DOC_GROUPS.length - 1 && { marginBottom: 12 }]}
                  >
                    {groupTypes.map(docType => {
                      const isSelected = selectedDocTypes.includes(docType);
                      const isDefault = DEFAULT_VISIBLE_DOC_TYPES.includes(docType);
                      return (
                        <Pressable
                          key={docType}
                          style={[
                            styles.chip,
                            isSelected
                              ? [styles.chipActive, { borderColor: C.primary }]
                              : {
                                  borderColor: isDefault ? C.border : C.border,
                                  backgroundColor: C.card,
                                  opacity: isDefault ? 1 : 0.7,
                                },
                          ]}
                          onPress={() => toggleDocType(docType)}
                        >
                          <Text style={[styles.chipText, { color: isSelected ? '#fff' : C.text }]}>
                            {DOCUMENT_TYPE_LABELS[docType]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </>
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

        {step === AI_STEP && (
          <View style={styles.aiBlock}>
            {(
              [
                {
                  type: 'builtin' as AiProviderType,
                  title: 'Dosar AI (recomandat)',
                  desc: 'Cloud · 20 interogări/zi gratuit · Pornești imediat, fără configurare',
                },
                {
                  type: 'external' as AiProviderType,
                  title: 'Cheie API proprie',
                  desc: 'Cloud · Nelimitat · Orice provider compatibil OpenAI (Mistral, OpenAI etc.)',
                },
                {
                  type: 'local' as AiProviderType,
                  title: 'Model local',
                  desc: 'Pe device · Privat · Nelimitat · Offline · Download 800MB–4GB din Setări',
                },
                {
                  type: 'none' as AiProviderType,
                  title: 'Fără AI',
                  desc: 'Aplicația funcționează complet offline, fără asistent',
                },
              ] as Array<{ type: AiProviderType; title: string; desc: string }>
            ).map(option => (
              <Pressable
                key={option.type}
                style={[
                  styles.aiToggleCard,
                  {
                    backgroundColor: C.card,
                    borderColor: aiProviderChoice === option.type ? C.primary : C.border,
                  },
                ]}
                onPress={() => {
                  setAiProviderChoice(option.type);
                  setAiConsentChecked(false);
                }}
              >
                <View style={styles.aiToggleText}>
                  <Text style={[styles.aiToggleLabel, { color: C.text }]}>{option.title}</Text>
                  <Text style={[styles.aiToggleSub, { color: C.textSecondary }]}>
                    {option.desc}
                  </Text>
                </View>
                <View
                  style={[
                    styles.aiRadioDot,
                    { borderColor: aiProviderChoice === option.type ? C.primary : C.border },
                  ]}
                >
                  {aiProviderChoice === option.type && (
                    <View style={[styles.aiRadioDotInner, { backgroundColor: C.primary }]} />
                  )}
                </View>
              </Pressable>
            ))}

            {/* Câmpuri pentru external */}
            {aiProviderChoice === 'external' && (
              <View style={{ gap: 8, marginTop: 4 }}>
                <TextInput
                  style={[
                    styles.aiInput,
                    { color: C.text, borderColor: C.border, backgroundColor: C.card },
                  ]}
                  value={aiExternalUrl}
                  onChangeText={setAiExternalUrl}
                  placeholder="URL API (ex: https://api.mistral.ai/v1)"
                  placeholderTextColor={C.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <TextInput
                  style={[
                    styles.aiInput,
                    { color: C.text, borderColor: C.border, backgroundColor: C.card },
                  ]}
                  value={aiExternalApiKey}
                  onChangeText={setAiExternalApiKey}
                  placeholder="Cheie API"
                  placeholderTextColor={C.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={[
                    styles.aiInput,
                    { color: C.text, borderColor: C.border, backgroundColor: C.card },
                  ]}
                  value={aiExternalModel}
                  onChangeText={setAiExternalModel}
                  placeholder="Model (ex: mistral-small-latest)"
                  placeholderTextColor={C.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}

            {/* Acord AI */}
            {(aiProviderChoice === 'builtin' || aiProviderChoice === 'external') && (
              <Pressable
                style={[
                  styles.aiToggleCard,
                  {
                    backgroundColor: C.card,
                    borderColor: aiConsentChecked ? C.primary : C.border,
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 12,
                  },
                ]}
                onPress={() => setAiConsentChecked(v => !v)}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    borderWidth: 2,
                    borderColor: aiConsentChecked ? C.primary : C.border,
                    backgroundColor: aiConsentChecked ? C.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 1,
                    flexShrink: 0,
                  }}
                >
                  {aiConsentChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.aiToggleLabel, { color: C.text, fontSize: 14 }]}>
                    {aiProviderChoice === 'builtin'
                      ? 'Sunt de acord cu trimiterea datelor la serviciul Dosar AI'
                      : 'Sunt de acord cu trimiterea datelor la serviciul AI configurat'}
                  </Text>
                  <Text style={[styles.aiToggleSub, { color: C.textSecondary }]}>
                    Textul extras, numele entităților și detaliile documentelor sunt trimise pentru
                    procesare. Fotografiile și PIN-ul NU sunt trimise.
                  </Text>
                </View>
              </Pressable>
            )}

            {aiProviderChoice !== 'none' && (
              <View style={[styles.card, { backgroundColor: C.card, marginTop: spacing.gap }]}>
                <View style={styles.cardRow}>
                  <Ionicons name="image-outline" size={20} color="#F57F17" />
                  <View style={{ flex: 1, marginLeft: spacing.gap }}>
                    <Text style={[styles.cardTitle, { color: C.text }]}>
                      Extracție AI din documente
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: C.textSecondary }]}>
                      Textul OCR e trimis automat (dacă e activat). Imaginile se trimit doar la
                      apăsarea butonului „Trimite documentul la AI" din formular — niciodată
                      automat.
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <Pressable
              onPress={() => Linking.openURL(AI_INFO_URL)}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, marginTop: 4 }]}
            >
              <Text style={[styles.link, { color: C.primary }]}>
                Află mai multe despre opțiunile AI →
              </Text>
            </Pressable>
          </View>
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
              <Text style={styles.summaryKey}>Evidență cheltuieli: </Text>
              {expensesEnabled ? 'Activă (Cheltuieli generale)' : 'Dezactivată'}
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
            style={({ pressed }) => [styles.btnSkip, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => void handleComplete()}
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

  entityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  entityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  entityIconText: { fontSize: 22 },
  entityContent: { flex: 1 },
  entityLabel: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  entityDesc: { fontSize: 12, lineHeight: 16 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkboxActive: { backgroundColor: primary, borderColor: primary },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },

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

  // AI step
  aiBlock: { gap: 16 },
  aiToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: 16,
    gap: 12,
  },
  aiToggleText: { flex: 1 },
  aiToggleLabel: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  aiToggleSub: { fontSize: 13, lineHeight: 18 },
  aiInfoCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  aiInfoTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  aiLimitText: { fontSize: 14, lineHeight: 20 },
  aiKeyHint: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  aiPrivacyNote: { fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  aiRadioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  aiRadioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  aiInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    height: 46,
  },

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
});
