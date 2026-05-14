import { View, Text, TextInput, Pressable, Switch, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

interface ChatFields {
  url: string;
  apiKey: string;
  model: string;
}

interface VisionFields {
  url: string;
  apiKey: string;
  model: string;
}

interface AiExternalProviderConfigProps {
  chat: ChatFields;
  separateVision: boolean;
  vision: VisionFields;
  scheme: 'light' | 'dark';
  /** Apelat după orice modificare în formular (folosit ca să resetăm aiTestStatus). */
  onAnyChange: () => void;
  onChangeChat: (patch: Partial<ChatFields>) => void;
  onChangeVision: (patch: Partial<VisionFields>) => void;
  onToggleSeparateVision: (value: boolean) => void;
}

/**
 * Inputs pentru providerul AI extern (URL/API key/model chat).
 * Conține și toggle „Provider OCR diferit" + inputs vision când e activat.
 *
 * NU citește direct hook-uri — primește totul prin props pentru testabilitate
 * și ca să poată fi reutilizat în modal-uri/wizards.
 */
export function AiExternalProviderConfig({
  chat,
  separateVision,
  vision,
  scheme,
  onAnyChange,
  onChangeChat,
  onChangeVision,
  onToggleSeparateVision,
}: AiExternalProviderConfigProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.container}>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>URL API</Text>
        <TextInput
          style={[
            styles.input,
            { color: C.text, borderColor: C.border, backgroundColor: C.card },
          ]}
          value={chat.url}
          onChangeText={text => {
            onChangeChat({ url: text });
            onAnyChange();
          }}
          placeholder="ex: https://api.mistral.ai/v1"
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
          value={chat.apiKey}
          onChangeText={text => {
            onChangeChat({ apiKey: text });
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
        <Text style={[styles.label, { color: C.textSecondary }]}>Model chat</Text>
        <TextInput
          style={[
            styles.input,
            { color: C.text, borderColor: C.border, backgroundColor: C.card },
          ]}
          value={chat.model}
          onChangeText={text => {
            onChangeChat({ model: text });
            onAnyChange();
          }}
          placeholder="ex: mistral-small-latest"
          placeholderTextColor={C.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <Pressable
        style={[styles.toggleRow, { borderColor: C.border, backgroundColor: C.card }]}
        onPress={() => {
          onToggleSeparateVision(!separateVision);
          onAnyChange();
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.toggleTitle, { color: C.text }]}>Provider OCR diferit</Text>
          <Text style={[styles.hint, { color: C.textSecondary }]}>
            {separateVision
              ? 'OCR / vision folosește alt provider decât chat-ul.'
              : 'OCR și chat folosesc același provider (de mai sus).'}
          </Text>
        </View>
        <Switch
          value={separateVision}
          onValueChange={v => {
            onToggleSeparateVision(v);
            onAnyChange();
          }}
          trackColor={{ false: C.border, true: primary }}
        />
      </Pressable>
      {separateVision && (
        <View style={styles.visionGroup}>
          <Text style={[styles.groupTitle, { color: C.textSecondary }]}>
            Provider OCR / vision
          </Text>
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
              <Text style={styles.bold}>claude-sonnet-4-6</Text> (Anthropic, $5 credit gratuit
              la cont nou), <Text style={styles.bold}>gpt-4o</Text> (OpenAI),{' '}
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
  container: { gap: 12, marginTop: 8 },
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
