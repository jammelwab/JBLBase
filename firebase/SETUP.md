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

## 3. Cloud Billing API

<https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com?project=jblbase>
→ _Aktivieren_.

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

## 7. Deploy und Rechte für die Kostenbremse

Ohne lokale Installation in der Cloud Shell
(<https://shell.cloud.google.com/?project=jblbase&show=terminal>). Dort ist
man bereits angemeldet, `firebase login` ist nicht nötig.

```sh
git clone https://github.com/jammelwab/JBLBase.git && cd JBLBase/firebase
npm --prefix functions install
npx -y firebase-tools@15 deploy --only firestore,functions --project jblbase
```

Fragen zum Aktivieren von APIs mit `y` beantworten, Aufbewahrung der
Container-Images: `1` Tag.

Einmalig danach: Die Function darf die Abrechnung vom Projekt trennen. Die
Rolle „Projekt-Abrechnungsmanager“ gilt nur für dieses Projekt.

```sh
SA=$(gcloud functions describe budgetGuard --region=europe-west3 --format='value(serviceConfig.serviceAccountEmail)')
gcloud projects add-iam-policy-binding jblbase --member="serviceAccount:$SA" --role=roles/billing.projectManager --condition=None
```

## 8. Kostenbremse prüfen (optional)

1. In `firebase/functions/.env` die Zeile `BUDGET_GUARD_DRY_RUN=true`
   eintragen und erneut `npx firebase deploy --only functions`.
2. <https://console.cloud.google.com/cloudpubsub/topic/list> → `budget-alerts`
   → _Nachricht_ → _Nachricht veröffentlichen_ mit
   `{"costAmount": 10, "budgetAmount": 5}`.
3. Im Log der Function (<https://console.cloud.google.com/functions>) muss
   „Budget exceeded, dry run“ stehen.
4. `.env` wieder löschen und erneut deployen, damit die Bremse scharf ist.

## 9. Anmeldung mit Lichess (Phase 2)

Die Function `lichessLogin` prüft das Lichess-Token und stellt ein
Firebase-Anmeldetoken aus. Nach dem Deploy (wie in Schritt 7) einmalig in
der Cloud Shell:

```sh
gcloud services enable iamcredentials.googleapis.com --project jblbase
SA=$(gcloud functions describe lichessLogin --region=europe-west3 --project jblbase --format='value(serviceConfig.serviceAccountEmail)')
gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" --role=roles/iam.serviceAccountTokenCreator --project jblbase
```

Die Rolle erlaubt dem Dienstkonto nur, für sich selbst Tokens zu signieren.

Optional: <https://console.firebase.google.com/project/jblbase/authentication/emails>
→ Vorlagensprache auf Deutsch stellen (Mails zum Bestätigen und Zurücksetzen).

## 10. Regeln für die Synchronisierung (Phase 3)

Nach dem Merge die neuen Sicherheitsregeln in der Cloud Shell deployen:

```sh
cd ~/JBLBase && git pull && cd firebase && npx -y firebase-tools@15 deploy --only firestore --project jblbase
```

## Später

- **Admin-Rolle:** sobald das eigene Konto existiert (Phase 2). Schlüssel
  unter Projekteinstellungen → _Dienstkonten_ → _Neuen privaten Schlüssel
  generieren_, außerhalb des Repositorys ablegen, dann
  `npm run set-role -- <email> admin` (siehe README).
- **App Check:** kommt, bevor die App Daten hochlädt (Phase 3).

## Freigabeliste (private Cloud)

Die Cloud lässt nur Konten auf der Freigabeliste und Admins herein. Ohne Liste
kommt niemand außer Admins hinein.

1. Firebase-Konsole → **Firestore Database** → **Sammlung starten**:
   Sammlungs-ID `config`, Dokument-ID `access`.
2. Zwei Felder vom Typ **array** anlegen, alle Einträge **kleingeschrieben**:
   - `emails`: E-Mail-Adressen, z. B. `aaron@example.org`
   - `lichess`: Lichess-Benutzernamen, z. B. `aaron123`
3. Speichern. Die Änderung wirkt sofort, ohne neues Deploy.

E-Mail-Konten zählen erst, wenn die Adresse bestätigt ist. Wer sich mit
Lichess anmeldet und nicht auf der Liste steht, bekommt gar kein Konto. Ein
E-Mail-Konto kann technisch jeder anlegen, es kommt aber an keine Daten.

## Eigene E-Mails (Bestätigung, Passwort)

Firebase erlaubt keinen eigenen Text für seine Mails. JBLBase verschickt
Bestätigungs- und Passwort-Mails deshalb selbst per SMTP aus einem normalen
Postfach (Standard: GMX). Texte und Gestaltung stehen in
`functions/src/mail.ts` (Deutsch und Englisch, nach App-Sprache).

1. GMX → **E-Mail** → **Einstellungen** → **POP3/IMAP Abruf** →
   „Senden und Empfangen von E-Mails via externem Programm“ aktivieren und
   speichern. Mit Zwei-Faktor-Schutz: unter **Sicherheit** ein
   anwendungsspezifisches Passwort erzeugen und das statt des normalen
   Passworts verwenden.
2. In der Cloud Shell (Adresse und Passwort nur dort eingeben, nie ins
   Repository):
   ```
   cd ~/JBLBase && git pull && cd firebase/functions && npm ci && cd ..
   npx -y firebase-tools@15 functions:secrets:set SMTP_USER --project jblbase
   npx -y firebase-tools@15 functions:secrets:set SMTP_PASSWORD --project jblbase
   npx -y firebase-tools@15 deploy --only functions --project jblbase
   ```

Anderer Anbieter: Umgebungsvariablen `SMTP_HOST` und `SMTP_PORT` setzen
(Standard `mail.gmx.net`, `587`).

Solange die Functions `sendVerificationMail` und `sendPasswordResetMail`
nicht laufen, schickt die App die Standard-Mails von Firebase. Pro Adresse
geht höchstens eine Mail je Art und Minute raus (`mailLimits` in Firestore,
für die App gesperrt).
