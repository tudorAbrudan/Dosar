---
date: 2026-05-31
tags: [react-native, expo-router, navigation, tabs, ux]
trigger: push către un tab diferit + buton „Înapoi" care nu revine la sursă
---

# Cross-tab `router.push` → trimite ÎNTOTDEAUNA `from` + `entityId`

## Problemă

Tap pe un document din ecranul Timeline al unei entități medicale (sau orice alt loc care nu e tabul Documente) deschidea detaliul documentului. La „Înapoi" utilizatorul ajungea pe **tabul Documente**, nu pe entitatea-sursă.

## Cauză

`router.push('/(tabs)/documente/${id}')` din afara tabului Documente este o navigare cross-tab. Stack-ul tabului Documente primește `[id]` deasupra. `handleBack` din `app/(tabs)/documente/[id].tsx` ramifică pe parametrul `from`:

```ts
if (from === 'medical' && entityId) {
  router.navigate('/(tabs)/documente');
  router.navigate(`/(tabs)/entitati/medical/${entityId}?tab=documente`);
} else {
  router.canGoBack() ? router.back() : router.navigate('/(tabs)/documente');
}
```

Dacă call-site-ul **nu trimite `from`/`entityId`**, codul cade pe fallback → reset stack documente → user vede tabul Documente.

## Regulă

**Orice `router.push` către `/(tabs)/documente/[id]` din afara tabului Documente trebuie să trimită `from` + `entityId`.**

Valori `from` acceptate de `handleBack` (vezi `app/(tabs)/documente/[id].tsx:959-984`):

| `from` | Source screen | `entityId` necesar? |
|---|---|---|
| `'home'` | `app/(tabs)/index.tsx` | nu |
| `'expirari'` | `app/(tabs)/expirari.tsx` | nu |
| `'chat'` | `app/(tabs)/chat.tsx` | nu |
| `'entity'` | `app/(tabs)/entitati/[id].tsx` | da (id entitate) |
| `'medical'` | orice tab din `entitati/medical/[id]/` | da (id record medical) |
| `'medical-chat'` | `MedicalChatBubble.tsx` (citații AI) | da (id record medical) |

Pattern obligatoriu:

```ts
router.push({
  pathname: '/(tabs)/documente/[id]',
  params: { id: docId, from: 'medical', entityId: recordId },
});
```

NU forma scurtă fără params:

```ts
// ❌ pică pe fallback → user vede tabul Documente la Înapoi
router.push(`/(tabs)/documente/${docId}`);
```

Excepții acceptate (intenționat fără `from`):
- Push notification handler (`_layout.tsx`, `(tabs)/_layout.tsx`) — cold start, nu există source screen.
- `DuplicateGroupsCard.onOpenDocument` în `documente/[id].tsx` — navigare în același tab, fallback `router.back()` funcționează.
- `documente/add.tsx` redirect către doc creat — flow de creare, nu există source entity de revenit.

## Aplicabil

Orice feature nou care adaugă un loc de unde se deschide detaliul unui document:
- Card nou pe Home → `from: 'home'`
- Tab nou într-un ecran entity → `from: 'medical'` (sau corespunzător) + `entityId`
- Buton „Vezi sursa" într-un rezumat AI → `from: 'medical'` + `entityId` recordului asociat

Înainte de merge, grep:
```bash
grep -rn "documente/\${" app/ components/ | grep -v "from:"
```
Orice rezultat care nu e în lista de excepții = bug de cross-tab navigation.

## Audit script (candidat)

Pattern detectabil automat: `router.push.*documente/\$\{[^}]+\}` în fișiere care **nu** sunt sub `app/(tabs)/documente/`. Dacă acel call nu are obiect `params` cu `from`, semnal warning. Candidat real pentru `scripts/cross-tab-doc-push-audit.js` dacă se repetă regresia.
