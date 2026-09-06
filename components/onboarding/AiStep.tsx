/**
 * AI step din OnboardingWizard — alegere provider (builtin / external / local /
 * none), câmpuri pentru external (url, key, model), consent toggle, info card
 * despre extracție AI din documente.
 *
 * Extras din OnboardingWizard.tsx ca să spargem god file-ul (~175 linii JSX).
 */
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { iconColors } from '@/theme/iconColors';
import { radius, spacing } from '@/theme/layout';
import { statusColors } from '@/theme/colors';
import { AI_INFO_URL } from '@/constants/AppLinks';
import * as localModel from '@/services/localModel';
import { useModelDownload } from '@/hooks/useModelDownload';
import type { AiProviderType } from '@/services/aiProvider';
import { LOCAL_MODEL_CATALOG } from '@/services/localModel';
import type { LocalModelEntry } from '@/services/localModel';

// Range afișat derivat din catalog (nu hardcodat) — rămâne corect când se
// adaugă/schimbă modele în LOCAL_MODEL_CATALOG (ex: tiering Gemma 4).
const localModelSizeRange = (() => {
  const bySize = [...LOCAL_MODEL_CATALOG].sort((a, b) => a.sizeBytes - b.sizeBytes);
  const min = bySize[0].sizeLabel.replace('~', '');
  const max = bySize[bySize.length - 1].sizeLabel.replace('~', '');
  return `~${min}–${max}`;
})();

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

// Modelul local e PRIMA opțiune și cea recomandată: datele nu părăsesc telefonul,
// nu există limită de interogări și merge fără internet — potrivit pentru o
// aplicație de documente personale. Descărcarea se poate porni chiar de aici
// (vezi blocul de download de mai jos), nu doar din Setări.
const PROVIDER_OPTIONS: { type: AiProviderType; title: string; desc: string }[] = [
  {
    type: 'local',
    title: 'Model local (recomandat)',
    desc: `Pe device · Privat · Nelimitat · Offline · Descarci ${localModelSizeRange} acum`,
  },
  {
    type: 'builtin',
    title: 'Dosar AI',
    desc: 'Cloud · 10 interogări/zi gratuit · Pornești imediat, fără descărcare',
  },
  {
    type: 'external',
    title: 'Cheie API proprie',
    desc: 'Cloud · Nelimitat · Orice provider compatibil OpenAI (Mistral, OpenAI etc.)',
  },
  {
    type: 'none',
    title: 'Fără AI',
    desc: 'Aplicația funcționează complet offline, fără asistent',
  },
];

/**
 * Modelul propus la onboarding: cel mai MARE compatibil cu device-ul.
 *
 * Mai mult spațiu înseamnă în general mai multă precizie, iar descărcarea nu mai
 * blochează onboarding-ul (continuă în fundal cât timp userul folosește aplicația
 * — vezi services/modelDownload.ts). Compromisul viteză/precizie e scris în
 * descrierea fiecărui model, iar catalogul complet rămâne în Setări → Asistent AI.
 */
function pickRecommendedModel(): LocalModelEntry | null {
  const compatible = localModel.getCompatibleModels();
  if (compatible.length === 0) return null;
  return [...compatible].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
}

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

  // ── Descărcare model local direct din onboarding ──────────────────────────
  // Starea vine din singleton (services/modelDownload.ts), nu din componentă:
  // userul poate apăsa „Continuă" iar descărcarea merge mai departe, urmărită
  // apoi de banner-ul de pe Acasă.
  const [recommended] = useState<LocalModelEntry | null>(() => pickRecommendedModel());
  const download = useModelDownload();
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!recommended) return;
    let cancelled = false;
    localModel
      .isModelDownloaded(recommended.id)
      .then(has => {
        if (!cancelled && has) setInstalled(true);
      })
      .catch(() => {
        // absența fișierului nu e o eroare de raportat userului la onboarding
      });
    return () => {
      cancelled = true;
    };
  }, [recommended, download.active]);

  const isDownloadingThis = download.active && download.modelId === recommended?.id;

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

      {aiProviderChoice === 'local' && (
        <View style={[styles.localBox, { backgroundColor: C.card, borderColor: C.border }]}>
          {!recommended ? (
            <Text style={[styles.aiToggleSub, { color: C.textSecondary }]}>
              Telefonul tău nu îndeplinește cerințele pentru un model local. Alege „Dosar AI" sau
              „Fără AI".
            </Text>
          ) : installed ? (
            <Text style={[styles.localReady, { color: C.text }]}>
              ✓ {recommended.name} e instalat și gata de folosit.
            </Text>
          ) : isDownloadingThis ? (
            <View style={{ gap: spacing.gap }}>
              <Text style={[styles.aiToggleSub, { color: C.textSecondary }]}>
                Se descarcă {recommended.name} — {Math.round(download.downloadedMb)} din{' '}
                {Math.round(download.totalMb)} MB. Poți continua; descărcarea merge mai departe.
              </Text>
              <View style={[styles.progressTrack, { backgroundColor: C.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: C.primary,
                      width: `${Math.round(download.progress * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Pressable onPress={() => void download.cancel()} accessibilityRole="button">
                <Text style={[styles.localCancel, { color: C.textSecondary }]}>Anulează</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: spacing.gap }}>
              <Text style={[styles.aiToggleSub, { color: C.textSecondary }]}>
                {recommended.name} · {recommended.sizeLabel}. Descarcă acum pe Wi-Fi, sau mai târziu
                din Setări → Asistent AI.
              </Text>
              {download.error !== null && (
                <Text style={[styles.localError, { color: statusColors.critical }]}>
                  {download.error}
                </Text>
              )}
              <Pressable
                style={[styles.localBtn, { backgroundColor: C.primary }]}
                onPress={() => void download.start(recommended.id)}
                accessibilityRole="button"
              >
                <Text style={styles.localBtnText}>Descarcă modelul</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

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
              <Text style={[styles.cardTitle, { color: C.text }]}>Extracție AI din documente</Text>
              <Text style={[styles.cardSubtitle, { color: C.textSecondary }]}>
                Textul OCR e trimis automat (dacă e activat). Imaginile se trimit doar la apăsarea
                butonului „Trimite documentul la AI" din formular — niciodată automat.
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
  localBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.cardPadding, marginTop: 4 },
  localBtn: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  localBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  localCancel: { fontSize: 14, textDecorationLine: 'underline', textAlign: 'center' },
  localReady: { fontSize: 15, fontWeight: '600' },
  localError: { fontSize: 13 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
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
