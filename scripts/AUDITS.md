# Audit scripts

<!-- GENERAT de `node scripts/audit-index.js` — nu edita manual. -->

Rulează toate: `npm run audit` (plus type-check, characterization tests, ast-grep).
Coloane: `strict` = exit 1 la violare; `warn` = doar raportează; `—` = nu rulează acolo.
Origini și detalii: header-ul fiecărui script. Regresie nouă → audit nou (vezi CLAUDE.md).

| Script | npm run audit | pre-commit | Ce prinde |
|---|---|---|---|
| `backup-audit.js` | strict | strict | Auditor automat pentru sincronizarea backup-ului local + cloud. |
| `check-hardcoded-entities.js` | warn | strict | Detectează hardcode-uri de `EntityType` care ar trebui să folosească sursele unice din `types/index.ts`: |
| `knowledge-audit.js` | strict | strict | Knowledge audit — verifică sincronizarea între cod și `services/appKnowledge.ts` (sursa de adevăr pentru chatbot-ul global). |
| `hook-contract-audit.js` | strict | strict | Verifică că hook-urile din `hooks/*.ts` cu I/O async returnează contractul standard `{loading, error, refresh\|refetch\|reload\|reset}`. |
| `catch-pattern-audit.js` | strict | strict | Detectează `catch(X) { ... X.message ... }` fără guard `X instanceof Error`. |
| `alter-table-trycatch-audit.js` | strict | strict | Verifică că fiecare `ALTER TABLE` din `services/db.ts` e într-un bloc `try`. |
| `db-destructive-init-audit.js` | strict | strict | Detectează în `services/db.ts` `DROP TABLE [IF EXISTS] X` aplicat pe un tabel `X` care e și `CREATE TABLE IF NOT EXISTS X` în același fișier — pattern care șterge datele userului la FIECARE pornire de app (drop urmat… |
| `modal-input-audit.js` | strict | strict | Flag `<Modal transparent>` care conține `<TextInput>`, `<Switch>`, `<DatePickerField>` sau `<Picker>` — regresie cunoscută: |
| `double-modal-audit.js` | warn | warn | Flag fișiere TSX care randează ≥2 componente Modal-like cu `visible={...}` ca siblings în aceeași componentă React. |
| `alert-modal-race-audit.js` | strict | strict | Flag pattern-ul: `Alert.alert(..., [{ onPress: () => setXxxVisible(true) }])` — adică un buton de Alert care încearcă să prezinte imediat un `<Modal>`. |
| `sheet-header-audit.js` | strict | strict | Flag header-uri de modal/sheet construite de mână, cu butoane-text „Anulează" / „Salvează" / „Aplică" / „Confirmă" în JSX. |
| `cropper-flow-audit.js` | strict | strict | Invariant: orice ecran care lasă utilizatorul să aleagă o imagine din Galerie sau Din Fișiere trebuie să o treacă prin ecranul /cropper (`cropImage` din `services/cropperBridge.ts`) înainte de a o salva ca pagină de d… |
| `entity-doc-links-audit.js` | strict | strict | Flag query-urile care caută documentele unei entități DOAR prin coloana legacy `documents.<tip>_id`, fără să se uite și în junction table-ul `document_entities`. |
| `cloudkit-field-names-audit.js` | strict | strict | Flag numele de câmp / tip de record CloudKit construite DIN DATE (template literal cu interpolare) în layer-ul de partajare. |
| `expo-public-secrets-audit.js` | strict | warn | Flag variabile `EXPO_PUBLIC_*` cu nume care sugerează secret (KEY, TOKEN, SECRET, PASSWORD, APIKEY, PRIVKEY). |
| `pin-secure-store-audit.js` | strict | strict | Flag `AsyncStorage.{set,get,remove}Item` cu chei care conțin `pin`, `biometric`, `password`, `secret`, `lock`. |
| `medical-ai-summary-isolation-audit.js` | strict | strict | Audit script — verifică că `ai_summary` și `pending_reminders_json` NU apar în fișierele care construiesc context pentru chat-ul medical sau FTS. |
| `medical-ai-guard-audit.js` | strict | strict | Plasă de siguranță pentru privacy AI (Faza 3, 2026-07-04; strâns 2026-10-13). |
| `share-privacy-audit.js` | strict | — | Păzește granița de privacy a partajării entităților între conturi (CloudKit). |
| `share-scope-audit.js` | strict | — | Păzește gate-ul de permisiune la push-back-ul participantului (CloudKit sharing, Faza 2). |
| `silent-ai-catch-audit.js` | strict | strict | Audit script — flag-uiește pattern-ul `catch (e) { console.warn(...) }` în jurul apelurilor AI (sendAiRequest, sendAiRequestWithImage, callMistral etc.) fără surfacing vizibil (Alert/Toast/inline UI). |
| `ai-vision-payload-audit.js` | strict | strict | Audit script — flag-uiește imagini citite BRUT de pe disc și trimise la AI vision, în loc să treacă prin `loadPageBase64ForAi` / `compressImageToBase64ForAi`. |
| `classifier-divergence-audit.js` | strict | strict | Audit script — verifică că regex-ul rapid `detectDocumentType` din `services/ocr.ts` și prompt-ul AI clasificator din `services/aiClassifier.ts` / `services/aiTypeRegistry.ts` returnează același tip pentru fixture-uri… |
| `calendar-event-consistency-audit.js` | strict | strict | Audit — verifică că toate apelurile `createEventAsync` / `updateEventAsync` din `services/calendar.ts` includ câmpurile obligatorii pentru consistență (regulă din `docs/AI_FEATURE_CHECKLIST.md` §5): |
| `model-background-release-audit.js` | strict | strict | Garantează că modelul LLM local (context llama.rn, câțiva GB rezidenți în RAM) este eliberat când app-ul intră în background. |
| `manifest-shrink-guard-audit.js` | strict | strict | Orice cale care suprascrie `manifest.json` din iCloud (`writeFile(MANIFEST_PATH, …)`) trebuie să treacă prin `detectManifestShrink` + `preserveManifestBeforeShrink`. |
| `unique-filename-audit.js` | strict | strict | Flag nume de fișier din `documents/` construite doar din `Date.now()` (`doc_${Date.now()}.jpg\|pdf`). |
| `share-intent-fallback-audit.js` | strict | strict | iOS 27 livrează aplicației URL-ul extensiei de share ca `acte:///` (fără cheia `dataUrl=` și fără `#media\|#file`), deci doar `+native-intent.ts` / URL-ul din expo-share-intent nu mai pornesc „Adaugă document" (regresi… |
| `claude-config-audit.js` | strict | strict | Verifică config-ul Claude Code din `.claude/` + CLAUDE.md: |
| `bump-version.js` | strict | warn | Bump de versiune Dosar în TOATE locurile din care Xcode / App Store citesc versiunea: |
| `file-size-audit.js` | warn | — | Listează fișiere `.ts`/`.tsx` din services/, hooks/, components/, app/ care depășesc pragul de linii. |
| `worktree-age-audit.js` | warn | — | Listează `git worktree`-uri mai vechi de 14 zile (ultimul commit pe HEAD). |
| `reminder-consistency-audit.js` | — | warn | Flag funcții din `services/documents.ts` care modifică `expiry_date` fără a apela `syncDocumentExpiryReminder` / `removeDocumentExpiryReminder` (reminder-ul rămâne pe data veche sau orfan). |
