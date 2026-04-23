import { memo, useState, useEffect } from 'react';
import { StyleSheet, Image, Dimensions } from 'react-native';
import Animated, { useAnimatedStyle, interpolate } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@react-navigation/native';

const MAX_HERO_HEIGHT = 260;

type Props = {
  photoUri?: string;
  scrollY: SharedValue<number>;
};

export const VehicleParallaxHero = memo(function VehicleParallaxHero({ photoUri, scrollY }: Props) {
  const { colors } = useTheme();
  const [naturalHeight, setNaturalHeight] = useState<number>(MAX_HERO_HEIGHT);
  const screenWidth = Dimensions.get('window').width;

  useEffect(() => {
    if (!photoUri) return;
    Image.getSize(
      photoUri,
      (w, h) => {
        const scaled = Math.min((h / w) * screenWidth, MAX_HERO_HEIGHT);
        setNaturalHeight(scaled);
      },
      () => setNaturalHeight(MAX_HERO_HEIGHT)
    );
  }, [photoUri, screenWidth]);

  const heroStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      scrollY.value,
      [0, naturalHeight],
      [0, -naturalHeight * 0.5],
      'clamp' as any
    );
    const scale = interpolate(scrollY.value, [-naturalHeight, 0], [1.4, 1], 'clamp' as any);
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  if (!photoUri) return null;

  return (
    <Animated.View
      style={[styles.hero, { height: naturalHeight, backgroundColor: colors.card }, heroStyle]}
      pointerEvents="none"
    >
      <Image
        source={{ uri: photoUri }}
        style={styles.image}
        resizeMode="cover"
        onError={() => setNaturalHeight(0)}
        accessibilityLabel="Poză vehicul"
      />
      <LinearGradient
        colors={['transparent', colors.background]}
        style={styles.gradient}
        pointerEvents="none"
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 40,
  },
});

export { MAX_HERO_HEIGHT };
