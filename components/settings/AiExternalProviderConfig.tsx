import { View, Text, TextInput, Pressable, Switch, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { AiVisionProviderSection } from './AiVisionProviderSection';

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
  chatModelSupportsVision: boolean;
  separateVision: boolean;
  vision: VisionFields;
  scheme: 'light' | 'dark';
  /** Apelat după orice modificare în formular (folosit ca să resetăm aiTestStatus). */
  onAnyChange: () => void;
  onChangeChat: (patch: Partial<ChatFields>) => void;
  onChangeVision: (patch: Partial<VisionFields>) => void;
  onToggleSeparateVision: (value: boolean) => void;
  onToggleChatModelSupportsVision: (value: boolean) => void;
}

/**
 * Inputs pentru providerul AI extern (URL/API key/model chat).
 * Conține:
 *  - toggle „Modelul de chat suportă imagini" — informează app-ul că modelul
 *    chat poate prelua și cereri vision (ex: Pixtral, GPT-4o, Claude). Folosit
 *    de `canDoVision` pentru a decide vizibilitatea butonului „Trimite la AI".
 *  - toggle „Provider OCR diferit" + inputs vision (delegat la
 *    `AiVisionProviderSection`).
 */
export function AiExternalProviderConfig({
  chat,
  chatModelSupportsVision,
  separateVision,
  vision,
  scheme,
  onAnyChange,
  onChangeChat,
  onChangeVision,
  onToggleSeparateVision,
  onToggleChatModelSupportsVision,
}: AiExternalProviderConfigProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.container}>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>URL API</Text>
        <TextInput
          style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.card }]}
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
          style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.card }]}
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
          style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.card }]}
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
          onToggleChatModelSupportsVision(!chatModelSupportsVision);
          onAnyChange();
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.toggleTitle, { color: C.text }]}>
            Modelul de chat suportă imagini
          </Text>
          <Text style={[styles.hint, { color: C.textSecondary }]}>
            {chatModelSupportsVision
              ? 'Modelul de mai sus va fi folosit și pentru OCR / analiza imaginilor.'
              : 'Bifează dacă modelul tău e Pixtral, GPT-4o, Claude sau similar. Necesar pentru a vedea butonul „Trimite documentul la AI".'}
          </Text>
        </View>
        <Switch
          value={chatModelSupportsVision}
          onValueChange={v => {
            onToggleChatModelSupportsVision(v);
            onAnyChange();
          }}
          trackColor={{ false: C.border, true: primary }}
        />
      </Pressable>
      <AiVisionProviderSection
        scheme={scheme}
        enabled={separateVision}
        vision={vision}
        toggleTitle="Provider OCR diferit"
        toggleHintEnabled="OCR / vision folosește alt provider decât chat-ul."
        toggleHintDisabled="OCR și chat folosesc același provider (de mai sus)."
        onAnyChange={onAnyChange}
        onToggle={onToggleSeparateVision}
        onChangeVision={onChangeVision}
      />
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
});
