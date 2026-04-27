import { View, Text, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';

export default function CloudBackupScreen() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  return (
    <View style={[styles.wrap, { backgroundColor: palette.background }]}>
      <Text style={[styles.text, { color: palette.text }]}>În curând: ecran Cloud Backup</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontSize: 16, fontWeight: '600' },
});
