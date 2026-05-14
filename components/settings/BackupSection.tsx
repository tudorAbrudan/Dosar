import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { InfoRow } from './InfoRow';

interface BackupSectionProps {
  collapsed: boolean;
  exporting: boolean;
  importing: boolean;
  scheme: 'light' | 'dark';
  onToggleCollapsed: () => void;
  onOpenCloudBackup: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function BackupSection({
  collapsed,
  exporting,
  importing,
  scheme,
  onToggleCollapsed,
  onOpenCloudBackup,
  onExport,
  onImport,
}: BackupSectionProps) {
  const C = Colors[scheme];
  return (
    <>
      <Pressable style={styles.header} onPress={onToggleCollapsed}>
        <Text style={[styles.label, { color: C.textSecondary }]}>BACKUP ȘI RESTAURARE</Text>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={14}
          color={C.textSecondary}
        />
      </Pressable>
      {!collapsed && (
        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <InfoRow
            icon="cloud-outline"
            iconBg="#E8F5E9"
            iconColor={primary}
            label="iCloud Backup"
            sub="Backup automat în iCloud Drive"
            onPress={onOpenCloudBackup}
            scheme={scheme}
          />
          <Text style={[styles.hint, { color: C.textSecondary }]}>
            Exportă toate datele și pozele ca fișier ZIP și salvează-l în iCloud Drive sau Files.
            La schimbarea telefonului, importă fișierul pentru a restaura complet datele și pozele.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, { opacity: pressed || exporting ? 0.85 : 1 }]}
            onPress={onExport}
            disabled={exporting}
            accessibilityLabel="Exportă backup ZIP"
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#fff" style={styles.btnIcon} />
            ) : (
              <Ionicons
                name="cloud-upload-outline"
                size={18}
                color="#fff"
                style={styles.btnIcon}
              />
            )}
            <Text style={styles.btnText}>
              {exporting ? 'Se exportă...' : 'Exportă backup (ZIP)'}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.btnOutline,
              { borderColor: primary, opacity: pressed || importing ? 0.85 : 1 },
            ]}
            onPress={onImport}
            disabled={importing}
            accessibilityLabel="Importă din fișier backup"
          >
            {importing ? (
              <ActivityIndicator size="small" color={primary} style={styles.btnIcon} />
            ) : (
              <Ionicons
                name="cloud-download-outline"
                size={18}
                color={primary}
                style={styles.btnIcon}
              />
            )}
            <Text style={[styles.btnOutlineText, { color: primary }]}>
              {importing ? 'Se importă...' : 'Importă din fișier backup'}
            </Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
    marginRight: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flex: 1,
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
});
