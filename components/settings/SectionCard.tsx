import { Children, Fragment, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';

interface SectionCardProps {
  title: string;
  scheme: 'light' | 'dark';
  /** Text explicativ, primul lucru din card. */
  description?: string;
  /** Notă sub card, pe fundalul ecranului. */
  footer?: string;
  /** Pliabilă: arată doar titlul + săgeata până la apăsare. Pornește închisă. */
  collapsible?: boolean;
  children: React.ReactNode;
}

/**
 * Secțiunea standard din Setări: titlu în UPPERCASE deasupra, card cu umbră ușoară,
 * rânduri (`InfoRow` sau conținut propriu) despărțite automat de o linie fină.
 *
 * Toate secțiunile trec pe aici, inclusiv cele pliabile (Aspect, Notificări,
 * Entități active...): înainte fiecare pliabilă își desena propriul antet și card,
 * cu umbre și spațieri ușor diferite.
 */
export function SectionCard({
  title,
  scheme,
  description,
  footer,
  collapsible,
  children,
}: SectionCardProps) {
  const C = Colors[scheme];
  const [open, setOpen] = useState(!collapsible);
  const rows = Children.toArray(children);

  return (
    <>
      {collapsible ? (
        <Pressable
          style={({ pressed }) => [styles.header, pressed && styles.pressed]}
          onPress={() => setOpen(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
        >
          <Text style={[styles.label, styles.labelFlex, { color: C.textSecondary }]}>{title}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.textSecondary} />
        </Pressable>
      ) : (
        <Text style={[styles.label, styles.labelStatic, { color: C.textSecondary }]}>{title}</Text>
      )}
      {open && (
        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          {description ? (
            <Text style={[styles.description, { color: C.textSecondary }]}>{description}</Text>
          ) : null}
          {rows.map((row, i) => (
            <Fragment key={i}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: C.border }]} />}
              {row}
            </Fragment>
          ))}
        </View>
      )}
      {open && footer ? (
        <Text style={[styles.footer, { color: C.textSecondary }]}>{footer}</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  pressed: { opacity: 0.6 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  labelFlex: { flex: 1 },
  labelStatic: { marginTop: 20, marginBottom: 8, marginLeft: 4 },
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
  description: { fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 12 },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 4, paddingHorizontal: 4 },
});
