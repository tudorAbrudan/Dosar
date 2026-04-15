import { useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useThemePreference } from '@/hooks/useThemeScheme';
import { PRIVACY_URL, SUPPORT_URL } from '@/constants/AppLinks';
import AppLockPinModal from '@/components/AppLockPinModal';
import { primary } from '@/theme/colors';
import * as settings from '@/services/settings';
import * as aiProvider from '@/services/aiProvider';
import type { AiProviderType } from '@/services/aiProvider';
import { scheduleExpirationReminders } from '@/services/notifications';
import { exportBackup, importBackup } from '@/services/backup';
import { checkForUpdateForced } from '@/services/updateCheck';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '@/services/db';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { ONBOARDING_RESET_EVENT } from '@/app/_layout';
import {
  ALL_ENTITY_TYPES,
  STANDARD_DOC_TYPES,
  ENTITY_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
} from '@/types';
import type { EntityType, DocumentType } from '@/types';

const ENTITY_LABELS: Record<EntityType, string> = {
  person: 'Persoană',
  vehicle: 'Vehicul',
  property: 'Proprietate',
  card: 'Card',
  animal: 'Animal',
  company: 'Firmă',
};

const ENTITY_ICONS: Record<EntityType, string> = {
  person: '👤',
  vehicle: '🚗',
  property: '🏠',
  card: '💳',
  animal: '🐾',
  company: '🏢',
};

// ─── Constante contact ────────────────────────────────────────────────────────
// TODO: înlocuiește cu datele reale înainte de publish
const CONTACT_EMAIL = 'apps.tudor@gmail.com';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const APP_NAME = Constants.expoConfig?.name ?? 'Documente';

// ─── Texte legale ─────────────────────────────────────────────────────────────
const TERMS_TEXT = `TERMENI ȘI CONDIȚII DE UTILIZARE
Versiunea 1.0 – Martie 2025

1. ACCEPTAREA TERMENILOR
Prin utilizarea aplicației ${APP_NAME}, acceptați acești termeni în totalitate. Dacă nu sunteți de acord, vă rugăm să nu utilizați aplicația.

2. DESCRIEREA SERVICIULUI
${APP_NAME} este o aplicație mobilă pentru gestionarea documentelor personale (acte de identitate, documente auto, proprietăți, carduri bancare, facturi etc.). Aplicația funcționează local-first – datele sunt stocate exclusiv pe dispozitivul dumneavoastră, fără cont online.

ASISTENT AI OPȚIONAL: Aplicația include un asistent bazat pe inteligență artificială (Mistral AI – mistral.ai). Dacă alegeți să utilizați această funcție și vă dați acordul explicit în prealabil, anumite date (denumiri entități, tipuri documente, date de expirare și emitere, note, date de identificare ale documentelor) sunt transmise către Mistral AI pentru procesare. Utilizarea asistentului AI este complet opțională; restul aplicației funcționează 100% offline.

3. UTILIZARE PERMISĂ
Aplicația este destinată exclusiv uzului personal și familial. Nu este permisă utilizarea comercială fără acordul scris al dezvoltatorului.

4. RESPONSABILITATE
Aplicația este furnizată „ca atare". Nu garantăm că aplicația va fi lipsită de erori. Utilizatorul este responsabil pentru efectuarea regulată de backup-uri ale datelor. Datele stocate sunt responsabilitatea exclusivă a utilizatorului.

5. PROPRIETATE INTELECTUALĂ
Aplicația și codul sursă sunt proprietatea dezvoltatorului. Pictogramele și fonturile sunt utilizate conform licențelor respective.

6. BACKUP ȘI DATE
Recomandăm exportul periodic al datelor folosind funcția Backup. Nu ne asumăm responsabilitatea pentru pierderea datelor cauzată de dezinstalarea aplicației, resetarea dispozitivului sau defecțiuni hardware.

7. MODIFICĂRI
Acești termeni pot fi actualizați. Versiunea curentă este disponibilă în aplicație și pe site-ul nostru.

8. CONTACT
Pentru orice întrebare: ${CONTACT_EMAIL}`;

