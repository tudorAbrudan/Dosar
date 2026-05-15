/**
 * Card de contact pentru o persoană — telefon + email, cu tap pentru a iniția
 * apel / email și long-press pentru copy în clipboard. Colapsabil, cu iconițe
 * de pre-vizualizare în header când e închis.
 *
 * Extras din `entitati/[id].tsx` (~110 linii inline).
 */
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import Colors from '@/constants/Colors';

interface PersonContactCardProps {
  phone: string | null | undefined;
  email: string | null | undefined;
  expanded: boolean;
  scheme: 'light' | 'dark';
  onToggle: () => void;
}

async function openTel(phone: string) {
  const url = `tel:${phone.replace(/\s+/g, '')}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Eroare', 'Nu s-a putut iniția apelul.');
  }
}

async function openMail(email: string) {
  try {
    await Linking.openURL(`mailto:${email}`);
  } catch {
    Alert.alert('Eroare', 'Nu s-a putut deschide clientul de email.');
  }
}

async function copyValue(value: string, label: string) {
  await Clipboard.setStringAsync(value);
  Alert.alert('Copiat', `${label} a fost copiat în clipboard.`);
}

export function PersonContactCard({
  phone,
  email,
  expanded,
  scheme,
  onToggle,
}: PersonContactCardProps) {
  const C = Colors[scheme];
  const hasContact = Boolean(phone || email);
  if (!hasContact) return null;

  return (
    <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <Pressable onPress={onToggle} style={styles.header} hitSlop={8}>
        <Text style={[styles.title, { color: C.textSecondary }]}>DATE CONTACT</Text>
        <View style={styles.headerRight}>
          {!expanded && (
            <>
              {phone ? (
                <Ionicons
                  name="call-outline"
                  size={14}
                  color={C.textSecondary}
                  style={styles.headerIcon}
                />
              ) : null}
              {email ? (
                <Ionicons
                  name="mail-outline"
                  size={14}
                  color={C.textSecondary}
                  style={styles.headerIcon}
                />
              ) : null}
            </>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={C.textSecondary}
          />
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.body}>
          {phone ? (
            <Pressable
              onPress={() => openTel(phone)}
              onLongPress={() => copyValue(phone, 'Telefonul')}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Ionicons name="call-outline" size={16} color={C.primary} style={styles.icon} />
              <Text style={[styles.value, { color: C.primary }]}>{phone}</Text>
            </Pressable>
          ) : null}
          {email ? (
            <Pressable
              onPress={() => openMail(email)}
              onLongPress={() => copyValue(email, 'Emailul')}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Ionicons name="mail-outline" size={16} color={C.primary} style={styles.icon} />
              <Text style={[styles.value, { color: C.primary }]}>{email}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  title: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: { marginRight: 8 },
  body: { marginTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 4,
  },
  rowPressed: { opacity: 0.6 },
  icon: { marginRight: 8 },
  value: { fontSize: 15 },
});
