import { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, Switch, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, statusColors, onPrimary } from '@/theme/colors';
import {
  hasMedicalMasterKey,
  exportMasterKeyBase64,
  importMasterKeyBase64,
  deleteMedicalMasterKey,
  ensureMedicalMasterKey,
} from '@/services/medicalCrypto';
import {
  getAiMedicalAllowed,
  setAiMedicalAllowed,
  getCloudBackupIncludesMedicalKey,
  setCloudBackupIncludesMedicalKey,
} from '@/services/settings';
import { db } from '@/services/db';

export default function MedicalAiSettings() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [aiAllowed, setAiAllowed] = useState(false);
  const [includeKeyInCloud, setIncludeKeyInCloud] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [recordsCount, setRecordsCount] = useState(0);
  const [exposedKey, setExposedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [allowed, includeKey, keyExists, recordsRow] = await Promise.all([
        getAiMedicalAllowed(),
        getCloudBackupIncludesMedicalKey(),
        hasMedicalMasterKey(),
        db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM medical_record'),
      ]);
      setAiAllowed(allowed);
      setIncludeKeyInCloud(includeKey);
      setHasKey(keyExists);
      setRecordsCount(recordsRow?.c ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleAi = useCallback(async (value: boolean) => {
    setAiAllowed(value);
    try {
      await setAiMedicalAllowed(value);
    } catch (e) {
      setAiAllowed(!value);
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva.');
    }
  }, []);

  const toggleIncludeKey = useCallback(async (value: boolean) => {
    if (value) {
      Alert.alert(
        'Include cheia în backup cloud',
        'Cheia AES va fi inclusă în manifest-ul cloud (criptat apoi cu parola backup-ului). ' +
          'Asta permite restaurarea pe alt device, dar oricine cunoaște parola cloud poate decripta dosarul medical.\n\nContinui?',
        [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Includ',
            onPress: async () => {
              await setCloudBackupIncludesMedicalKey(true);
              setIncludeKeyInCloud(true);
            },
          },
        ]
      );
    } else {
      await setCloudBackupIncludesMedicalKey(false);
      setIncludeKeyInCloud(false);
    }
  }, []);

  const ensureKey = useCallback(async () => {
    try {
      await ensureMedicalMasterKey();
      setHasKey(true);
      Alert.alert('Gata', 'Cheia AES a fost generată.');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut crea cheia.');
    }
  }, []);

  const exportKey = useCallback(async () => {
    try {
      const b64 = await exportMasterKeyBase64();
      setExposedKey(b64);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut exporta.');
    }
  }, []);

  const copyKey = useCallback(async () => {
    if (!exposedKey) return;
    await Clipboard.setStringAsync(exposedKey);
    Alert.alert('Copiat', 'Cheia a fost copiată în clipboard. Lipește-o într-un loc sigur.');
  }, [exposedKey]);

  const importKey = useCallback(() => {
    Alert.prompt?.(
      'Importă cheia',
      'Lipește cheia AES (base64) primită din alt device sau din backup extern. ATENȚIE: va înlocui cheia curentă.',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Importă',
          onPress: async (val?: string) => {
            if (!val || val.trim() === '') return;
            try {
              await importMasterKeyBase64(val.trim());
              setHasKey(true);
              Alert.alert('Gata', 'Cheia a fost importată.');
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Cheia importată e invalidă.');
            }
          },
        },
      ],
      'plain-text'
    );
  }, []);

  const deleteKey = useCallback(() => {
    const warning =
      recordsCount > 0
        ? `Toate datele criptate (${recordsCount} dosar medical${recordsCount > 1 ? 'e' : ''} ` +
          `cu observații și conversații) vor deveni necitite permanent. Continui?`
        : 'Cheia AES va fi ștearsă din SecureStore.';
    Alert.alert('Șterge cheia AES', warning, [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMedicalMasterKey();
            setHasKey(false);
            setExposedKey(null);
            Alert.alert('Gata', 'Cheia a fost ștearsă.');
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge cheia.');
          }
        },
      },
    ]);
  }, [recordsCount]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <Stack.Screen options={{ title: 'AI medical & cheie', headerBackTitle: 'Înapoi' }} />

      {/* ── Toggle global AI medical ── */}
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[styles.label, { color: palette.text }]}>
              Permite AI pentru date medicale
            </Text>
            <Text style={[styles.hint, { color: palette.textSecondary }]}>
              Activează extragerea automată din analize și chat-ul medical. Categorie specială GDPR
              Art. 9 — necesită consimțământ și pe fiecare dosar separat.
            </Text>
          </View>
          <Switch
            value={aiAllowed}
            onValueChange={toggleAi}
            trackColor={{ true: primary, false: palette.border }}
            disabled={loading}
          />
        </View>
      </View>

      {/* ── Cheie AES ── */}
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.statusRow}>
          <Ionicons
            name={hasKey ? 'lock-closed' : 'lock-open-outline'}
            size={20}
            color={hasKey ? primary : statusColors.warning}
          />
          <Text style={[styles.label, { color: palette.text, flex: 1 }]}>Cheie criptare AES</Text>
          <Text
            style={{
              color: hasKey ? primary : statusColors.critical,
              fontWeight: '600',
            }}
          >
            {hasKey ? 'Activă' : 'Lipsă'}
          </Text>
        </View>
        <Text style={[styles.hint, { color: palette.textSecondary, marginTop: 4 }]}>
          Cheia criptează valorile observațiilor și mesajele chat. Generată automat la primul dosar.
          Pierderea ei = pierderea datelor criptate.
        </Text>

        {!hasKey ? (
          <Pressable style={[styles.btnPrimary, { backgroundColor: primary }]} onPress={ensureKey}>
            <Text style={[styles.btnPrimaryText, { color: onPrimary }]}>Generează cheie</Text>
          </Pressable>
        ) : null}

        {hasKey ? (
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.label, { color: palette.text }]}>
                Include cheia în backup cloud
              </Text>
              <Text style={[styles.hint, { color: palette.textSecondary }]}>
                Permite restaurarea pe alt device, dar parola cloud devine punct unic de protecție.
              </Text>
            </View>
            <Switch
              value={includeKeyInCloud}
              onValueChange={toggleIncludeKey}
              trackColor={{ true: primary, false: palette.border }}
            />
          </View>
        ) : null}
      </View>

      {/* ── Export / import / delete ── */}
      {hasKey ? (
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Pressable
            style={[styles.actionRow, { borderBottomColor: palette.border }]}
            onPress={exportKey}
          >
            <Ionicons name="key-outline" size={20} color={palette.text} />
            <Text style={[styles.actionLabel, { color: palette.text }]}>Exportă cheia ca text</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
          </Pressable>

          {Platform.OS === 'ios' ? (
            <Pressable
              style={[styles.actionRow, { borderBottomColor: palette.border }]}
              onPress={importKey}
            >
              <Ionicons name="download-outline" size={20} color={palette.text} />
              <Text style={[styles.actionLabel, { color: palette.text }]}>
                Importă cheie (lipește text)
              </Text>
              <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
            </Pressable>
          ) : null}

          <Pressable style={[styles.actionRow, { borderBottomWidth: 0 }]} onPress={deleteKey}>
            <Ionicons name="trash-outline" size={20} color={statusColors.critical} />
            <Text style={[styles.actionLabel, { color: statusColors.critical }]}>
              Șterge cheia (avansat)
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Cheia exportată ── */}
      {exposedKey ? (
        <View
          style={[
            styles.exposedBox,
            { backgroundColor: palette.surface, borderColor: statusColors.warning },
          ]}
        >
          <View style={styles.statusRow}>
            <Ionicons name="warning-outline" size={20} color={statusColors.warning} />
            <Text style={[styles.label, { color: palette.text, flex: 1 }]}>Cheia ta AES</Text>
            <Pressable onPress={() => setExposedKey(null)}>
              <Ionicons name="close" size={20} color={palette.textSecondary} />
            </Pressable>
          </View>
          <Text style={[styles.hint, { color: palette.textSecondary, marginTop: 4 }]}>
            Salvează acest text într-un loc sigur (1Password, Apple Keychain, foaie tipărită în
            seif). Oricine îl deține poate decripta dosarul medical.
          </Text>
          <Text
            selectable
            style={[styles.keyText, { color: palette.text, backgroundColor: palette.background }]}
          >
            {exposedKey}
          </Text>
          <Pressable style={[styles.btnPrimary, { backgroundColor: primary }]} onPress={copyKey}>
            <Text style={[styles.btnPrimaryText, { color: onPrimary }]}>Copiază în clipboard</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 18 },
  btnPrimary: { marginTop: 12, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnPrimaryText: { fontSize: 14, fontWeight: '600' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: { flex: 1, fontSize: 15 },
  exposedBox: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  keyText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 13,
    padding: 12,
    borderRadius: 6,
    marginTop: 8,
  },
});
