# Einrichtung in der Konsole (Phase 0)

Einmalige Schritte im Firebase- und Google-Cloud-Konto. Reihenfolge
einhalten: zuerst Budget und Kostenbremse, dann alles andere.

`<PROJEKT-ID>` ist die ID des Firebase-Projekts (steht in den
Projekteinstellungen, z. B. `jblbase-1a2b3`).

## 1. Projekt

1. <https://console.firebase.google.com> öffnen, Projekt anlegen oder das
   vorhandene wählen. Google Analytics wird nicht gebraucht.
2. Unten links muss **Blaze** stehen. Sonst: _Upgrade_ und das
   Rechnungskonto wählen.

## 2. Budget mit Pub/Sub-Thema

1. <https://console.cloud.google.com/billing/budgets> öffnen, das
   Rechnungskonto wählen, _Budget erstellen_.
2. **Umfang:** nur das Projekt `<PROJEKT-ID>`.
3. **Betrag:** Festgelegter Betrag, **5 €** pro Monat.
4. **Grenzwerte:** 50 %, 90 %, 100 % der tatsächlichen Kosten.
5. **Benachrichtigungen:** E-Mail an Abrechnungsadministratoren an lassen.
   Häkchen bei _Pub/Sub-Thema mit diesem Budget verbinden_, Projekt
   `<PROJEKT-ID>` wählen, _Thema erstellen_ mit dem Namen
   **`budget-alerts`**.
6. Speichern.

## 3. Rechte für die Kostenbremse

Die Kostenbremse läuft als Standard-Dienstkonto
`<PROJEKTNUMMER>-compute@developer.gserviceaccount.com` (die Projektnummer
steht in den Projekteinstellungen).

1. Cloud Billing API einschalten:
   <https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com>
   → _Aktivieren_.
2. <https://console.cloud.google.com/billing> → Rechnungskonto →
   _Kontoverwaltung_ → _Hauptkonto hinzufügen_: das Dienstkonto oben, Rolle
   **Rechnungskontoadministrator**. Nur damit darf es die Abrechnung vom
   Projekt trennen.

## 4. Firestore

1. <https://console.firebase.google.com/project/_/firestore> → _Datenbank
   erstellen_.
2. **Standort: `europe-west3 (Frankfurt)`.** Lässt sich später nicht ändern.
3. _Im Produktionsmodus starten_. Die echten Regeln kommen mit dem Deploy.

## 5. Anmeldung

<https://console.firebase.google.com/project/_/authentication/providers> →
_Jetzt starten_ → **E-Mail/Passwort** aktivieren. Lichess folgt in Phase 2
über eine Cloud Function.

## 6. Web-App-Konfiguration

1. Projekteinstellungen → _Meine Apps_ → Web-App hinzufügen (`</>`), Name
   `JBLBase`, kein Hosting.
2. Den angezeigten `firebaseConfig`-Block (apiKey, authDomain, projectId,
   appId …) in den Chat kopieren. Diese Werte sind öffentlich und kommen
   ins Repository. **Keine Dienstkonto-Schlüssel** in den Chat oder ins
   Repository.

## 7. Deploy von Regeln und Kostenbremse

Am eigenen Rechner, im Repository-Ordner (Node.js 22 nötig,
<https://nodejs.org>):

```sh
cd firebase
npm install
npm --prefix functions install
npx firebase login
npx firebase use default       # Projekt jblbase
npx firebase deploy --only firestore,functions
```

Fragt der Deploy nach dem Aktivieren von APIs (Cloud Functions, Cloud
Build, Artifact Registry, Eventarc, Pub/Sub), jeweils mit **Ja** bestätigen.

## 8. Kostenbremse prüfen (optional)

1. In `firebase/functions/.env` die Zeile `BUDGET_GUARD_DRY_RUN=true`
   eintragen und erneut `npx firebase deploy --only functions`.
2. <https://console.cloud.google.com/cloudpubsub/topic/list> → `budget-alerts`
   → _Nachricht_ → _Nachricht veröffentlichen_ mit
   `{"costAmount": 10, "budgetAmount": 5}`.
3. Im Log der Function (<https://console.cloud.google.com/functions>) muss
   „Budget exceeded, dry run“ stehen.
4. `.env` wieder löschen und erneut deployen, damit die Bremse scharf ist.

## Später

- **Admin-Rolle:** sobald das eigene Konto existiert (Phase 2). Schlüssel
  unter Projekteinstellungen → _Dienstkonten_ → _Neuen privaten Schlüssel
  generieren_, außerhalb des Repositorys ablegen, dann
  `npm run set-role -- <email> admin` (siehe README).
- **App Check:** wird zusammen mit der Anmeldung in der App eingeschaltet
  (Phase 2).
