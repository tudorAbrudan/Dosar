/**
 * Card-ul „vehicul cu fotografie" în lista de entități — folosește poza din
 * `photo_uri` ca background și overlay gradient negru pentru contrast text.
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { LONG_PRESS_DELAY_MS } from '@/components/DraggableEntityList';
import { toFileUri } from '@/services/fileUtils';

interface VehiclePhotoCardProps {
  photoUri: string;
  name: string;
  plateNumber?: string | null;
  isActive: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function VehiclePhotoCard({
  photoUri,
  name,
  plateNumber,
  isActive,
  onPress,
  onLongPress,
}: VehiclePhotoCardProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_DELAY_MS}
      android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, isActive && styles.active]}
    >
      <Image
        source={{ uri: toFileUri(photoUri) }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {plateNumber ? (
          <Text style={styles.plate} numberOfLines={1}>
            {plateNumber}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    justifyContent: 'flex-end',
    padding: 12,
    // Vehicle photo overlay este intenționat dark; text alb peste poză.
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    backgroundColor: '#000',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  active: { opacity: 0.95 },
  text: { position: 'relative', zIndex: 1 },
  name: {
    fontSize: 16,
    fontWeight: '600',
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    color: '#fff',
  },
  plate: {
    fontSize: 12,
    marginTop: 2,
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    color: 'rgba(255,255,255,0.85)',
  },
});
