/**
 * Texte legale (Termeni & Confidențialitate) — folosite în modaluri din Setări.
 *
 * Fabrică ce primește valori variabile (app name, email contact, privacy URL)
 * și returnează textele complete. Versiunea — bump-uită manual când conținutul
 * se modifică (vezi App Store metadata și docs/support.html).
 */

export const LEGAL_VERSION = '1.2';
export const LEGAL_DATE = 'Octombrie 2026';

export interface LegalTextDeps {
  appName: string;
  contactEmail: string;
  privacyUrl: string;
}

export function buildTermsText({ appName, contactEmail }: LegalTextDeps): string {
  return `TERMENI ȘI CONDIȚII DE UTILIZARE
Versiunea ${LEGAL_VERSION} – ${LEGAL_DATE}

1. ACCEPTAREA TERMENILOR
Prin utilizarea aplicației ${appName}, acceptați acești termeni în totalitate. Dacă nu sunteți de acord, vă rugăm să nu utilizați aplicația.

2. DESCRIEREA SERVICIULUI
${appName} este o aplicație mobilă pentru gestionarea documentelor personale (acte de identitate, documente auto, proprietăți, carduri bancare, facturi etc.). Aplicația funcționează local-first – datele sunt stocate exclusiv pe dispozitivul dumneavoastră, fără cont online.

ASISTENT AI OPȚIONAL: Aplicația include un asistent bazat pe inteligență artificială. Cu modelul local, totul rulează pe telefon și nimic nu pleacă de pe dispozitiv. Cu un serviciu AI în cloud („Dosar AI" sau o cheie API proprie), după acordul dumneavoastră explicit, anumite date (textul recunoscut din documente, întrebările din chat, denumiri entități, tipuri documente, date de expirare și emitere, note, date de identificare ale documentelor) sunt transmise către serviciul AI configurat pentru procesare. Utilizarea asistentului AI este complet opțională; restul aplicației funcționează 100% offline.

3. UTILIZARE PERMISĂ
Aplicația este destinată exclusiv uzului personal și familial. Nu este permisă utilizarea comercială fără acordul scris al dezvoltatorului.

4. RESPONSABILITATE
Aplicația este furnizată „ca atare". Nu garantăm că aplicația va fi lipsită de erori. Utilizatorul este responsabil pentru efectuarea regulată de backup-uri ale datelor. Datele stocate sunt responsabilitatea exclusivă a utilizatorului.

5. PROPRIETATE INTELECTUALĂ
Aplicația și codul sursă sunt proprietatea dezvoltatorului. Pictogramele și fonturile sunt utilizate conform licențelor respective.

6. BACKUP ȘI DATE
Recomandăm exportul periodic al datelor folosind funcția Backup. Nu ne asumăm responsabilitatea pentru pierderea datelor cauzată de dezinstalarea aplicației, resetarea dispozitivului sau defecțiuni hardware.

7. MODIFICĂRI
Acești termeni pot fi actualizați. Versiunea curentă este disponibilă în aplicație și pe site-ul nostru.

8. CONTACT
Pentru orice întrebare: ${contactEmail}`;
}

export function buildPrivacyText({ appName, contactEmail, privacyUrl }: LegalTextDeps): string {
  return `POLITICĂ DE CONFIDENȚIALITATE (GDPR)
Versiunea ${LEGAL_VERSION} – ${LEGAL_DATE}

1. IDENTITATEA OPERATORULUI
${appName} este dezvoltată și operată de Tudor Abrudan, România.
Contact: ${contactEmail}

2. CE DATE COLECTĂM ȘI UNDE LE STOCĂM
${appName} stochează local, pe dispozitivul dumneavoastră:
• Imagini și scan-uri ale documentelor personale
• Date structurate: numere de documente, date de expirare, note personale
• Informații despre entități (persoane, vehicule, proprietăți, carduri)

Nu există cont de utilizator și niciun server nu stochează datele dumneavoastră. Singura componentă server a aplicației este intermediarul pentru „Dosar AI" (vezi secțiunea 3), care nu păstrează conținutul cererilor. Nu există analiză de trafic, nu există reclame, nu există trackere.

3. ASISTENT AI OPȚIONAL
Asistentul AI (chat și completarea câmpurilor din documente) este opțional. Îl alegeți din Setări → Asistent AI:
• Model local – rulează pe telefon; nimic nu pleacă de pe dispozitiv.
• Dosar AI – cererile trec printr-un server intermediar operat de noi, găzduit în Uniunea Europeană (Falkenstein, Germania), care le transmite către Mistral AI. Serverul nu stochează documentele, textul sau răspunsurile și nu păstrează jurnale ale conținutului.
• Cheie API proprie – cererile pleacă direct de pe telefon la providerul ales de dumneavoastră.
• Fără AI – nu se trimite nimic.

Ce se poate trimite (doar în modurile din cloud, după acordul dumneavoastră explicit): textul recunoscut din documente, întrebările din chat, denumiri entități (persoane, vehicule, proprietăți, carduri, animale, firme), tipuri documente, date de expirare și emitere, note, date de identificare (serie acte, CNP, nr. înmatriculare, nr. înregistrare și alte câmpuri completate).
Fotografia documentului se trimite doar când o cereți explicit: butonul „Trimite documentul la AI" sau scanarea unui bon de carburant / a unei facturi de utilități. Dacă ați activat citirea imaginilor în cloud pentru modelul local, aceste fotografii pleacă la providerul configurat acolo.
Ce NU se trimite niciodată: câmpul „Notă privată", PIN-ul aplicației, numărul CVV al cardurilor.
Documentele medicale (date de categorie specială, art. 9 GDPR) se folosesc cu AI doar cu acordul explicit dat separat pe fiecare dosar medical.
Datele trimise sunt procesate de providerul AI conform propriei politici (pentru Dosar AI: politica de confidențialitate și DPA Mistral AI).

4. TEMEIUL JURIDIC
Procesăm datele în baza consimțământului dumneavoastră explicit (art. 6 alin. 1 lit. a GDPR). Pentru asistentul AI în cloud, consimțământul este solicitat explicit la configurare; pentru datele medicale, separat pe fiecare dosar (art. 9 alin. 2 lit. a GDPR).

5. CÂT TIMP PĂSTRĂM DATELE
Datele rămân pe dispozitivul dumneavoastră atâta timp cât utilizați aplicația. La dezinstalare, toate datele sunt șterse automat de sistemul de operare. Datele transmise asistentului AI sunt procesate de providerul AI ales conform propriei politici de retenție.

6. DREPTURILE DUMNEAVOASTRĂ (GDPR)
Aveți dreptul la:
• Acces – toate datele sunt vizibile direct în aplicație
• Rectificare – puteți edita orice dată oricând
• Ștergere – folosiți funcția „Șterge toate datele" din Setări
• Portabilitate – exportați datele ca fișier ZIP din funcția Backup
• Reconfigurare / dezactivare asistent AI – Setări → Asistent AI
• Opoziție – dezinstalați aplicația

7. BACKUP ÎN CLOUD
Dacă utilizați funcția de export backup, fișierul ZIP ajunge în aplicația Files / iCloud Drive / Google Drive conform alegerii dumneavoastră. Politica de confidențialitate a acestor servicii le aparține.

8. SECURITATE
Datele sunt protejate prin:
• Stocare locală (sandbox iOS/Android)
• Opțional: blocare prin Face ID / Touch ID / PIN
• Fișierele nu sunt accesibile altor aplicații

9. CONTACT GDPR
Pentru exercitarea drepturilor GDPR sau orice întrebare:
Email: ${contactEmail}
Site: ${privacyUrl}`;
}
