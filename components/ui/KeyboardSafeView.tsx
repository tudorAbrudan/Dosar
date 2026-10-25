import { ReactNode, useEffect, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, StyleProp, View, ViewStyle } from 'react-native';

type Props = {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Înlocuiește `KeyboardAvoidingView` pe iOS. KAV calculează suprapunerea cu
 * tastatura din `frame.y` relativ la PĂRINTE, deci cere un `keyboardVerticalOffset`
 * ghicit (header, tab bar, rând de tab-uri…) și greșește de fiecare dată când
 * deasupra lui mai e ceva — câmpul de scris rămânea sub tastatură (chat medical,
 * chat general, wizard-uri).
 *
 * Aici măsurăm marginea de jos reală în fereastră și o comparăm cu vârful
 * tastaturii: nu depinde de ce e deasupra sau dedesubt (header, tab bar).
 * Nu-l folosi în modale `pageSheet` — acolo coordonatele ferestrei nu se
 * potrivesc cu ale tastaturii; folosește `automaticallyAdjustKeyboardInsets`.
 */
export function KeyboardSafeView({ style, children }: Props) {
  const outerRef = useRef<View>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = Keyboard.addListener('keyboardWillChangeFrame', e => {
      const { screenY, height } = e.endCoordinates;
      const { duration } = e;
      outerRef.current?.measureInWindow((_x, y, _w, h) => {
        const overlap = height > 0 ? Math.max(0, y + h - screenY) : 0;
        if (duration > 0) {
          LayoutAnimation.configureNext(LayoutAnimation.create(duration, 'keyboard'));
        }
        setInset(overlap);
      });
    });
    return () => sub.remove();
  }, []);

  return (
    <View ref={outerRef} style={[{ flex: 1 }, style]} collapsable={false}>
      <View style={{ flex: 1, paddingBottom: inset }}>{children}</View>
    </View>
  );
}
