/**
 * AI step din OnboardingWizard — alegere provider (builtin / external / local /
 * none), câmpuri pentru external (url, key, model), consent toggle, info card
 * despre extracție AI din documente.
 *
 * Extras din OnboardingWizard.tsx ca să spargem god file-ul (~175 linii JSX).
 */
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { iconColors } from '@/theme/iconColors';
import { radius, spacing } from '@/theme/layout';
import { AI_INFO_URL } from '@/constants/AppLinks';
import type { AiProviderType } from '@/services/aiProvider';

interface AiStepProps {
  scheme: 'light' | 'dark';
  aiProviderChoice: AiProviderType;
  aiExternalUrl: string;
  aiExternalApiKey: string;
  aiExternalModel: string;
  aiConsentChecked: boolean;
  onChangeProvider: (value: AiProviderType) => void;
  onChangeUrl: (value: string) => void;
  onChangeApiKey: (value: string) => void;
  onChangeModel: (value: string) => void;
  onToggleConsent: () => void;
}

const PROVIDER_OPTIONS: { type: AiProviderType; title: string; desc: string }[] = [
  {
    type: 'builtin',
    title: 'Dosar AI (recomandat)',
    desc: 'Cloud · 20 interogări/zi gratuit · Pornești imediat, fără configurare',
  },
  {
    type: 'external',
    title: 'Cheie API proprie',
    desc: 'Cloud · Nelimitat · Orice provider compatibil OpenAI (Mistral, OpenAI etc.)',
  },
  {
    type: 'local',
    title: 'Model local',
    desc: 'Pe device · Privat · Nelimitat · Offline · Download 800MB–4GB din Setări',
  },
  {
    type: 'none',
    title: 'Fără AI',
    desc: 'Aplicația funcționează complet offline, fără asistent',
  },
];

export function AiStep({
  scheme,
  aiProviderChoice,
  aiExternalUrl,
  aiExternalApiKey,
  aiExternalModel,
  aiConsentChecked,
  onChangeProvider,
  onChangeUrl,
  onChangeApiKey,
  onChangeModel,
  onToggleConsent,
}: AiStepProps) {
  const C = Colors[scheme];

  return (
    <View style={styles.aiBlock}>
      {PROVIDER_OPTIONS.map(option => (
        <Pressable
          key={option.type}
          style={[
            styles.aiToggleCard,
            {
              backgroundColor: C.card,
              borderColor: aiProviderChoice === option.type ? C.primary : C.border,
            },
          ]}
          onPress={() => onChangeProvider(option.type)}
        >
          <View style={styles.aiToggleText}>
            <Text style={[styles.aiToggleLabel, { color: C.text }]}>{option.title}</Text>
            <Text style={[styles.aiToggleSub, { color: C.textSecondary }]}>{option.desc}</Text>
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

      {aiProviderChoice === 'external' && (
        <View style={{ gap: 8, marginTop: 4 }}>
          <TextInput
            style={[
              styles.aiInput,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
            value={aiExternalUrl}
            onChangeText={onChangeUrl}
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
            onChangeText={onChangeApiKey}
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
            onChangeText={onChangeModel}
            placeholder="Model (ex: mistral-small-latest)"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}

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
          onPress={onToggleConsent}
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
            {/* Checkmark intenționat alb pe fundal primary (verde) — theme-neutral. */}
            {/* eslint-disable-next-line local-rules/no-hardcoded-hex-colors */}
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
            <Ionicons name="image-outline" size={20} color={iconColors.amber.fg} />
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
  );
}

const styles = StyleSheet.create({
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
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 16,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, lineHeight: 18 },
  link: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
