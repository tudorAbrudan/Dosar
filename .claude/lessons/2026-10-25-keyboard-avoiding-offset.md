---
date: 2026-10-25
tags: [react-native, ios, keyboard, layout, ux, regression]
trigger: ecran cu TextInput lipit de marginea de jos (chat, bară de acțiuni) sau modal transparent cu câmpuri; orice nevoie de KeyboardAvoidingView
---

# `KeyboardAvoidingView` + offset ghicit = câmpul rămâne sub tastatură

## Problemă
În chatul medical (și în chatul general) câmpul de scris era acoperit de tastatură pe iPhone.
Același pattern greșit era în wizard-urile mașină/proprietate și în modalele PIN/parolă cloud.

## Cauză
`KeyboardAvoidingView` (`padding`) calculează suprapunerea din `frame.y` relativ la PĂRINTE,
nu din fereastră. `keyboardVerticalOffset` trebuie să fie exact distanța de la vârful ferestrei
până la părintele lui. Deasupra chatului medical sunt header + tab-uri + rândul persoanei, deci
`tabBarHeight` era valoarea greșită; `ConversationView` nu avea offset deloc. Fiecare ecran
cerea un număr ghicit (header, tab bar) care se strică la prima schimbare de layout.

## Regulă
- Pe iOS folosește `KeyboardSafeView` (`components/ui/KeyboardSafeView.tsx`): măsoară marginea de
  jos reală în fereastră (`measureInWindow`) și o compară cu `keyboardWillChangeFrame`.
  Nu depinde de ce e deasupra sau dedesubt. `FormPageScreen` îl folosește deja.
- Nu mai introduce `KeyboardAvoidingView` cu `keyboardVerticalOffset` ghicit.
- Excepție: modale `pageSheet` (`FormSheetModal`) — coordonatele ferestrei nu se potrivesc cu ale
  tastaturii; acolo `ScrollView` cu `automaticallyAdjustKeyboardInsets`.
- Verificare: deschide tastatura pe device/simulator și vezi că ultimul câmp + butonul de trimitere
  sunt vizibile, pe ecranele cu header, tab-uri sau tab bar deasupra/dedesubt.
