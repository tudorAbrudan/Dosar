import { View, Text, TextInput, Pressable, Switch, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

interface VisionFields {
  url: string;
  apiKey: string;
  model: string;
}

interface AiVisionProviderSectionProps {
  scheme: 'light' | 'dark';
  enabled: boolean;
  vision: VisionFields;
  /**
   * Eticheta toggle-ului. Diferă între `external` („Provider OCR diferit") și
   * `local` („Folosește un provider OCR remote pentru imagini") pentru claritate.
   */
  toggleTitle: string;
  toggleHintEnabled: string;
  toggleHintDisabled: string;
  onAnyChange: () => void;
  onToggle: (value: boolean) => void;
  onChangeVision: (patch: Partial<VisionFields>) => void;
}

/**
 * Secțiune reutilizabilă pentru configurarea unui provider OCR/vision separat.
 * Folosită atât din `AiExternalProviderConfig` (chat extern + vision extern
 * diferit) cât și din `AiConfigModal` când `providerType === 'local'`
 * (chat local + vision remote — singurul mod de a obține vision când modelul
 * local nu îl suportă).
 */
export function AiVisionProviderSection({
  scheme,
  enabled,
  vision,
  toggleTitle,
  toggleHintEnabled,
  toggleHintDisabled,
  onAnyChange,
  onToggle,
  onChangeVision,
}: AiVisionProviderSectionProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.toggleRow, { borderColor: C.border, backgroundColor: C.card }]}
        onPress={() => {
          onToggle(!enabled);
          onAnyChange();
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.toggleTitle, { color: C.text }]}>{toggleTitle}</Text>
          <Text style={[styles.hint, { color: C.textSecondary }]}>
            {enabled ? toggleHintEnabled : toggleHintDisabled}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={v => {
            onToggle(v);
            onAnyChange();
          }}
          trackColor={{ false: C.border, true: primary }}
        />
      </Pressable>
      {enabled && (
        <View style={styles.visionGroup}>
          <Text style={[styles.groupTitle, { color: C.textSecondary }]}>Provider OCR / vision</Text>
          <View>
            <Text style={[styles.label, { color: C.textSecondary }]}>URL</Text>
            <TextInput
              style={[
                styles.input,
                { color: C.text, borderColor: C.border, backgroundColor: C.card },
              ]}
              value={vision.url}
              onChangeText={text => {
                onChangeVision({ url: text });
                onAnyChange();
              }}
              placeholder="ex: https://api.anthropic.com/v1"
              placeholderTextColor={C.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
          <View>
            <Text style={[styles.label, { color: C.textSecondary }]}>Cheie API</Text>
            <TextInput
              style={[
                styles.input,
                { color: C.text, borderColor: C.border, backgroundColor: C.card },
              ]}
              value={vision.apiKey}
              onChangeText={text => {
                onChangeVision({ apiKey: text });
                onAnyChange();
              }}
              placeholder="••••••••••"
              placeholderTextColor={C.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: C.textSecondary }]}>Model</Text>
            <TextInput
              style={[
                styles.input,
                { color: C.text, borderColor: C.border, backgroundColor: C.card },
              ]}
              value={vision.model}
              onChangeText={text => {
                onChangeVision({ model: text });
                onAnyChange();
              }}
              placeholder="ex: claude-haiku-4-5"
              placeholderTextColor={C.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.hint, { color: C.textSecondary, marginTop: 4 }]}>
              Modelul TREBUIE să suporte imagini (vision). Recomandat:{' '}
              <Text style={styles.bold}>claude-haiku-4-5</Text> sau{' '}
              <Text style={styles.bold}>claude-sonnet-4-6</Text> (Anthropic, $5 credit gratuit la
              cont nou), <Text style={styles.bold}>gpt-4o</Text> (OpenAI),{' '}
              <Text style={styles.bold}>pixtral-large-latest</Text> (Mistral, plătit) sau{' '}
              <Text style={styles.bold}>pixtral-12b-2409</Text> (Mistral, free tier).
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 10,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  visionGroup: {
    gap: 12,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: primary,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  bold: { fontWeight: '600' },
});
