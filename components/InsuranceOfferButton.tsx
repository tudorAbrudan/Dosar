import { memo } from 'react';
import { StyleSheet, Pressable, Text, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { primary } from '@/theme/colors';
import {
  getInsuranceOffer,
  getInsuranceOfferUrl,
  type InsuranceOfferPlacement,
} from '@/services/insuranceOffers';
import type { DocumentType } from '@/types';

/**
 * Link extern spre oferta de reînnoire (asigra.ro) pentru tipurile din
 * `services/insuranceOffers.ts`. Pentru alte tipuri nu randează nimic.
 * - `button`: buton cu contur, pe toată lățimea (fișa documentului).
 * - `link`: rând compact de text, sub un rând de status (vehicul, Expirări).
 */
export const InsuranceOfferButton = memo(function InsuranceOfferButton({
  docType,
  placement,
  variant = 'button',
}: {
  docType: DocumentType;
  placement: InsuranceOfferPlacement;
  variant?: 'button' | 'link';
}) {
  const offer = getInsuranceOffer(docType);
  const url = getInsuranceOfferUrl(docType, placement);
  if (!offer || !url) return null;

  return (
    <Pressable
      onPress={() => {
        Linking.openURL(url).catch(() => undefined);
      }}
      accessibilityRole="link"
      accessibilityLabel={`${offer.label} pe asigra.ro`}
      accessibilityHint="Se deschide în browser"
      hitSlop={variant === 'link' ? 8 : undefined}
      style={({ pressed }) => [
        variant === 'button' ? styles.button : styles.link,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="shield-checkmark-outline" size={16} color={primary} />
      <Text style={[styles.text, variant === 'link' && styles.linkText]} numberOfLines={2}>
        {offer.label} pe asigra.ro
      </Text>
      <Ionicons name="open-outline" size={14} color={primary} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: primary,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
  pressed: { opacity: 0.7 },
  text: { color: primary, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  linkText: { fontSize: 13 },
});
