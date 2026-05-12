import { View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';

interface Props {
  /** Cronologic ASC (vechi → recent). */
  values: { value: string | null }[];
  height?: number;
}

/**
 * Sparkline minimal cu bare (fără dependență de svg). Pentru o variantă mai
 * fidelă (linie + puncte), folosește react-native-svg dacă va fi adăugat în
 * deps. Bare neutre — NU colorăm valori out-of-range (decis în spec §7.3).
 */
export function ObservationSparkline({ values, height = 32 }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const nums = values
    .map(v => parseFloat(String(v.value ?? '').replace(',', '.')))
    .filter(n => !Number.isNaN(n));

  if (nums.length < 2) {
    return <View style={{ height }} />;
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;

  return (
    <View
      style={{
        height,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 2,
        marginVertical: 4,
      }}
    >
      {nums.map((n, i) => {
        const h = Math.max(2, ((n - min) / range) * height);
        return (
          <View
            key={i}
            style={{
              flex: 1,
              height: h,
              backgroundColor: palette.text,
              opacity: 0.55,
              borderRadius: 1,
            }}
          />
        );
      })}
    </View>
  );
}
