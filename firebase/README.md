# JBLBase Cloud (Firebase)

Backend für den Cloud-Sync. Die App bleibt ohne Anmeldung voll nutzbar,
die Cloud schaltet nur den Sync ein.

| Datei                  | Inhalt                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `firebase.json`        | Firestore in `europe-west3` (Frankfurt), Functions                                                           |
| `firestore.rules`      | Sicherheitsregeln (Bereiche, Rollen, Tiefengrenze)                                                           |
| `functions/`           | Cloud Functions: Kostenbremse `budgetGuard`, Lichess-Anmeldung `lichessLogin`, Konto löschen `deleteAccount` |
| `scripts/set-role.mjs` | Admin-Rolle vergeben oder entziehen                                                                          |
| `tests/rules.test.mjs` | Tests der Sicherheitsregeln gegen den Emulator                                                               |

## Datenmodell

| Pfad                                                | Wer liest         | Wer schreibt                                                  |
| --------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| `users/{uid}`                                       | Besitzer          | Besitzer (nur `lichess`, `chesscom`, `settings`, `updatedAt`) |
| `users/{uid}/repertoires/{repId}` (ganze PGN-Datei) | Besitzer          | Besitzer, feste Felder, PGN bis 900 KB                        |
| `users/{uid}/cards/{cardId}`                        | Besitzer          | Besitzer, feste Felder                                        |
| `users/{uid}/reviews/{id}`                          | Besitzer          | Besitzer, nur anhängen                                        |
| `users/{uid}/consents/{terms}_{privacy}`            | Besitzer          | Besitzer, nur anlegen (Zustimmung zu AGB/Datenschutz)         |
| `users/{uid}/evals/{evalId}`                        | Besitzer          | Besitzer, Nutzer bis Tiefe 28, Matts immer                    |
| `evals/{evalId}` (gemeinsamer Positionsspeicher)    | alle Angemeldeten | nur Admins                                                    |

Alles andere ist gesperrt. Jedes synchronisierte Dokument trägt `syncedAt`
(Serverzeit, von den Regeln geprüft); danach fragt die App „was ist neu“.

### Rollen

Es gibt **Nutzer** und **Admins**. Die Rolle ist ein Custom Claim
(`admin: true`) im Firebase-Konto. Die App kann ihn nicht setzen, nur das
Skript mit einem Dienstkonto-Schlüssel:

```sh
cd firebase
npm install
GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/schluessel.json npm run set-role -- <email> admin
```

Danach einmal ab- und wieder anmelden.

### Bewertungen

Ein Bewertungsdokument entspricht einem Eintrag des lokalen
Positionsspeichers (`src-tauri/src/eval_cache.rs`):

```json
{
  "position": "<FEN ohne Zugzähler>",
  "engine": "<id name der Engine>",
  "depth": 28,
  "multipv": 1,
  "lines": [{ "multipv": 1, "depth": 28, "nodes": 0, "nps": 0, "cp": 25, "uci": ["e2e4"] }],
  "updatedAt": "<serverTimestamp()>"
}
```

- Dokument-ID: `encodeURIComponent(engine + "|" + multipv + "|" + position)`.
  Firestore erlaubt kein `/` in IDs, darum die Kodierung.
- Höchstens 5 Linien, je Linie `cp` oder `mate`.
- Die Tiefengrenze 28 steht in `firestore.rules` (`userMaxDepth`) und muss zu
  `USER_MAX_STORE_DEPTH` in `eval_cache.rs` passen.

## Kostenbremse

Cloud Billing schickt bei jeder Budget-Aktualisierung eine Nachricht an das
Pub/Sub-Thema `budget-alerts`. Die Function `budgetGuard` prüft, ob die
Kosten des Monats das Budget erreicht haben, und trennt dann das
Rechnungskonto vom Projekt. Firestore und Functions stehen danach still, bis
die Abrechnung in der Konsole wieder verknüpft wird.

Alle Functions laufen in `europe-west3` mit `maxInstances: 1`.

Zum Ausprobieren ohne Abschalten: Umgebungsvariable
`BUDGET_GUARD_DRY_RUN=true` in `functions/.env` setzen.

## Tests

```sh
cd firebase/functions && npm install && npm test   # Kostenbremse
cd firebase && npm install && npm run test:rules   # Regeln, braucht Java
```

## Einrichtung und Deploy

Die Schritte in der Firebase- und Google-Cloud-Konsole stehen in
[`SETUP.md`](SETUP.md).

```sh
cd firebase
npx firebase login
npx firebase use default        # Projekt jblbase
npx firebase deploy --only firestore,functions
```
