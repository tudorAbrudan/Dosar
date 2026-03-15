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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import * as settings from '@/services/settings';
import { scheduleExpirationReminders } from '@/services/notifications';
import { exportBackup, importBackup } from '@/services/backup';
import { db } from '@/services/db';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { ALL_ENTITY_TYPES, STANDARD_DOC_TYPES, ENTITY_DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { EntityType, DocumentType } from '@/types';

const ENTITY_LABELS: Record<EntityType, string> = {
  person: 'Persoană',
  vehicle: 'Vehicul',
  property: 'Proprietate',
  card: 'Card',
  animal: 'Animal',
};

const ENTITY_ICONS: Record<EntityType, string> = {
  person: '👤',
  vehicle: '🚗',
  property: '🏠',
  card: '💳',
  animal: '🐾',
};

// ─── Constante contact ────────────────────────────────────────────────────────
// TODO: înlocuiește cu datele reale înainte de publish
const CONTACT_EMAIL = 'apps.tudor@gmail.com';
const SUPPORT_URL = 'https://tudorabrudan.github.io/smartkidtimer-legal/documente/support.html';
const PRIVACY_URL = 'https://tudorabrudan.github.io/smartkidtimer-legal/documente/privacy_ro.html';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const APP_NAME = Constants.expoConfig?.name ?? 'Documente';

// ─── Texte legale ─────────────────────────────────────────────────────────────
const TERMS_TEXT = `TERMENI ȘI CONDIȚII DE UTILIZARE
Versiunea 1.0 – Martie 2025

1. ACCEPTAREA TERMENILOR
Prin utilizarea aplicației ${APP_NAME}, acceptați acești termeni în totalitate. Dacă nu sunteți de acord, vă rugăm să nu utilizați aplicația.

2. DESCRIEREA SERVICIULUI
${APP_NAME} este o aplicație mobilă locală pentru gestionarea documentelor personale (acte de identitate, documente auto, proprietăți, carduri bancare, facturi etc.). Aplicația funcționează exclusiv offline – nu există server, nu există cont de utilizator, nu transmitem date pe internet.

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
${APP_NAME} stochează EXCLUSIV local, pe dispozitivul dumneavoastră:
• Imagini și scan-uri ale documentelor personale
• Date structurate: numere de documente, date de expirare, note personale
• Informații despre entități (persoane, vehicule, proprietăți, carduri)

NU colectăm, NU transmitem și NU stocăm date pe servere externe. Nu există analiză de trafic, nu există reclame, nu există trackere.

3. TEMEIUL JURIDIC
Procesăm datele în baza consimțământului dumneavoastră explicit (art. 6 alin. 1 lit. a GDPR), dat prin instalarea și utilizarea aplicației.

4. CÂT TIMP PĂSTRĂM DATELE
Datele rămân pe dispozitivul dumneavoastră atâta timp cât utilizați aplicația. La dezinstalare, toate datele sunt șterse automat de sistemul de operare.

5. DREPTURILE DUMNEAVOASTRĂ (GDPR)
Aveți dreptul la:
• Acces – toate datele sunt vizibile direct în aplicație
• Rectificare – puteți edita orice dată oricând
• Ștergere – folosiți funcția „Șterge toate datele" din Setări
• Portabilitate – exportați datele ca fișier JSON din funcția Backup
• Opoziție – dezinstalați aplicația

6. BACKUP ÎN CLOUD
Dacă utilizați funcția de export backup, fișierul JSON ajunge în aplicația Files / iCloud Drive / Google Drive conform alegerii dumneavoastră. Politica de confidențialitate a acestor servicii le aparține.

7. SECURITATE
Datele sunt protejate prin:
• Stocare locală (sandbox iOS/Android)
• Opțional: blocare prin Face ID / Touch ID / PIN
• Fișierele nu sunt accesibile altor aplicații

8. CONTACT GDPR
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <RNView style={[styles.legalContainer, { backgroundColor: C.background }]}>
        <RNView style={[styles.legalHeader, { backgroundColor: C.card, borderBottomColor: C.border }]}>
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

  const { customTypes, createCustomType, deleteCustomType } = useCustomTypes();
  const { visibleEntityTypes, visibleDocTypes, updateVisibleEntityTypes, updateVisibleDocTypes } = useVisibilitySettings();
  const [newTypeName, setNewTypeName] = useState('');
  const [notifDays, setNotifDays] = useState(7);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appLockPinModal, setAppLockPinModal] = useState(false);
  const [appLockPin1, setAppLockPin1] = useState('');
  const [appLockPin2, setAppLockPin2] = useState('');
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);

  useEffect(() => {
    settings.getNotificationDays().then(setNotifDays);
    settings.getPushEnabled().then(setPushEnabled);
    settings.getAppLockEnabled().then(setAppLockEnabled);
  }, []);

  // ── App lock ─────────────────────────────────────────────────────────────────
  const handleAppLockToggle = (value: boolean) => {
    if (value) {
      setAppLockPin1('');
      setAppLockPin2('');
      setAppLockPinModal(true);
    } else {
      settings.setAppLockEnabled(false);
      settings.clearAppLockPin();
      setAppLockEnabled(false);
    }
  };

  const handleAppLockPinSubmit = async () => {
    if (appLockPin1.length < 4) {
      Alert.alert('Eroare', 'PIN-ul trebuie să aibă cel puțin 4 cifre.');
      return;
    }
    if (appLockPin1 !== appLockPin2) {
      Alert.alert('Eroare', 'PIN-urile nu coincid.');
      return;
    }
    try {
      await settings.setAppLockPin(appLockPin1);
      await settings.setAppLockEnabled(true);
      setAppLockEnabled(true);
      setAppLockPinModal(false);
      setAppLockPin1('');
      setAppLockPin2('');
      Alert.alert('Activ', 'Aplicația va fi blocată la ieșire sau la redeschidere. Poți folosi Face ID / Touch ID sau PIN.');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut seta');
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
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Export eșuat');
    }
  };

  const handleImportBackup = async () => {
    Alert.alert(
      'Import backup',
      'Vor fi adăugate înregistrări noi (pot apărea duplicate). Continui?',
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Importă',
          onPress: async () => {
            try {
              const { imported, errors } = await importBackup();
              if (errors.length > 0) {
                Alert.alert('Import parțial', `${imported} înregistrări importate.\n\nErori:\n${errors.slice(0, 5).join('\n')}`);
              } else {
                Alert.alert('Succes', `${imported} înregistrări importate cu succes.`);
              }
            } catch (e) {
              if ((e as Error)?.message === 'Anulat') return;
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Import eșuat');
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
    Alert.alert('Șterge tip', `Ștergi tipul „${name}"? Documentele existente vor apărea ca „Tip personalizat".`, [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: () => deleteCustomType(id).catch(() => {}),
      },
    ]);
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

  // ── GDPR ─────────────────────────────────────────────────────────────────────
  const handleDeleteAllData = () => {
    Alert.alert(
      'Atenție',
      'Vrei să ștergi TOATE datele? Aceasta este ireversibilă.',
      [
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
      ]
    );
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      {/* ── Header ── */}
      <RNView style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 8 }]}>
        <RNText style={[styles.headerTitle, { color: C.text }]}>Setări</RNText>
      </RNView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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
              style={[styles.inputSmall, { color: C.text, borderColor: C.border, backgroundColor: C.background }]}
              value={String(notifDays)}
              onChangeText={handleNotifDays}
              keyboardType="number-pad"
              maxLength={2}
            />
          </RNView>
          <RNView style={styles.rowLast}>
            <RNView style={styles.rowLeft}>
              <RNView style={[styles.rowIcon, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="notifications-outline" size={18} color="#2E7D32" />
              </RNView>
              <RNText style={[styles.rowLabel, { color: C.text }]}>Notificări push</RNText>
            </RNView>
            <Switch
              value={pushEnabled}
              onValueChange={handlePushToggle}
              trackColor={{ false: '#ccc', true: '#9EB567' }}
              thumbColor="#fff"
            />
          </RNView>
        </RNView>

        {/* ── Backup ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>BACKUP ȘI RESTAURARE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Exportă datele ca fișier JSON și salvează-l în iCloud Drive sau Files. La schimbarea telefonului, importă fișierul pentru a restaura datele.
          </RNText>
          <Pressable
            style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={handleExportBackup}
          >
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" style={styles.btnIcon} />
            <RNText style={styles.btnText}>Exportă backup (JSON)</RNText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.btnOutline, { borderColor: '#9EB567', opacity: pressed ? 0.85 : 1 }]}
            onPress={handleImportBackup}
          >
            <Ionicons name="cloud-download-outline" size={18} color="#9EB567" style={styles.btnIcon} />
            <RNText style={[styles.btnOutlineText, { color: '#9EB567' }]}>Importă din fișier JSON</RNText>
          </Pressable>
        </RNView>

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
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>Face ID / Touch ID / PIN</RNText>
              </RNView>
            </RNView>
            <Switch
              value={appLockEnabled}
              onValueChange={handleAppLockToggle}
              trackColor={{ false: '#ccc', true: '#9EB567' }}
              thumbColor="#fff"
            />
          </RNView>
        </RNView>

        {/* ── Vizibilitate entități ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>ENTITĂȚI ACTIVE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Alege ce tipuri de entități să apară în aplicație. Entitățile dezactivate nu vor apărea în formulare sau liste.
          </RNText>
          {ALL_ENTITY_TYPES.map((entityType, idx) => {
            const isActive = visibleEntityTypes.includes(entityType);
            const isLast = idx === ALL_ENTITY_TYPES.length - 1;
            return (
              <RNView
                key={entityType}
                style={[
                  isLast ? styles.rowLast : styles.row,
                  { borderBottomColor: C.border },
                ]}
              >
                <RNView style={styles.rowLeft}>
                  <RNView style={[styles.rowIcon, { backgroundColor: isActive ? '#E8F5E9' : '#F5F5F5' }]}>
                    <RNText style={{ fontSize: 16 }}>{ENTITY_ICONS[entityType]}</RNText>
                  </RNView>
                  <RNText style={[styles.rowLabel, { color: C.text }]}>{ENTITY_LABELS[entityType]}</RNText>
                </RNView>
                <Switch
                  value={isActive}
                  onValueChange={() => handleToggleEntityType(entityType)}
                  trackColor={{ false: '#ccc', true: '#9EB567' }}
                  thumbColor="#fff"
                />
              </RNView>
            );
          })}
        </RNView>

        {/* ── Vizibilitate tipuri documente ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>TIPURI DOCUMENTE ACTIVE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Alege ce tipuri de documente să apară în formulare. Tipurile dezactivate nu vor apărea la adăugarea documentelor.
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
                      ? [styles.chipActive, { borderColor: '#9EB567' }]
                      : { borderColor: C.border },
                  ]}
                  onPress={() => handleToggleDocType(docType)}
                >
                  <RNText
                    style={[
                      styles.chipText,
                      { color: isActive ? '#fff' : C.textSecondary },
                    ]}
                  >
                    {DOCUMENT_TYPE_LABELS[docType]}
                  </RNText>
                </Pressable>
              );
            })}
          </RNView>
        </RNView>

        {/* ── Tipuri personalizate de documente ── */}
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>TIPURI PERSONALIZATE DE DOCUMENTE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Adaugă tipuri proprii de documente (ex: „Asigurare viață", „Dosar medical"). Tipurile de entități (Persoană, Vehicul, Proprietate etc.) sunt fixe și nu pot fi modificate.
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
              style={[styles.addTypeInput, { color: C.text, borderColor: C.border, backgroundColor: C.background }]}
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
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>DATE ȘI CONFIDENȚIALITATE</RNText>
        <RNView style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <InfoRow
            icon="shield-checkmark-outline"
            iconBg="#E8F5E9"
            iconColor="#2E7D32"
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
                  100% local pe dispozitiv · fără server
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
            onPress={() => Linking.openURL('itms-apps://itunes.apple.com/app/idYOUR_APP_ID?action=write-review')}
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
                <Ionicons name="folder-outline" size={18} color="#9EB567" />
              </RNView>
              <RNView style={styles.rowLabelWrap}>
                <RNText style={[styles.rowLabel, { color: C.text }]}>{APP_NAME}</RNText>
                <RNText style={[styles.rowSub, { color: C.textSecondary }]}>
                  Gestionare documente personale
                </RNText>
              </RNView>
            </RNView>
            <RNText style={[styles.versionBadge, { color: C.textSecondary, borderColor: C.border }]}>
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
          <RNView style={styles.rowLast}>
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

      {/* ── Modal PIN blocare ── */}
      {appLockPinModal && (
        <RNView style={styles.overlay}>
          <RNView style={[styles.overlayBox, { backgroundColor: C.card }]}>
            <RNText style={[styles.overlayTitle, { color: C.text }]}>Setare PIN blocare</RNText>
            <RNText style={[styles.hint, { color: C.textSecondary }]}>Alege un PIN de 4–8 cifre.</RNText>
            <TextInput
              style={[styles.pinInput, { color: C.text, borderColor: C.border, backgroundColor: C.background }]}
              value={appLockPin1}
              onChangeText={t => setAppLockPin1(t.replace(/\D/g, '').slice(0, 8))}
              placeholder="PIN"
              placeholderTextColor={C.textSecondary}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
            />
            <TextInput
              style={[styles.pinInput, { color: C.text, borderColor: C.border, backgroundColor: C.background }]}
              value={appLockPin2}
              onChangeText={t => setAppLockPin2(t.replace(/\D/g, '').slice(0, 8))}
              placeholder="Confirmă PIN"
              placeholderTextColor={C.textSecondary}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
            />
            <RNView style={styles.overlayBtns}>
              <Pressable
                style={[styles.btnOutline, styles.overlayBtn, { borderColor: '#9EB567' }]}
                onPress={() => { setAppLockPinModal(false); setAppLockPin1(''); setAppLockPin2(''); }}
              >
                <RNText style={[styles.btnOutlineText, { color: '#9EB567' }]}>Anulare</RNText>
              </Pressable>
              <Pressable style={[styles.btn, styles.overlayBtn]} onPress={handleAppLockPinSubmit}>
                <RNText style={styles.btnText}>Salvează</RNText>
              </Pressable>
            </RNView>
          </RNView>
        </RNView>
      )}
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
    backgroundColor: '#9EB567',
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
    backgroundColor: '#9EB567',
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
  chipActive: { backgroundColor: '#9EB567' },
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

  // Modal PIN
  overlay: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlayBox: {
    borderRadius: 20,
    padding: 20,
    width: '100%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  overlayTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  pinInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    letterSpacing: 4,
    marginBottom: 12,
    textAlign: 'center',
  },
  overlayBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  overlayBtn: { flex: 1, marginBottom: 0 },
});
