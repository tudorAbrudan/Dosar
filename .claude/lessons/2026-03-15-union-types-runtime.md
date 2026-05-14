---
date: 2026-03-15
tags: [typescript, types, runtime]
trigger: Object.keys() returning empty when iterating over a union type
---

# Union types nu există la runtime — declară arrays explicit

## Problemă
Export `ALL_STANDARD_DOC_TYPES` creat cu `Object.keys({} as Record<...>)` returna array gol în loc de lista completă.

## Cauză
Pattern incorect de a extrage cheile dintr-un tip TypeScript la runtime; tipurile nu există la runtime.

## Regulă
Pentru a lista toate valorile unui union type, declară explicit un array constant:

```ts
export const STANDARD_DOC_TYPES: DocumentType[] = ['buletin', 'pasaport', /* ... */];
```

Nu folosi `Object.keys()` pe un Record cu cheie union.

## Aplicabil
`types/index.ts`, orice loc unde se încearcă iterarea unui union type.
