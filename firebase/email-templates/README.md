# E-Mail-Vorlagen (Firebase Authentication)

Firebase verschickt die Bestätigungs- und Passwort-Mails selbst. Die Texte
werden in der Firebase-Konsole gepflegt, nicht im Code. Diese Dateien sind
die Vorlage zum Hineinkopieren.

Konsole: Authentication → Templates. Dort oben die Vorlagensprache auf
**Deutsch** stellen; die App schickt die Mails in der eingestellten
App-Sprache (`auth.languageCode`).

| Vorlage                   | Betreff                                      | Nachricht                |
| ------------------------- | -------------------------------------------- | ------------------------ |
| E-Mail-Adresse bestätigen | `Bestätige deine E-Mail-Adresse für JBLBase` | `verify-email.de.html`   |
| Passwort zurücksetzen     | `Neues Passwort für JBLBase`                 | `password-reset.de.html` |

Für alle Vorlagen: Absendername `JBLBase`, Absender `noreply@…` (vorgegeben).

Platzhalter, die Firebase ersetzt: `%LINK%`, `%EMAIL%`, `%APP_NAME%`,
`%DISPLAY_NAME%`. `%APP_NAME%` ist der „öffentliche Name“ unter
Projekteinstellungen → Allgemein; er sollte `JBLBase` lauten.

Hinweis: Bei manchen Projekten sperrt Firebase das Bearbeiten der Nachricht
(„To help prevent spam…“). Dann lassen sich nur Absendername und Betreff
ändern, die Nachricht bleibt der deutsche Standardtext.
