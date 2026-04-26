import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Text } from '@/components/Themed';
import { primary } from '@/theme/colors';

interface Props {
  values: number[]; // L/100km, ordonate cronologic (vechi → nou)
  averageL100?: number;
  cardColor: string;
  textSecondary: string;
}

const W = 320;
const H = 110;
const PAD_X = 12;
const PAD_Y = 14;

export function FuelConsumptionChart({ values, averageL100, cardColor, textSecondary }: Props) {
  if (values.length < 2) {
    return (
      <View style={[styles.card, { backgroundColor: cardColor }]}>
        <Text style={[styles.headerLabel, { color: textSecondary }]}>Consum mediu</Text>
        <Text style={styles.value}>
          {averageL100 !== undefined ? averageL100.toFixed(1) : 'N/A'}
          <Text style={[styles.unit, { color: textSecondary }]}> L/100km</Text>
        </Text>
        <Text style={[styles.empty, { color: textSecondary }]}>
          Adaugă mai multe plinuri pentru graficul evoluției.
        </Text>
      </View>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (W - PAD_X * 2) / (values.length - 1) : 0;

  const points = values.map((v, i) => ({
    x: PAD_X + i * stepX,
    y: PAD_Y + ((max - v) / range) * (H - PAD_Y * 2),
  }));

  const linePath = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  const areaPath = `${linePath} L ${last.x} ${H - PAD_Y / 2} L ${first.x} ${H - PAD_Y / 2} Z`;

  return (
    <View style={[styles.card, { backgroundColor: cardColor }]}>
      <View style={styles.header}>
        <Text style={[styles.headerLabel, { color: textSecondary }]}>Consum mediu</Text>
        {averageL100 !== undefined && (
          <Text style={styles.value}>
            {averageL100.toFixed(1)}
            <Text style={[styles.unit, { color: textSecondary }]}> L/100km</Text>
          </Text>
        )}
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="fuelGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={primary} stopOpacity="0.35" />
            <Stop offset="1" stopColor={primary} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d={areaPath} fill="url(#fuelGradient)" />
        <Path d={linePath} stroke={primary} strokeWidth="2.5" fill="none" />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r="3" fill={primary} />
        ))}
      </Svg>
      <View style={styles.footer}>
        <Text style={[styles.axisLabel, { color: textSecondary }]}>min {min.toFixed(1)}</Text>
        <Text style={[styles.axisLabel, { color: textSecondary }]}>
          ultimele {values.length} plinuri
        </Text>
        <Text style={[styles.axisLabel, { color: textSecondary }]}>max {max.toFixed(1)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  headerLabel: {
    fontSize: 13,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    color: primary,
  },
  unit: {
    fontSize: 12,
    fontWeight: '400',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    backgroundColor: 'transparent',
  },
  axisLabel: {
    fontSize: 11,
  },
  empty: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 6,
  },
});