const PRIVACY_TEXT = `POLITICĂ DE CONFIDENȚIALITATE (GDPR)
Versiunea 1.0 – Martie 2025

1. IDENTITATEA OPERATORULUI
${APP_NAME} este dezvoltată și operată de [Numele tău / Firma ta], cu sediul în România.
Contact: ${CONTACT_EMAIL}

2. CE DATE COLECTĂM ȘI UNDE LE STOCĂM
${APP_NAME} stochează local, pe dispozitivul dumneavoastră:
• Imagini și scan-uri ale documentelor personale
• Date structurate: numere de documente, date de expirare, note personale
• Informații despre entități (persoane, vehicule, proprietăți, carduri)

Nu există server propriu, nu există cont de utilizator, nu există analiză de trafic, nu există reclame, nu există trackere.

3. ASISTENT AI OPȚIONAL – SERVICIU TERȚ
Dacă alegeți să utilizați funcția de asistent AI (chat sau scanare OCR), după acordul dumneavoastră explicit, anumite date sunt transmise către Mistral AI (mistral.ai), un serviciu terț de inteligență artificială:
• Ce se trimite: textul extras din documente (OCR), denumiri entități (persoane, vehicule, proprietăți, carduri, animale), tipuri documente, date de expirare și emitere, note, date de identificare (serie acte, CNP, nr. înmatriculare, nr. înregistrare și alte câmpuri completate)
• Ce NU se trimite: fotografii ale documentelor, numărul CVV, PIN-ul aplicației, datele sensibile
• Cu propria cheie API (gratuită de pe mistral.ai), puteți controla exact ce provider procesează datele
• Transmiterea are loc EXCLUSIV cu consimțământul explicit acordat anterior
• Consimțământul poate fi revocat oricând din Setări → Date și confidențialitate
• Politica de confidențialitate Mistral AI: https://mistral.ai/terms

4. TEMEIUL JURIDIC
Procesăm datele în baza consimțământului dumneavoastră explicit (art. 6 alin. 1 lit. a GDPR), dat prin instalarea și utilizarea aplicației. Pentru asistentul AI, consimțământul este solicitat separat și explicit.

5. CÂT TIMP PĂSTRĂM DATELE
Datele rămân pe dispozitivul dumneavoastră atâta timp cât utilizați aplicația. La dezinstalare, toate datele sunt șterse automat de sistemul de operare. Datele transmise asistentului AI sunt procesate de Mistral AI conform propriei lor politici de retenție.

6. DREPTURILE DUMNEAVOASTRĂ (GDPR)
Aveți dreptul la:
• Acces – toate datele sunt vizibile direct în aplicație
• Rectificare – puteți edita orice dată oricând
• Ștergere – folosiți funcția „Șterge toate datele" din Setări
• Portabilitate – exportați datele ca fișier ZIP din funcția Backup
• Retragerea consimțământului AI – Setări → Date și confidențialitate → Revocare consimțământ AI
• Opoziție – dezinstalați aplicația

7. BACKUP ÎN CLOUD
Dacă utilizați funcția de export backup, fișierul ZIP ajunge în aplicația Files / iCloud Drive / Google Drive conform alegerii dumneavoastră. Politica de confidențialitate a acestor servicii le aparține.

8. SECURITATE
Datele sunt protejate prin:
• Stocare locală (sandbox iOS/Android)
• Opțional: blocare prin Face ID / Touch ID / PIN
• Fișierele nu sunt accesibile altor aplicații

9. CONTACT GDPR
Pentru exercitarea drepturilor GDPR sau orice întrebare:
Email: ${CONTACT_EMAIL}
Site: ${PRIVACY_URL}`;

// ─── Componente helper ────────────────────────────────────────────────────────

interface InfoRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  sub?: string;
  onPress?: () => void;
  isLast?: boolean;
  scheme: 'light' | 'dark';
}

