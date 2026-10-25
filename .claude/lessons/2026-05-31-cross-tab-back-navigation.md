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

**Orice `router.push` către `/(tabs)/documente/[id]` sau `/(tabs)/documente/add` din afara tabului Documente trebuie să trimită `from` + `entityId`.**

Valori `from` acceptate de `navigateBackToSource` (`services/backNavigation.ts`, folosit de detaliu — „Înapoi" și după ștergere — și de adăugare — „Înapoi" și după salvare):

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
- Push notification handler, share intent, deep link (`_layout.tsx`, `(tabs)/_layout.tsx`) — nu există source screen; marcate cu `// cross-tab-back-audit-ignore: <motiv>`.
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

## Audit script

Regresia s-a repetat la adăugare (2026-10-25: „Adaugă doc" din ecranul entității, sugestiile din Home, statusul legal al vehiculului — „Înapoi" și salvarea duceau în tabul Acte). De atunci, `scripts/cross-tab-back-audit.js --strict` (în `npm run audit` și pre-commit) verifică orice `router.push/replace/navigate` spre stack-ul Documente din afara tabului: fără `from` → eșec.