function InfoRow({ icon, iconBg, iconColor, label, sub, onPress, isLast, scheme }: InfoRowProps) {
  const C = Colors[scheme];
  return (
    <Pressable
      style={({ pressed }) => [
        isLast ? styles.rowLast : styles.row,
        { borderBottomColor: C.border },
        pressed && onPress && { opacity: 0.7 },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <RNView style={styles.rowLeft}>
        <RNView style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </RNView>
        <RNView style={styles.rowLabelWrap}>
          <RNText style={[styles.rowLabel, { color: C.text }]}>{label}</RNText>
          {sub ? <RNText style={[styles.rowSub, { color: C.textSecondary }]}>{sub}</RNText> : null}
        </RNView>
      </RNView>
      {onPress && <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />}
    </Pressable>
  );
}

// ─── Modal cu text legal ──────────────────────────────────────────────────────

interface LegalModalProps {
  visible: boolean;
  title: string;
  content: string;
  onClose: () => void;
  scheme: 'light' | 'dark';
}

function LegalModal({ visible, title, content, onClose, scheme }: LegalModalProps) {
  const C = Colors[scheme];
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <RNView style={[styles.legalContainer, { backgroundColor: C.background }]}>
        <RNView
          style={[styles.legalHeader, { backgroundColor: C.card, borderBottomColor: C.border }]}
        >
          <RNText style={[styles.legalTitle, { color: C.text }]}>{title}</RNText>
          <Pressable onPress={onClose} hitSlop={12} style={styles.legalClose}>
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        </RNView>
        <ScrollView
          style={styles.legalScroll}
          contentContainerStyle={styles.legalContent}
          showsVerticalScrollIndicator={false}
        >
          <RNText style={[styles.legalText, { color: C.text }]}>{content}</RNText>
        </ScrollView>
      </RNView>
    </Modal>
  );
}

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
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appLockPinModal, setAppLockPinModal] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [aiConsentGiven, setAiConsentGiven] = useState(false);

  // ── AI Provider ─────────────────────────────────────────────────────────────
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiProviderType, setAiProviderType] = useState<AiProviderType>('mistral');
  const [aiProviderUrl, setAiProviderUrl] = useState('');
  const [aiProviderModel, setAiProviderModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [aiTestMessage, setAiTestMessage] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupImporting, setBackupImporting] = useState(false);

  useEffect(() => {
    settings.getNotificationDays().then(setNotifDays);
    settings.getPushEnabled().then(setPushEnabled);
    settings.getAppLockEnabled().then(setAppLockEnabled);
    AsyncStorage.getItem('ai_assistant_consent_accepted').then(v =>
      setAiConsentGiven(v === 'true')
    );
    aiProvider.getAiConfig().then(cfg => {
      setAiProviderType(cfg.type);
      setAiProviderUrl(cfg.url);
      setAiProviderModel(cfg.model);
      setAiApiKey(cfg.apiKey);
    });
  }, []);

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

  const handleToggleEntityType = (entityType: EntityType) => {
    const isVisible = visibleEntityTypes.includes(entityType);
    if (isVisible && visibleEntityTypes.length <= 1) {
      Alert.alert('Minim unul', 'Trebuie să ai cel puțin un tip de entitate activat.');
      return;
    }
    const next = isVisible
      ? visibleEntityTypes.filter(e => e !== entityType)
      : [...visibleEntityTypes, entityType];
    updateVisibleEntityTypes(next);
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
  const handleAiProviderSelect = (type: AiProviderType) => {
    setAiProviderType(type);
    const defaults = aiProvider.PROVIDER_DEFAULTS[type];
    setAiProviderUrl(defaults.url);
    setAiProviderModel(defaults.model);
    setAiTestStatus('idle');
    setAiTestMessage('');
  };

  const handleSaveAiConfig = async () => {
    try {
      await aiProvider.saveAiConfig({
        type: aiProviderType,
        url: aiProviderUrl,
        model: aiProviderModel,
      });
      await aiProvider.saveAiApiKey(aiApiKey);
      setAiModalVisible(false);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva configurația');
    }
  };

  const handleTestAiConnection = async () => {
    setAiTestStatus('loading');
    setAiTestMessage('');
    try {
      // Salvăm temporar config-ul curent pentru test
      await aiProvider.saveAiConfig({
        type: aiProviderType,
        url: aiProviderUrl,
        model: aiProviderModel,
      });
      await aiProvider.saveAiApiKey(aiApiKey);
      await aiProvider.sendAiRequest([{ role: 'user', content: 'test' }], 10);
      setAiTestStatus('ok');
      setAiTestMessage('Conexiune reușită!');
    } catch (e) {
      setAiTestStatus('error');
      setAiTestMessage(e instanceof Error ? e.message : 'Eroare necunoscută');
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
            { text: 'Actualizează', onPress: () => Linking.openURL(info.url) },
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
    Alert.alert('Atenție', 'Vrei să ștergi TOATE datele? Aceasta este ireversibilă.', [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: () => {
          try {
            db.runAsync('DELETE FROM documents');
            db.runAsync('DELETE FROM persons');
            db.runAsync('DELETE FROM properties');
            db.runAsync('DELETE FROM vehicles');
            db.runAsync('DELETE FROM cards');
            Alert.alert('Date șterse', 'Toate datele au fost șterse.');
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-au putut șterge datele');
          }
        },
      },
    ]);
  };

  // ── Contact ──────────────────────────────────────────────────────────────────
  const openEmail = () => {
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=Suport%20${APP_NAME}`).catch(() => {
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

  const handleToggleAiConsent = () => {
    if (aiConsentGiven) {
      Alert.alert(
        'Revocare consimțământ AI',
        'Ești sigur că vrei să revoci consimțământul? Asistentul AI (chat și scanare OCR) nu va mai funcționa.',
        [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Revocare',
            style: 'destructive',
            onPress: async () => {
              await AsyncStorage.removeItem('ai_assistant_consent_accepted');
              setAiConsentGiven(false);
              Alert.alert('Revocat', 'Consimțământul a fost revocat.');
            },
          },
        ]
      );
    } else {
      Alert.alert(
        'Activează asistentul AI',
        'Când folosești AI-ul (chat sau scanare OCR), textul extras și lista entităților sunt trimise la Mistral AI. Fotografiile și PIN-ul NU sunt trimise.\n\nAccepți?',
        [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Activează',
            onPress: async () => {
              await AsyncStorage.setItem('ai_assistant_consent_accepted', 'true');
              setAiConsentGiven(true);
              Alert.alert('Activat', 'Asistentul AI este acum activ.');
            },
          },
        ]
      );
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Securitate ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>SECURITATE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNView style={styles.rowLast}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#FCE4EC' }]}>
                <Ionicons name="lock-closed-outline" size={18} color="#C62828" />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>Blocare aplicație</RNText>
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>
                  Face ID / Touch ID / PIN
                </RNText>
              </RNView>
            </RNView>
            <Switch
              value={appLockEnabled}
              onValueChange={handleAppLockToggle}
              trackColor={{ false: '#ccc', true: primary }}
              thumbColor="#fff"
            />
          </RNView>
        </RNView>
        {appLockEnabled && (
          <RNText style={[styles.lockHint, { color: C.textSecondary }]}>
            Dacă ai Face ID configurat pe telefon, poți debloca aplicația cu el chiar dacă uiți
            PIN-ul. Dacă ai uitat PIN-ul și nu ai Face ID, dezactivează blocarea din Setări iPhone →
            Parolă și Face ID → resetează datele aplicației.
          </RNText>
        )}

        {/* ── Aspect ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>ASPECT</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Alege tema de culori a aplicației.
          </RNText>
          <RNView style={[styles.chipRow, { marginTop: 8 }]}>
            {(
              [
                ['auto', 'Automat'],
                ['light', 'Clar'],
                ['dark', 'Întunecat'],
              ] as const
            ).map(([value, label]) => {
              const isActive = themePref === value;
              return (
                <Pressable
                  key={value}
                  style={[
                    styles.chip,
                    isActive
                      ? [styles.chipActive, { borderColor: primary }]
                      : { borderColor: C.border },
                  ]}
                  onPress={() => setThemePref(value)}
                >
                  <RNText style={[styles.chipText, { color: isActive ? '#fff' : C.textSecondary }]}>
                    {label}
                  </RNText>
                </Pressable>
              );
            })}
          </RNView>
        </RNView>

        {/* ── Notificări ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>NOTIFICĂRI</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNView style={[styles.row, { borderBottomColor: C.border }]}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#E3F2FD' }]}>
                <Ionicons name="time-outline" size={18} color="#1565C0" />
              </RNView>
              <RNText style={[styles.rowLabel, { color: C.text }]}>Zile înainte de expirare</RNText>
            </RNView>
            <TextInput
              style={[
                styles.inputSmall,
                { color: C.text, borderColor: C.border, backgroundColor: C.background },
              ]}
              value={String(notifDays)}
              onChangeText={handleNotifDays}
              keyboardType="number-pad"
              maxLength={2}
            />
          </RNView>
          <RNView style={styles.rowLast}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="notifications-outline" size={18} color={primary} />
              </RNView>
              <RNText style={[styles.rowLabel, { color: C.text }]}>Notificări push</RNText>
            </RNView>
            <Switch
              value={pushEnabled}
              onValueChange={handlePushToggle}
              trackColor={{ false: '#ccc', true: primary }}
              thumbColor="#fff"
            />
          </RNView>
        </RNView>

        {/* ── Backup ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
          BACKUP ȘI RESTAURARE
        </RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Exportă toate datele și pozele ca fișier ZIP și salvează-l în iCloud Drive sau Files. La
            schimbarea telefonului, importă fișierul pentru a restaura complet datele și pozele.
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
              <Ionicons name="cloud-upload-outline" size={18} color="#fff" style={styles.btnIcon} />
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

        {/* ── Asistent AI ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>ASISTENT AI</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <InfoRow
            icon="sparkles-outline"
            iconBg="#EDE7F6"
            iconColor="#4527A0"
            label="Provider AI"
            sub={aiProvider.PROVIDER_DEFAULTS[aiProviderType].label}
            onPress={() => setAiModalVisible(true)}
            scheme={scheme}
          />
          <Pressable style={styles.rowLast} onPress={handleToggleAiConsent}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#EDE7F6' }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="#4527A0" />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>
                  Consimțământ asistent AI
                </RNText>
                <RNText
                  style={[styles.rowSub, { color: aiConsentGiven ? '#4CAF50' : C.textSecondary }]}
                >
                  {aiConsentGiven
                    ? '✓ Acordat – apasă pentru revocare'
                    : 'Neacordat – apasă pentru activare'}
                </RNText>
              </RNView>
            </RNView>
            <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
          </Pressable>
        </RNView>

        {/* ── Vizibilitate entități ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>ENTITĂȚI ACTIVE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Alege ce tipuri de entități să apară în aplicație. Entitățile dezactivate nu vor apărea
            în formulare sau liste.
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
                    style={[styles.rowIcon, { backgroundColor: isActive ? '#E8F5E9' : '#F5F5F5' }]}
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
                  trackColor={{ false: '#ccc', true: primary }}
                  thumbColor="#fff"
                />
              </RNView>
            );
          })}
        </RNView>

        {/* ── Vizibilitate tipuri documente ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
          TIPURI DOCUMENTE ACTIVE
        </RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Alege ce tipuri de documente să apară în formulare. Tipurile dezactivate nu vor apărea
            la adăugarea documentelor.
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
                  <RNText style={[styles.chipText, { color: isActive ? '#fff' : C.textSecondary }]}>
                    {DOCUMENT_TYPE_LABELS[docType]}
                  </RNText>
                </Pressable>
              );
            })}
          </RNView>
        </RNView>

        {/* ── Tipuri personalizate de documente ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
          TIPURI PERSONALIZATE DE DOCUMENTE
        </RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Adaugă tipuri proprii de documente (ex: „Asigurare viață", „Dosar medical"). Tipurile de
            entități (Persoană, Vehicul, Proprietate etc.) sunt fixe și nu pot fi modificate.
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
                <Ionicons name="trash-outline" size={18} color="#E53935" />
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

        {/* ── GDPR – Date și confidențialitate ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
          DATE ȘI CONFIDENȚIALITATE
        </RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <InfoRow
            icon="shield-checkmark-outline"
            iconBg="#E8F5E9"
            iconColor={primary}
            label="Politică de confidențialitate"
            sub="Cum sunt protejate datele tale"
            onPress={() => setPrivacyVisible(true)}
            scheme={scheme}
          />
          <InfoRow
            icon="document-text-outline"
            iconBg="#E3F2FD"
            iconColor="#1565C0"
            label="Termeni și condiții"
            onPress={() => setTermsVisible(true)}
            scheme={scheme}
          />
          <RNView style={[styles.row, { borderBottomColor: C.border }]}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#FFF3E0' }]}>
                <Ionicons name="information-circle-outline" size={18} color="#E65100" />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>Stocare date</RNText>
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>
                  Local pe dispozitiv · fără server propriu
                </RNText>
              </RNView>
            </RNView>
          </RNView>
          <RNView style={styles.rowLast}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#FCE4EC' }]}>
                <Ionicons name="trash-outline" size={18} color="#C62828" />
              </RNView>
              <RNText style={[styles.rowLabel, { color: '#E53935' }]}>Șterge toate datele</RNText>
            </RNView>
            <Pressable onPress={handleDeleteAllData} hitSlop={8}>
              <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
            </Pressable>
          </RNView>
        </RNView>

        {/* ── Contact și suport ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>CONTACT ȘI SUPORT</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <InfoRow
            icon="mail-outline"
            iconBg="#E8EAF6"
            iconColor="#283593"
            label="Trimite un email"
            sub={CONTACT_EMAIL}
            onPress={openEmail}
            scheme={scheme}
          />
          <InfoRow
            icon="globe-outline"
            iconBg="#E0F2F1"
            iconColor="#00695C"
            label="Site web și suport"
            sub={SUPPORT_URL}
            onPress={openSupportUrl}
            scheme={scheme}
          />
          <InfoRow
            icon="star-outline"
            iconBg="#FFF8E1"
            iconColor="#F57F17"
            label="Evaluează aplicația"
            sub="Ne ajuți cu o recenzie pe App Store"
            onPress={() =>
              Linking.openURL('itms-apps://itunes.apple.com/app/id6760576986?action=write-review')
            }
            isLast
            scheme={scheme}
          />
        </RNView>

        {/* ── Despre aplicație ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>DESPRE APLICAȚIE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNView style={[styles.row, { borderBottomColor: C.border }]}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="folder-outline" size={18} color={primary} />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>{APP_NAME}</RNText>
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>
                  Gestionare documente personale
                </RNText>
              </RNView>
            </RNView>
            <RNText
              style={[styles.versionBadge, { color: C.textSecondary, borderColor: C.border }]}
            >
              v{APP_VERSION}
            </RNText>
          </RNView>
          <RNView style={[styles.row, { borderBottomColor: C.border }]}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#F3E5F5' }]}>
                <Ionicons name="phone-portrait-outline" size={18} color="#6A1B9A" />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>Mod de funcționare</RNText>
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>
                  Local-first · offline · fără cont
                </RNText>
              </RNView>
            </RNView>
          </RNView>
          <RNView style={[styles.row, { borderBottomColor: C.border }]}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#E0F2F1' }]}>
                <Ionicons name="scan-outline" size={18} color="#00695C" />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>OCR on-device</RNText>
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>
                  Extragere text din poze · fără cloud
                </RNText>
              </RNView>
            </RNView>
          </RNView>
          <RNView style={[styles.row, { borderBottomColor: C.border }]}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#FFF3E0' }]}>
                <Ionicons name="construct-outline" size={18} color="#E65100" />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>Tehnologii</RNText>
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>
                  React Native · Expo · SQLite
                </RNText>
              </RNView>
            </RNView>
          </RNView>
          <InfoRow
            icon="cloud-download-outline"
            iconBg="#E3F2FD"
            iconColor="#1565C0"
            label="Verifică actualizări"
            sub={checkingUpdate ? 'Se verifică...' : `Versiune curentă: ${APP_VERSION}`}
            onPress={handleCheckForUpdate}
            scheme={scheme}
          />
          <InfoRow
            icon="rocket-outline"
            iconBg="#E8F5E9"
            iconColor={primary}
            label="Reluare onboarding"
            sub="Resetează setările de vizibilitate la valorile implicite"
            onPress={handleResetOnboarding}
            isLast
            scheme={scheme}
          />
        </RNView>

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

          <ScrollView
            style={styles.legalScroll}
            contentContainerStyle={[styles.legalContent, { gap: 20 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Selector provider */}
            <RNView>
              <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>Provider</RNText>
              <RNView style={styles.chipRow}>
                {(Object.keys(aiProvider.PROVIDER_DEFAULTS) as AiProviderType[]).map(type => (
                  <Pressable
                    key={type}
                    style={[
                      styles.chip,
                      aiProviderType === type
                        ? [styles.chipActive, { borderColor: primary }]
                        : { borderColor: C.border },
                    ]}
                    onPress={() => handleAiProviderSelect(type)}
                  >
                    <RNText
                      style={[
                        styles.chipText,
                        { color: aiProviderType === type ? '#fff' : C.textSecondary },
                      ]}
                    >
                      {aiProvider.PROVIDER_DEFAULTS[type].label}
                    </RNText>
                  </Pressable>
                ))}
              </RNView>
            </RNView>

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
                  Utilizează serviciul AI inclus în aplicație (Mistral AI). Nu este necesară o cheie
                  API personală.
                </RNText>
              </RNView>
            )}

            {/* URL editabil doar pentru custom */}
            {aiProviderType === 'custom' && (
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
                  placeholder="https://…"
                  placeholderTextColor={C.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </RNView>
            )}

            {/* URL readonly pentru mistral/openai */}
            {(aiProviderType === 'mistral' || aiProviderType === 'openai') && (
              <RNView>
                <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>URL API</RNText>
                <RNView
                  style={[
                    styles.aiInput,
                    styles.aiInputReadonly,
                    { borderColor: C.border, backgroundColor: C.background },
                  ]}
                >
                  <RNText style={[styles.aiInputReadonlyText, { color: C.textSecondary }]}>
                    {aiProviderUrl}
                  </RNText>
                </RNView>
              </RNView>
            )}

            {/* Cheie API — ascunsă pentru builtin */}
            {aiProviderType !== 'builtin' && (
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
            )}

            {/* Model — ascuns pentru builtin */}
            {aiProviderType !== 'builtin' && (
              <RNView>
                <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>Model</RNText>
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
            )}

            {/* Testare conexiune */}
            <Pressable
              style={({ pressed }) => [
                styles.btnOutline,
                { borderColor: primary, opacity: pressed ? 0.8 : 1 },
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
                  aiTestStatus === 'ok' ? '#2E7D32' : aiTestStatus === 'error' ? '#C62828' : primary
                }
                style={styles.btnIcon}
              />
              <RNText
                style={[
                  styles.btnOutlineText,
                  {
                    color:
                      aiTestStatus === 'ok'
                        ? '#2E7D32'
                        : aiTestStatus === 'error'
                          ? '#C62828'
                          : primary,
                  },
                ]}
              >
                {aiTestStatus === 'loading'
                  ? 'Se testează…'
                  : aiTestStatus === 'ok'
                    ? 'Conexiune OK'
                    : aiTestStatus === 'error'
                      ? 'Eroare conexiune'
                      : 'Testează conexiunea'}
              </RNText>
            </Pressable>
            {aiTestMessage ? (
              <RNText
                style={[styles.aiHint, { color: aiTestStatus === 'error' ? '#C62828' : '#2E7D32' }]}
              >
                {aiTestMessage}
              </RNText>
            ) : null}

            {/* Salvare */}
            <Pressable
              style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleSaveAiConfig}
            >
              <Ionicons name="save-outline" size={18} color="#fff" style={styles.btnIcon} />
              <RNText style={styles.btnText}>Salvează</RNText>
            </Pressable>
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

  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 34,
  },

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

  btnDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E53935',
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 6,
  },
  btnDangerText: { color: '#E53935', fontSize: 15, fontWeight: '600' },

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
});
