# JBLBase: Anleitung

Eigenes Schachprogramm, aufgebaut auf
[En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) (GPL-3.0).
Dieses Projekt steht deshalb ebenfalls unter GPL-3.0.

## Positionsspeicher

Jede Stellung, die eine lokale Engine bewertet, landet in
`eval_cache.sqlite3` im App-Datenordner:

- Windows: `%APPDATA%\de.jammelwab.jblbase\eval_cache.sqlite3`
- macOS: `~/Library/Application Support/de.jammelwab.jblbase/eval_cache.sqlite3`

Gespeichert werden je Stellung, Engine und Linienanzahl (MultiPV): Tiefe,
Knoten, Bewertung (Centipawn, Matt, WDL) und die kompletten Hauptvarianten.

So wird der Speicher genutzt:

1. **Schlüssel ist die Stellung, nicht der Zugweg.** Ein 128-Bit-Fingerabdruck
   (Zobrist) aus Figurenstellung, Zugrecht, Rochaderechten und En-passant-Feld
   (nur wenn der Schlag wirklich möglich ist), ohne Zugzähler.
   `1.Sf3 d5 2.d4` und `1.d4 d5 2.Sf3` teilen sich also einen Eintrag.
2. **Getrennt pro Engine und Einstellung.** Stockfish und Patricia haben eigene
   Einträge (erkannt am `id name` der Engine). Optionen, die das Spiel der
   Engine ändern (z. B. `Skill Level`, `UCI_LimitStrength`/`UCI_Elo`, ein
   anderes Netz), kommen mit in den Namen, etwa
   `Stockfish 17.1 [Skill Level=5]`. Threads, Hash, MultiPV, WDL-Anzeige,
   Syzygy-Pfad und Ähnliches zählen nicht.
3. **Getrennt pro Linienanzahl.** Eine Suche mit 3 Linien kann eine Anfrage mit
   1, 2 oder 3 Linien bedienen, aber nicht eine mit 5. Ein Eintrag, den ein
   anderer mit mehr Linien und mindestens gleicher Tiefe ersetzt, wird gelöscht.
4. **Nur tiefer überschreibt.** Ein flacheres Ergebnis ersetzt nie ein tieferes.
5. **Kein Ballast.** Ergebnisse unter Tiefe 10 werden nicht gespeichert (die
   rechnet die Engine in Sekundenbruchteilen neu), Matts immer.
6. **Nur, was für jede Zugfolge gilt.** Kam die Stellung im Partieverlauf seit
   dem letzten Bauernzug oder Schlag schon einmal vor, sieht die Engine ein
   Remis durch Wiederholung, das es auf anderem Weg nicht gibt. Ab einem
   50-Züge-Zähler über 30 Halbzügen ziehen Engines die Bewertung Richtung
   Remis. Solche Stellungen werden weder aus dem Speicher gelesen noch
   gespeichert.
7. **Matts zählen extra.** Hat eine Engine ein Matt sicher, meldet sie eine
   künstliche Höchsttiefe (Stockfish 245). Solche Einträge bleiben immer
   erhalten, zählen in der Statistik aber nicht als „maximale Tiefe“.
8. **Speichergrenze für Nutzerkonten.** Bist du mit einem normalen Konto
   angemeldet, rechnet die Engine so tief wie immer, dauerhaft gespeichert wird
   aber höchstens Tiefe 28. Das tiefere Ergebnis bleibt bis zum Schließen der
   App im Arbeitsspeicher und wird in dieser Sitzung weiter genutzt. Matts
   werden nie begrenzt. Admins und die App ohne Konto speichern ohne Grenze;
   meldet sich ein Admin an, werden die nur im Arbeitsspeicher gehaltenen
   Ergebnisse vollständig gespeichert.

Beim Analysieren:

- **Live-Analyse:** Gibt es einen Eintrag, wird er sofort angezeigt. Ist bei
  „Tiefe N“ der Eintrag schon mindestens N tief, startet die Engine gar nicht.
  Sonst rechnet die Engine weiter, und ihre Ausgabe ersetzt die gespeicherte
  Anzeige erst, wenn sie mindestens genauso tief ist.
- **Bericht (Partieanalyse):** Bei „Tiefe N“ werden Stellungen übersprungen,
  die schon mindestens N tief gespeichert sind. Bei Zeit- oder Knotenlimit
  merkt sich der Bericht, wie tief die Engine in diesem Lauf im Schnitt kommt,
  und überspringt Stellungen, die schon mindestens so tief gespeichert sind;
  beim Knotenlimit reicht auch ein Eintrag mit genug Knoten. Sonst wird das
  tiefere von Speicher und neuer Rechnung genommen.
- **Taktiksuche und Insight:** Jede Stellung wird zuerst im Speicher gesucht;
  ist sie tief genug, rechnet die Engine nicht. Neue Ergebnisse werden mit
  Knoten und WDL gespeichert.

Eine Grenze: Die Engine selbst fängt intern bei einer neuen Suche von vorne an
(ihr Hash lebt nur im Arbeitsspeicher). Der Gewinn ist, dass du gespeicherte
Ergebnisse sofort siehst und tief genug bewertete Stellungen gar nicht mehr
gerechnet werden müssen.

Unter **Einstellungen → Positionsspeicher** siehst du Anzahl Stellungen,
Dateigröße und maximale Tiefe pro Engine, wie oft der Speicher seit dem Start
eine Rechnung erspart hat, und kannst den Speicher leeren.

**Format:** Die Züge der Hauptvarianten werden binär gespeichert (2 Byte pro
Zug), die Engine als Nummer, die Stellung als 16-Byte-Fingerabdruck. Das ist
etwa ein Drittel der früheren Größe. Ein Speicher aus älteren Versionen wird
beim ersten Start einmalig umgestellt (dabei fallen überholte und zu flache
Einträge weg); bei großen Dateien kann das einige Sekunden dauern, die Analyse
läuft währenddessen ohne Speicher.

Das Schreibprotokoll (`eval_cache.sqlite3-wal`) wird beim Start in die
Hauptdatei übernommen und danach auf höchstens 1 MB begrenzt.

### Über die Cloud teilen (ab 1.1.0)

Bist du angemeldet, gleicht die App den Positionsspeicher mit der Cloud ab.
Eine Stellung, die dein PC schon gerechnet hat, steht dann auch auf dem Mac
sofort im Speicher, und die Engine startet dort gar nicht erst.

- **Normales Konto:** Deine Bewertungen gehen in deinen eigenen Cloud-Bereich,
  bis Tiefe 28 (Matts immer). Deine anderen Geräte holen sie beim nächsten
  Abgleich.
- **Admin:** Deine Bewertungen gehen ohne Tiefengrenze in den **gemeinsamen
  Speicher**, den alle Konten lesen, z. B. Aaron.
- **Tiefer gewinnt:** Vor dem Hochladen holt die App, was in der Cloud neu
  ist, und übernimmt nur Einträge, die tiefer sind als ihre eigenen. Hoch geht
  nur, was die Cloud noch nicht genauso tief hat.
- **Hochladen ab Tiefe 20** (einstellbar). Flachere Ergebnisse rechnet die
  Engine schneller neu, als der Abgleich dauert.
- **Kosten:** Pro Tag lädt ein Gerät höchstens 15.000 Bewertungen hoch und
  40.000 herunter, das liegt im kostenlosen Kontingent von Firestore. Ein
  großer vorhandener Speicher geht also über mehrere Tage hoch; die
  Einstellungsseite zeigt, wie viele noch warten.
- Der Abgleich läuft mit dem übrigen Cloud-Sync (beim Start, alle 5 Minuten
  und auf Knopfdruck) und lässt sich unter **Einstellungen →
  Positionsspeicher → Über die Cloud teilen** ausschalten, ebenso das Laden
  des gemeinsamen Speichers.

Für spätere Phasen (Repertoire, Vergleich der Eröffnungsbäume) gibt es schon
den Befehl `getCachedEvals(fen)`, der alle gespeicherten Bewertungen einer
Stellung liefert.

## Repertoires

In der Seitenleiste gibt es **Repertoires** (Bücher-Symbol). Dort legst du mit
einem Klick deine zwei Standard-Repertoires für Weiß und Schwarz an. Sie
stehen unter dem Namen, den du in den Einstellungen unter **Repertoire → Dein
Name** einträgst (nur lokal gespeichert, ohne Eintrag „Ich“). Weitere
Repertoires, etwa für einen Freund, gehen über **Neues Repertoire** (Name, für
wen, Farbe). Ein Repertoire ist eine normale
PGN-Datei im Dokumente-Ordner, die Varianten bilden den Baum, ohne
Tiefenlimit.

**Ordner:** Die Seite ist nach Spieler → Weiß/Schwarz → Ordner aufgebaut. Für
verschiedene Eröffnungen legst du mehrere Repertoires an und sortierst sie in
Ordner, z. B. Weiß → `1.d4` → `Londoner System`. Den Ordner gibst du beim
Anlegen an oder später mit dem Ordner-Symbol oben rechts auf der Karte
(**In Ordner verschieben**); Unterordner trennst du mit `/`
(`1.d4/Londoner System`). Ein Ordner gibt es, solange ein Repertoire darin
liegt. Das **+** an einem Ordner legt ein neues Repertoire direkt dort an.
Liegen mehrere Repertoires in einem Ordner (oder unter Weiß/Schwarz), zeigen
**Baum von allem** und **Mit meinen Partien vergleichen** sie zusammen als ein
Baum. Der Vergleich über die Spielerkarte nimmt ebenfalls alle Repertoires
dieser Farbe zusammen.

**Eine Stellung ins Repertoire aufnehmen:**

1. In irgendeiner Partie oder Analyse zur gewünschten Stellung gehen.
2. In der Leiste links neben dem Brett, direkt unter „Brett drehen“:
   - **Zu Repertoire hinzufügen** (Lesezeichen): nimmt die Linie vom Start
     bis zum aktuellen Zug auf.
   - **Zu Repertoire mit Nebenvarianten hinzufügen** (Baum-Symbol): nimmt
     zusätzlich alle Varianten mit, die von dieser Linie abzweigen oder ihr
     folgen, z. B. eine ganze vorbereitete Analyse.
3. Repertoire auswählen und **Aufnehmen**. Züge, die schon drin sind, werden
   wiederverwendet, eine neue Linie zweigt dort ab, wo sie abweicht.

Der Tab **Repertoire** neben dem Brett zeigt für jede Stellung, ob sie in
deinen Repertoires steht und was du dort spielst bzw. gegen welche Züge du
vorbereitet bist. Zugumstellungen werden erkannt. Ein Klick auf einen Zug
spielt ihn auf dem Brett.

### Lücken finden (Hilfe beim Aufbau)

**Lücken finden** auf der Repertoire-Karte sagt dir Schritt für Schritt, was deinem
Repertoire als Nächstes fehlt, das Wichtigste zuerst:

- **Gegnerzug offen:** Ein Zug, den der Gegner auf Lichess oft spielt (ab 5 %, oben
  einstellbar), hat noch keine Linie.
- **Dein Zug fehlt:** Eine Linie endet nach einem Gegnerzug, du hast dort keinen Zug.
- **Weiterführen:** Eine Linie endet nach deinem Zug; gezeigt wird, was der Gegner dort
  oft spielt. Das ist keine Lücke, nur ein Hinweis, und zählt halb so viel.

Sortiert wird danach, in wie vielen Partien eine Lücke vorkommt: die Lichess-Anteile der
Gegnerzüge auf dem Weg dorthin, multipliziert (deine eigenen Züge zählen voll). Oben steht
der **nächste Schritt** mit **Auf dem Brett öffnen** (öffnet das Repertoire genau an der
Stelle, was du dort ziehst, landet direkt darin) und **Vorschlag übernehmen** (nimmt den
Gegnerzug und die auf Lichess meistgespielte Antwort auf, mit Eintrag in der
Import-Historie). Häufig ist nicht immer am besten, prüfe Vorschläge mit der Engine. Die
**geschätzte Abdeckung** ist der Anteil der Partien, die bis zum eingestellten Zug bzw. bis
zum Ende deiner Linien im Repertoire bleiben. Für die Lichess-Zahlen musst du unter
**Benutzer** bei Lichess angemeldet sein; ohne Anmeldung findet die Suche nur Linien, die
nach einem Gegnerzug enden. Geprüft werden bis zu 150 Stellungen, die häufigsten zuerst.

Auch auf dem Brett hilft die App beim Aufbau: Im Tab **Repertoire** stehen in jeder
Stellung deines Repertoires die häufigen Gegnerzüge ohne Antwort (ab 5 %) und, wo dir ein
Zug fehlt, die drei meistgespielten Züge, jeweils mit Anteil. Ein Klick spielt den Zug. Ist
gerade ein Repertoire geöffnet, zählen seine Züge so, wie sie auf dem Brett stehen.

### Ordner anlegen und Ordner importieren

Ordner legst du mit dem Ordner-Plus-Symbol an, unter Weiß/Schwarz oder in einem
anderen Ordner; sie bleiben auch leer erhalten (gespeichert in
`repertoire-folders.json` im Dokumente-Ordner). Mit dem Stift benennst du einen Ordner
um, alles darin wandert mit; leere Ordner löschst du mit dem Papierkorb. Repertoires
behalten dabei ihre ID, der Trainingsfortschritt bleibt also erhalten.

**Ordner importieren** nimmt einen Ordner mit PGN-Dateien von der Festplatte: Jede
PGN wird ein Repertoire mit dem Dateinamen als Namen (ihre Partien wie ein Kurs
importiert, mit Eintrag in der Import-Historie), Unterordner werden zu Ordnern. Du
wählst Spieler, Farbe, einen Zielordner und ob der Name des gewählten Ordners als
oberste Ebene übernommen wird. Gibt es einen Namen schon, bekommt das neue
Repertoire „(2)“ angehängt.

### Haupt-Repertoire

„Ich Weiß“ und „Ich Schwarz“ (allgemein: „Spieler Farbe“ auf oberster Ebene) sind die
**Haupt-Repertoires**, erkennbar am grünen Abzeichen. Sie enthalten alle Linien der
anderen Repertoires derselben Farbe: Was du als Kurs, als Ordner oder als einzelne
Linie in ein anderes Repertoire importierst, kommt automatisch auch ins
Haupt-Repertoire, mit eigenem Eintrag in dessen Import-Historie. Fehlen ihm Züge, etwa
aus Importen von vor dieser Version, zeigt die Karte „N fehlende Züge übernehmen“.
Züge, die das Haupt-Repertoire schon hat, bleiben unverändert; was du nur aus einem
Unter-Repertoire löschst, bleibt im Haupt-Repertoire stehen. Beim ersten Abgleich wird
es in der `.info` als Haupt-Repertoire markiert (`main`), damit es das auch nach dem
Umbenennen bleibt.

### Repertoire mit einem anderen Konto teilen

Ein einzelnes Repertoire lässt sich mit einem anderen JBLBase-Konto teilen, zum Beispiel
mit einem Schüler. Auf der Karte des Repertoires öffnet das Teilen-Symbol den Dialog:
E-Mail-Adresse oder Lichess-Name des anderen Kontos eintragen, „Teilen“. Dafür musst du
in der Cloud angemeldet sein und das Repertoire muss einmal abgeglichen sein.

- **Nur ausdrücklich:** Geteilt wird nur dieses eine Repertoire (Name, Farbe, Züge),
  sonst nichts: keine anderen Repertoires, Partien, Trainingsdaten oder Konto-Daten.
  Lesen können es nur du und das eingetragene Konto (Firestore-Regeln, `shares/{id}`).
- **Annehmen:** Beim anderen Konto erscheint oben auf der Repertoire-Seite „Mit dir
  geteilt“. Erst nach „Annehmen“ wird das Repertoire auf das Gerät geladen, und zwar in den
  Ordner „Geteilt von …“. „Ablehnen“ löscht die Einladung.
- **Immer aktuell:** Jede Änderung am Repertoire geht beim nächsten Abgleich an alle, mit
  denen es geteilt ist. Eigene Änderungen des Empfängers am geteilten Repertoire werden
  dabei überschrieben; dafür gibt es „Eigene Kopie anlegen“.
- **Zurücknehmen:** Im Teilen-Dialog beendet „Zurücknehmen“ die Freigabe. Der Empfänger
  behält den zuletzt erhaltenen Stand, markiert mit „Freigabe beendet“, und bekommt
  keine Updates mehr. Löscht der Empfänger das Repertoire, endet die Freigabe ebenfalls.
- Geteilte Repertoires zählen nicht zum eigenen Repertoire-Baum des Spielers und werden
  nicht in die eigenen Cloud-Repertoires übernommen. Beim Löschen des Kontos werden alle
  Freigaben in beide Richtungen gelöscht.
- Beide Konten müssen auf der Zugangsliste `config/access` stehen. Nach dem Update
  müssen die Firestore-Regeln neu veröffentlicht werden (`firebase deploy --only
  firestore:rules`), sonst schlägt das Teilen mit „Missing or insufficient permissions“
  fehl.

### Repertoire im Datenbank-Bereich des Analysebretts

Im Datenbank-Bereich des Analysebretts gibt es neben Lokal, Lichess Alle und Lichess
Meister die Quelle **Repertoire**. Sie sieht aus wie die anderen Datenbanken: die Züge deines
Repertoires in der aktuellen Stellung mit Anteil und Anzahl der Varianten dahinter,
jede Variante einmal gezählt, auch wenn sie in mehreren Repertoires steht (etwa im
Haupt-Repertoire und im Unter-Repertoire). Fährst du über den Balken, siehst du, in
welchen Repertoires der Zug vorkommt. Ein Klick auf eine Zeile spielt den Zug. Oben wählst du
„Alle meine Repertoires“ oder ein bestimmtes Repertoire (auch das eines anderen
Spielers).

### Import-Historie

Vor jedem Import in ein Repertoire (Kurs importieren oder Zeile aus einer Partie
hinzufügen) wird der Stand davor gespeichert. Über das Uhr-Symbol auf der
Repertoire-Karte öffnest du die **Import-Historie**: jeder Import mit Datum, Quelle
und Anzahl der neuen Züge. **Rückgängig** setzt das Repertoire auf den Stand vor
diesem Import zurück. Spätere Importe und Änderungen von Hand seit diesem Import
gehen dabei ebenfalls verloren, darauf weist ein Hinweis vorher hin. Die letzten 30
Importe werden aufbewahrt, in der Datei `Name.history.json` neben dem Repertoire.

### Baumdiagramm

Auf der Repertoire-Seite öffnet **Baum** das Repertoire als gezeichnetes
Baumdiagramm, das sich von links („Start“) nach rechts verzweigt. Weiße Züge
sind helle Kästchen, schwarze Züge dunkle, deine eigenen Züge haben einen
blauen Rahmen. Ein Klick auf einen Zug zeigt die Stellung unten rechts auf
einem kleinen Brett, darunter die Zugfolge (weiße Züge hell, schwarze dunkel)
und den Knopf **Auf dem Brett öffnen**. Auf dem kleinen Brett zeigen grüne
Pfeile die Züge deines Repertoires aus dieser Stellung und ein blauer Pfeil
den meistgespielten Lichess-Zug (mit Anteil darunter). Der Zug, hinter dem die meisten
Varianten deines Repertoires stehen, hat den kräftigsten grünen Pfeil, die anderen sind
dünner. Die Größe des kleinen Bretts ziehst du an der Ecke oben links (Doppelklick setzt
sie zurück), sie wird gemerkt.

Auf dem kleinen Brett kannst du auch selbst ziehen, der Baum folgt dann deinem
Repertoire: Steht der Zug im Repertoire, springt der Baum dorthin (klappt auf und
markiert ihn), und die Pfeile zeigen die nächsten Züge. Erreichst du eine Stellung über
eine andere Zugfolge, zeigt der Baum sie dort. Verlässt du das Repertoire, steht
„Nicht in deinem Repertoire“ unter dem Brett, die Züge außerhalb sind orange
umrandet, und **Zeile hinzufügen** nimmt die Zeile ins Repertoire auf (landet auch in
der Import-Historie). Der Pfeil oben nimmt den letzten Zug zurück.

Unter jedem Zug zeigt eine blaue Leiste den Anteil auf Lichess und eine grüne den Anteil
deiner Varianten, die hinter diesem Zug stehen. Deine eigenen Züge sind nach Repertoire
sortiert (oben der mit den meisten Varianten), die Züge des Gegners nach Lichess (oben
der meistgespielte). Mit gedrückter Maus verschiebst du
den Baum, das Mausrad zoomt, die Knöpfe oben rechts zoomen oder zeigen alles.
Der Kreis mit + oder − rechts an einem Zug klappt die Folgezüge auf und zu
(die Zahl daneben sagt, wie viele Züge darunter liegen). Ein Klick auf einen
Mit der Maus über einem Zug siehst du die Prozente. Jeder Zug hat zwei kleine Leisten:

- **Blau, Lichess-Datenbank:** wie oft der Zug aus dieser Stellung auf
  Lichess gespielt wird (mit den Filtern aus Datenbank → Lichess). Dafür
  musst du unter **Benutzer** bei Lichess angemeldet sein.
- **Grün, deine Partien:** wie oft der Zug in deinen eigenen Partien vorkam,
  in denen du die Farbe des Repertoires hattest. Grundlage sind die unter
  **Benutzer** heruntergeladenen Chess.com- und Lichess-Partien. Unter einem
  Gegnerzug ergeben deine Varianten plus „sonstige Züge“ zusammen 100 %. Bei
  Repertoires für andere Personen fehlt diese Leiste, weil es nicht deren Partien sind.

Ist der meistgespielte Lichess-Zug (nur Platz 1) eines Gegners nicht in
deinem Repertoire, steht er gestrichelt und abgeblasst unter deinen Varianten. Das heißt
nicht, dass er gut oder schlecht ist, nur dass er oft kommt.

**Zugumstellungen:** Entsteht dieselbe Stellung über verschiedene
Zugfolgen, zeigt ein gestrichelter violetter Pfeil von der einen Zugfolge zur
anderen, und der Zug trägt oben rechts ein violettes ⇄. Ein Klick auf ⇄
klappt den Baum bei der anderen Zugfolge auf und springt hin, ein weiterer
Klick geht zur nächsten.

### Deine bisher gespielten Eröffnungen

- **Als Statistik:** Benutzer → deine Spielerkarte → Tab **Eröffnungen** →
  „Als Weiß“ oder „Als Schwarz“ → **In der Analyse öffnen**. Rechts im Tab
  **Datenbank** siehst du für jede Stellung, welche Züge du wie oft gespielt
  hast und wie sie ausgingen.
- **Mit dem Repertoire vergleichen:** im selben Tab **Mit meinem
  Eröffnungsbuch vergleichen**, oder auf der Repertoire-Seite bei deinen
  Repertoires **Mit meinen Partien vergleichen**. Oben rechts wählst du unter
  **Partien von** den Spieler, etwa „Jannick Schwab“: gezählt werden alle
  seine Konten und zugeordneten Datenbanken zusammen (siehe **Meine Spieler**
  unten). Die Auswahl merkt sich die App pro Repertoire-Besitzer. Es zählen nur Züge, die du
  mindestens 2-mal gespielt hast (oben einstellbar). Oben stehen drei Listen:
  wo du überrascht wirst (Gegnerzug ohne Antwort im Repertoire), wo du
  abweichst (du spielst nicht deinen vorbereiteten Zug) und wo dein
  Repertoire endet, obwohl deine Partien weitergehen. Darunter liegen deine
  Partien als gezeichneter Baum, mit Anzahl und Ergebnis an jedem Zug; der
  Rahmen ist grün (im Repertoire), orange (Überraschung), rot (Abweichung) oder
  blau (Repertoire endet). Wie im Repertoire-Baum zeigen die Leisten, wie oft
  der Zug auf Lichess (blau) und in deinen Partien (grün) gespielt wird. Ein
  oranges „L“ heißt: Dein Zug ist nicht der meistgespielte auf Lichess, der
  Tooltip nennt den Hauptzug. Ein Klick zeigt die Stellung auf dem kleinen Brett. Ein
  Klick auf eine Variante öffnet sie in einer neuen Analyse, von dort fügst
  du sie mit dem Knopf unter „Brett drehen“ zum Repertoire hinzu.
  Zugumstellungen werden erkannt: führt eine andere Zugfolge in eine
  Stellung deines Repertoires, gilt sie als Repertoire.

### Training „Linien“

Öffne ein Repertoire, Tab **Training → Linien**. Das Training läuft Linie für
Linie, ähnlich wie bei Chessable:

- Die Gegnerzüge spielt das Programm, deine Züge findest du selbst. Pro Zug
  hast du **30 Sekunden** (Balken).
- Stehen in deinem Repertoire noch **andere Gegnerzüge**, zeigen blaue Pfeile
  sie kurz bevor der Gegner zieht, und sie stehen als Liste daneben.
- **Falsch oder Zeit abgelaufen:** Ein grüner Pfeil zeigt den richtigen Zug,
  du spielst ihn nach, und die Linie geht weiter. Die Stellung kommt am Ende
  der Runde nochmal (ab einem Zug davor) und später wieder, nach dem
  Wiederholungsplan (gleiche Karten wie im Tab „Training“).
- **Nächste Linie:** Sie startet nicht wieder bei Zug 1, sondern einen Zug vor
  der Stelle, an der sie von der vorigen abweicht. So siehst du genau, was
  anders ist.
- **Fällig** übt nur Linien mit neuen oder fälligen Stellungen,
  **Alle Linien** das ganze Repertoire.

## Tutorials

Beim ersten Öffnen der Repertoire-Seite startet das Tutorial **Repertoire aufbauen**: Es
hebt nacheinander die echten Knöpfe hervor (Repertoire anlegen, Züge eintragen, Lücken
finden, Baum, Vergleich mit deinen Partien) und erklärt sie. Wo ein Schritt einen Klick
verlangt, macht **Weiter** den Klick für dich, oder du klickst selbst. Klicks gehen auch
während des Tutorials an die App, du kannst also alles gleich ausprobieren.
**Überspringen**, das Kreuz oder Esc beenden es; es kommt dann nicht von selbst wieder.

Unter **Einstellungen → Tutorials** startest du jedes Tutorial neu: **Repertoire
aufbauen**, **Am Brett arbeiten** (Tab Repertoire mit den Hinweisen, Linien aufnehmen,
Training, Engine und Brillant, Datenbank) und **Eigene Partien laden** (Konto hinzufügen,
Partien herunterladen, Eröffnungen vergleichen).

Dazu kommt für jeden weiteren Bereich ein kurzes Tutorial mit drei bis sechs Schritten:
**Neuer Tab** (Startkarten, Partie importieren, zuletzt geöffnet, Tabs), **Puzzles und
Taktik** (Puzzle-Datenbank, Aufgaben aus eigenen Partien, Training/Streak, Blind-Modus,
Statistik), **Datenbanken** (PGN importieren, erkunden, Baum, Referenzdatenbank),
**Dateien**, **Engines** (hinzufügen, Threads/Hash/Linien, Positionsspeicher),
**Insight**, **Repertoire teilen**, **Konto und Sync**, **Einstellungen und Hilfe**
(Positionsspeicher, Schnellmenü, Fehler melden) und für Admins **Admin-Übersicht**. Am Ende
jedes Tutorials geht es auf Wunsch mit dem nächsten weiter.

Das **Fragezeichen oben rechts** zeigt die Tutorials zur gerade offenen Seite und führt zur
Liste aller Tutorials. Diese Tutorials starten nicht von selbst.

Für Entwickler: Ein Tutorial ist ein Eintrag in `src/components/tutorial/tutorials.ts`
(Schritte mit dem `data-tour`-Namen des Elements; optional `settingsTab`, `newTab`,
`pages`, `adminOnly`), seine Texte stehen unter
`Tutorial.<Tutorial>.<Schritt>.Title`/`.Body` in `en-US.json` und `de-DE.json`.
`tutorials.test.ts` prüft, dass jeder Schritt Texte hat und jedes Ziel im Code existiert.

## Meine Spieler: Konten und Datenbanken zusammenfassen

Unter **Konten** (Personen-Symbol) stehen deine Lichess- und Chess.com-Konten
nach Spieler gruppiert. Ein Konto ziehst du auf einen anderen Spieler, um beide
zusammenzufassen. Pro Spieler gibt es oben rechts:

- **Das bin ich** (Personen-Haken): markiert den Spieler als dich, er bekommt
  das Abzeichen „Ich“. Deine eigenen Repertoires werden dann mit genau seinen
  Partien verglichen. Ohne Markierung gilt wie bisher: der Spieler mit deinem
  Namen aus den Einstellungen, sonst alle Konten zusammen.
- **Datenbank zuordnen** (Datenbank mit Plus): nimmt Partien aus einer weiteren
  Datenbank dazu, z. B. importierte Turnierpartien. Du wählst die Datenbank und
  deinen Namen darin („Schwab, Jannick“); die App schlägt die Namen aus der
  Datenbank vor. Die Datenbank erscheint als kleine Karte unter den Konten, das
  **x** entfernt die Zuordnung (die Datenbank selbst bleibt).

Dasselbe geht aus der Datenbank heraus: In der Spielerliste einer Datenbank
steht über der Spielerkarte **Das bin ich / Spieler zuordnen**. Ist der Spieler
schon zugeordnet, steht dort „Gehört zu …“.

Alle Konten und Datenbanken eines Spielers zählen zusammen: in der Statistik
rechts auf der Konten-Seite, im Repertoire-Vergleich und bei den eigenen
Partien im Repertoire-Baum. Gespeichert wird das nur lokal.

## Datenbank als Baum

Unter **Datenbanken** eine Datenbank anklicken und **Als Baum öffnen** wählen, oder nach
**Erkunden** den Tab **Baum** öffnen. Die Datenbank erscheint als gezeichneter
Eröffnungsbaum wie beim Repertoire. Damit er auch bei einer Million Partien übersichtlich
bleibt, stehen dort nur Züge, die in **mindestens 15 %** der Partien aus der jeweiligen
Stellung gespielt wurden. Die Grenze stellst du oben rechts ein (0 % zeigt alle Züge).
An jedem Zug stehen die Anzahl der Partien und sein Anteil, der Tooltip nennt die
Ergebnisse. Die Stellungen werden erst gezählt, wenn du einen Zug mit **+** aufklappst.
Ein Klick auf einen Zug zeigt die Stellung auf dem kleinen Brett, **Auf dem Brett
öffnen** öffnet die Zugfolge in der Analyse. Repertoire-Bäume bleiben ungefiltert.

**Als Weiß / Als Schwarz:** Über dem Baum trägst du unter **Nur Partien dieses Spielers**
einen Namen ein und wählst **Als Weiß**, **Als Schwarz** oder **Beide Farben**. Der Baum
zählt dann nur die Partien, in denen dieser Spieler die gewählte Farbe hatte. Seine eigenen
Züge sind blau umrandet, die anderen Züge sind die der Gegner, und das kleine Brett dreht
sich zur gewählten Farbe. Bei den Datenbanken deiner eigenen Chess.com- und Lichess-Konten
ist dein Name schon eingetragen und **Als Weiß** vorgewählt.

## Zugbewertungen

Nach **Analyse → Bericht erstellen** bekommt jeder Zug eine Bewertung wie bei
Chess.com: Brillant, Großartiger Zug, Bester Zug, Exzellent, Gut, Buchzug,
Ungenauigkeit, Fehler, Patzer. Grundlage ist der Verlust an Gewinnchance
gegenüber dem besten Engine-Zug (Ungenauigkeit ab 5 %, Fehler ab 10 %,
Patzer ab 20 %). „Bester Zug“ heißt, die Engine hätte genau diesen Zug
gespielt, „Buchzug“, dass die Stellung eine bekannte Eröffnung ist.
Die Bewertung erscheint als Plakette auf dem Zielfeld, im Bericht als Tabelle
pro Farbe (ein Klick springt zum nächsten solchen Zug) und mit dem Hinweis,
welcher Zug besser gewesen wäre. Die Bewertungen werden nicht in die PGN
geschrieben, die klassischen Zeichen (!!, ?, ?? …) schon.

## Brillante Züge suchen

Im Analysebrett gibt es neben **Engines**, **Bericht** und **Protokolle** den
Tab **Brillant**. Er sucht ab der aktuellen Stellung nach Zügen, die ein „!!“
verdienen würden. Voreingestellt ist Patricia, jede andere lokale Engine geht
auch.

So wird gesucht:

1. Die Engine rechnet einen kleinen Variantenbaum (Einstellung **Halbzüge
   voraus**, höchstens **Stellungen** viele Stellungen).
2. **Auf deiner Seite** (Seite am Zug, Weiß, Schwarz oder beide) wird jede
   Engine-Linie geprüft:
   - **Opfer:** Der Zug gibt Material her (Bauer 0,9, Qualität 2, Leichtfigur 3,
     Turm 5; die Grenze für „!!“ stellst du unter _Weitere Einstellungen_ ein)
     und ist trotzdem korrekt, also höchstens 0,4 schlechter als der beste Zug
     und nicht klar schlechter für dich.
   - **Versteckt:** Eine flache Suche auf **Club-Niveau** (Standard Tiefe 8)
     findet den Zug nicht.
   - **Einziger Zug:** Alles andere ist mindestens 1,5 schlechter.
     „!!“ gibt es für ein korrektes Opfer ab der Grenze, das die Engine als
     besten Zug sieht oder das versteckt ist, und für einen versteckten ruhigen
     einzigen Zug. Kleinere Funde bekommen „!“.
3. **Beim Gegner** folgt die Suche nicht nur dem Engine-Zug, sondern auch
   realistischen Club-Antworten: den Lieblingszügen der flachen Suche, Zügen
   bis **Realistisch bis** Centipawns hinter dem besten und dem Annehmen eines
   gerade angebotenen Opfers. Funde nach so einer Antwort tragen die Plakette
   „Nach Club-Antwort“.

Jeder Fund zeigt Zug, Bewertung, die Variante dorthin und die Fortsetzung.
**Aufs Brett** fügt die Variante mit „!!“ bzw. „!“ in die Partie ein und
springt zum Zug.

**In dieser Variante** (oben unter „Wo suchen“) baut keine eigenen Varianten, sondern
prüft jede Stellung der Varianten, die ab der aktuellen Stellung schon in der Partie bzw.
im Repertoire stehen: Gibt es dort für deine Seite einen brillanten Zug? „Seite am Zug“
heißt hier die Seite unten auf dem Brett, also die Seite des Repertoires. Funde, deren Zug
schon in der Variante steht (dein eigener Repertoire-Zug ist brillant), tragen „In deiner
Variante“; **Markieren** bzw. **N Funde in der Variante markieren** setzt dort nur das
„!!“/„!“, ohne Engine-Fortsetzung, damit das Repertoire seine Linien behält. Andere Funde
fügst du wie gewohnt mit **Aufs Brett** als Nebenvariante ein. Im Repertoire-Baum öffnet
**Brillante Züge in dieser Variante** unter dem kleinen Brett das Repertoire an dieser
Stelle mit dem Tab Brillant und dieser Einstellung. Gerechnet wird in der Reihenfolge der
Tiefe (erst alle ersten Züge, dann die nächsten), höchstens **Stellungen** viele; schon
bewertete Stellungen kommen aus dem Positionsspeicher.

Die tiefen Rechnungen landen im Positionsspeicher (mit der Grenze Tiefe 28
für normale Konten), die flachen Club-Rechnungen nicht.

## JBL Coach

Seit 1.2.0 steht auf dem Startbildschirm die Karte **JBL Coach** an der Stelle von „Partie importieren“. Die Figur hat einen Bohnenkörper und die JBL-Box als Kopf; beim ersten Start winkt sie einmal. Wer in den Systemeinstellungen reduzierte Bewegung eingestellt hat, sieht sie ohne Animationen.

Die Karte zeigt Level, Titel und XP-Balken (Level n braucht insgesamt 100 × (n − 1)^1,8 XP) und immer die **nächste Aufgabe** mit einem Knopf dafür. Die Reihenfolge: zuerst fällige Stellungen in den zuletzt geöffneten Repertoires, dann eine Partie gegen JBL, dann Puzzles. Ein neuer Tag fängt wieder von vorn an. Bis Partien und Puzzles ab Etappe 3 echt gezählt werden, gilt eine Aufgabe als erledigt, sobald man sie startet.

Ein Klick auf die Figur oder „Coach öffnen“ macht den Tab zur **Coach-Seite**: oben JBL in seinem Rahmen, mit Titel, einem Satz zur nächsten Aufgabe und dem Level, daneben die Vitrine mit Plätzen für Titel, Rahmen, Verzierungen und Gimmicks sowie Trophäen (freigeschaltet wird ab Etappe 3), darunter „Was heute ansteht“ mit den drei Aufgaben (bei „Gegen JBL spielen“ die Stärke in sieben Stufen von „Sehr leicht · ca. 600“ bis „Sehr schwer · ca. 2800+“, die Wahl bleibt gespeichert) und darunter, nur für Admins und nur nach Einschalten des Schalters, die Vorschau „Bald beim Coach“ (Lektionen, Lücken finden mit JBL, typische Fehler). „Gegen JBL spielen“ öffnet in dieser Etappe noch die normale Partie gegen eine Engine.

„Partie importieren“ ist jetzt der Knopf oben rechts in der Karte „Zuletzt geöffnet“. Das Tutorial „Startseite“ zeigt beide Stellen.

### Gegen JBL spielen

Seit 1.2.1 ist „Gegen JBL spielen“ eine echte Partie. Der Tab zeigt vor dem Start JBL, die Wahl der Farbe (Weiß, Zufall, Schwarz) und der Stärke. JBL ist Stockfish mit begrenzter Stärke: ab „Mittel“ über `UCI_LimitStrength` und `UCI_Elo` (1 bis 1,5 s pro Zug), darunter mit `Skill Level` 0 und Suchtiefe 1, 3 oder 5. Diese unteren Stufen sind eine erste Schätzung und werden noch an echten Partien geeicht. Coach-Partien laufen ohne Uhr und ohne Eröffnungsbuch; ohne eingerichteten Stockfish lässt sich die Partie nicht starten.

Nach jedem deiner Züge prüft JBL im Hintergrund mit Stockfish (Tiefe 12, zwei Linien) die Stellung davor und danach und bewertet den Zug wie die Analyse (`getAnnotation`). Bei !!, !, !?, ?!, ? und ?? reagiert die Figur neben dem Brett mit ihrer Animation, die Sprechblase kommt 300 ms später und bleibt je nach Länge 1,5 bis 6 s stehen (länger, solange die Maus darauf ist). Bei ?!, ? und ?? steht dabei, welcher Zug besser war. Jeder Spruch hat mehrere Fassungen, die zuletzt gezeigten kommen nicht gleich wieder. Nach ? und ?? bietet JBL „Zug zurücknehmen“ an; das setzt die Partie vor deinen Zug zurück. Hast du ein Matt in 1 zugelassen, gibt es kein Zurücknehmen, auch nicht über den normalen Knopf.

Der Code: `coachGame.ts` (Stärke, Reaktionen, Sprüche), `useCoachCommentary.ts` (Bewertung), `CoachGameSetup.tsx` und `CoachGamePanel.tsx`; in `BoardGame.tsx` erkennt die Partie über `tab.coach`, dass sie gegen JBL läuft.

Der Code liegt in `src/components/coach/`: `CoachFigure.tsx` (SVG und Animationen), `CoachCard.tsx` (Karte), `CoachPage.tsx` (Coach-Seite), `useCoach.ts` (Aufgaben und Aktionen) und `coachState.ts` (Stärkestufen, XP-Kurve, Titel, Tagesaufgaben).

## Engines einrichten

Seit 1.1.12 bringt der Installer **Stockfish 19** und **Patricia 5.1** mit
(Windows x64 und macOS Apple Silicon). Beim ersten Start kopiert die App sie in
den Engines-Ordner (Unterordner `bundled/`, mit Lizenztexten) und legt sie
unter **Engines** an, mit Einstellungen passend zum Rechner: Stockfish bis zu
10 Threads (ein Kern bleibt frei) und bis zu 4 GB Hash (höchstens ein Viertel
des Arbeitsspeichers), Patricia 2 Threads und bis zu 1 GB. Wer schon eine
eigene Stockfish- oder Patricia-Engine eingebunden hat, behält sie, die
mitgelieferte kommt dann nicht dazu. Eine gelöschte mitgelieferte Engine
kommt nicht wieder. Mit einer neuen Version zeigt die angelegte Engine
automatisch auf das neue Programm, die Einstellungen bleiben.

Von Hand einrichten (andere Version, andere Systeme) geht weiterhin so:

### Stockfish

1. Download: <https://stockfishchess.org/download/>
   - Windows mit Ryzen 3600: Version **„AVX2“** nehmen
     (der Ryzen 3600 kann BMI2, auf Zen 2 ist AVX2 aber meist schneller).
2. Entpacken, z. B. nach `C:\Engines\Stockfish\`.
3. In JBLBase: **Engines → Hinzufügen → Lokal** und die `.exe` auswählen.
4. Empfohlene Optionen (in der Engine-Box über das Zahnrad):
   - `Threads`: **10** (lässt 2 Threads für Oberfläche und zweite Engine frei)
   - `Hash`: **4096** MB (bei 32 GB RAM unbedenklich)
   - `MultiPV`: nach Geschmack 1–3

### Patricia (aggressive Engine)

Patricia ist eine Open-Source-Engine (MIT-Lizenz) von Adam Kulju, gebaut auf
möglichst aggressives, opferfreudiges Spiel.

1. Download: <https://github.com/Adam-Kulju/Patricia/releases>, die neueste
   Windows-`.exe`.
2. Wie oben als lokale Engine hinzufügen.
3. Optionen: `Threads` 2, `Hash` 1024 MB.

**macOS (Apple Silicon):** Patricia bietet selbst keinen Mac-Download an.
Unser Workflow „Build Patricia (macOS)“ kompiliert den unveränderten
Quellcode. Unter **Actions → Build Patricia (macOS) → letzter Lauf →
Artifacts** die ZIP-Datei laden, entpacken und einmal im Terminal ausführen:

```bash
xattr -dr com.apple.quarantine ~/Downloads/patricia-5.1-macos-arm64
chmod +x ~/Downloads/patricia-5.1-macos-arm64
```

Danach am besten in einen festen Ordner verschieben (z. B. `~/Engines/`) und
in JBLBase über **Engines → Engine hinzufügen → Lokal** auswählen.

Beide gleichzeitig: In der Analyse beide Engines aktivieren. Jede bekommt
ihre eigene Box mit Linien und Bewertung. Der Ryzen 3600 hat 12 Threads,
deshalb zusammen nicht mehr als etwa 12 Threads vergeben.

Die GTX 1080 hilft hier nicht: Stockfish und Patricia rechnen auf der CPU.

## Trainingsfortschritt

Der Fortschritt beim Training (FSRS-Karten und alle Wiederholungen) liegt in
`training.sqlite3` im App-Datenordner, neben dem Positionsspeicher.

- Jedes Repertoire bekommt beim ersten Training eine feste ID in seiner
  `.info`-Datei. Der Fortschritt hängt an dieser ID, nicht am Dateipfad. Er
  übersteht deshalb Umbenennen und Verschieben.
- Eine Karte gehört zu einer Stellung (FEN ohne Zugzähler). Dieselbe
  Stellung über eine andere Zugfolge ist dieselbe Karte.
- Wiederholungen werden nur angehängt, nie geändert. „Zurücksetzen“ setzt
  die Karten neu auf, das Protokoll bleibt.
- Beim ersten Öffnen nach dem Update wird der alte Fortschritt aus dem
  Browser-Speicher übernommen. Eine Kopie bleibt dort unter
  `deck-backup-…` liegen.

## Cloud (im Aufbau)

Der Sync über Firebase liegt im Ordner `firebase/`: Sicherheitsregeln,
Kostenbremse und Rollen. Beschreibung in `firebase/README.md`, die Schritte
in der Konsole in `firebase/SETUP.md`. Ohne Anmeldung ändert sich an der App
nichts.

**JBLBase-Konto** (Einstellungen → JBLBase-Konto):

- Anmelden oder registrieren mit E-Mail und Passwort, mit Bestätigungsmail
  und „Passwort vergessen“.
- „Mit Lichess anmelden“ öffnet den normalen Lichess-Login im Browser. Die
  Cloud Function `lichessLogin` fragt Lichess, wem das Token gehört, und
  meldet die App als `lichess:<id>` an. Das Lichess-Token wird nicht
  gespeichert, und es wird kein Lichess-Konto in der Kontenliste angelegt.
- Chess.com hat keine Anmeldung für fremde Apps und wird nur mit dem
  Benutzernamen verknüpft (geprüft über die öffentliche Chess.com-API).
- Die Rolle (Nutzer oder Admin) wird angezeigt. Sie steuert die
  Tiefengrenze 28 beim Speichern; Matts werden immer gespeichert.
- Firebase wird erst geladen, wenn man sich auf diesem Gerät einmal
  angemeldet hat.

**Private Cloud (Freigabeliste):** Nur Konten in `config/access` (Felder
`emails` und `lichess`, kleingeschrieben) und Admins dürfen synchronisieren;
E-Mail-Konten erst nach Bestätigung der Adresse. Nicht freigeschaltete
Lichess-Konten werden gar nicht angelegt. Einrichten: `firebase/SETUP.md`.

**Nutzungsbedingungen und Datenschutz** (`src/legal/`):

- Vor dem Registrieren und vor „Mit Lichess anmelden“ erscheint ein Fenster
  mit einer Kurzfassung, den vollen Texten und drei Häkchen
  (Nutzungsbedingungen, Datenschutzerklärung, mindestens 16 Jahre). Erst
  danach wird das Konto angelegt.
- Die Zustimmung wird unter `users/{uid}/consents/<AGB-Version>_<Datenschutz-Version>`
  gespeichert (Fassung, Weg, App-Version, Serverzeit). Die Regeln erlauben nur
  Anlegen, kein Ändern.
- Ändert sich ein Text inhaltlich, die Version in `src/legal/legal.ts` erhöhen.
  Angemeldete Konten werden dann beim nächsten Start gefragt; bis zur
  Zustimmung wird nicht synchronisiert. Kann die Zustimmung nicht geprüft
  werden (offline, Regeln noch nicht veröffentlicht), läuft der Sync weiter.
- Die Texte stehen auch unter Einstellungen → Datenschutz und Profil & Konten.
- **Konto löschen** (Profil & Konten) ruft die Cloud Function `deleteAccount`
  auf: Sie löscht alles unter `users/{uid}` und das Firebase-Konto. Die
  Dateien auf dem Gerät bleiben.
- Die Telemetrie von En Croissant (PostHog) ist entfernt; die App schickt keine
  Nutzungsdaten mehr.

**Synchronisierung** (läuft nur angemeldet; beim Start, alle 5 Minuten,
kurz nach Änderungen und per Knopf):

- **Repertoires** werden als ganze Dateien abgeglichen
  (`src/utils/cloud/repertoireSync.ts`). Jedes Gerät merkt sich pro
  Repertoire den Stand nach dem letzten Abgleich. Nur hier geändert:
  hochladen. Nur dort geändert: herunterladen. Beides geändert: Die neuere
  Fassung gilt, die andere bleibt als Datei „… (Konflikt <Datum>)“ (Typ
  „Sonstiges“) liegen. Umbenennen und Verschieben wandern mit. Gelöschte
  Repertoires bekommen eine Löschmarke; auf den anderen Geräten wird die
  Datei in `*.pgn.deleted-<Zeit>` umbenannt, nicht gelöscht. Fehlen auf
  einmal die meisten Dateien (z. B. anderer Ordner), wird nichts gelöscht.
- Beim ersten Abgleich auf einem zweiten Gerät werden Repertoires mit
  gleichem Pfad im Dateien-Ordner verknüpft. Sie übernehmen die ID aus der
  Cloud, der lokale Trainingsfortschritt zieht mit.
- **Trainingsfortschritt** (`src/utils/cloud/trainingSync.ts`): Karten mit
  „letzte Änderung gewinnt“, Wiederholungen nur anhängen. Der lokale
  Speicher merkt sich, was noch hochgeladen werden muss (Schema 2 in
  `training.rs`).
- PGN-Dateien über 900 KB gehen gzip-komprimiert in die Cloud (Feld
  `pgnGz`, etwa ein Fünftel der Größe). Version 1.0.28 kennt das Feld nicht
  und überspringt solche Repertoires. Wird eine Datei auch komprimiert größer
  als 900 KB, wird sie nicht hochgeladen; die Einstellungsseite sagt dann,
  welche.
- Jeder Abgleich merkt sich Serverzeit und Dokument-ID des zuletzt gelesenen
  Dokuments und liest beim nächsten Mal genau danach weiter
  (`src/utils/cloud/cursor.ts`). Ein Lauf ohne Änderungen liest nichts.

## Bauen

Voraussetzungen: Node 22, pnpm, Rust (stable), unter Windows zusätzlich die
„Desktop development with C++“-Werkzeuge von Visual Studio und WebView2
(bei Windows 10/11 meist schon da).

```bash
pnpm install
pnpm prepare:aix-extension   # lädt eine Hilfsbibliothek für die Partiedatenbank
pnpm tauri build             # Installer landet in src-tauri/target/release/bundle
```

Zum Entwickeln: `pnpm dev`.

Tests des Positionsspeichers:

```bash
cd src-tauri
cargo test eval_cache
# mit echter Engine:
JBLBASE_TEST_ENGINE=/pfad/zu/stockfish cargo test -- --ignored engine_cache
```

## Releases und Updates

Neue Versionen entstehen so: Version in `package.json` und
`src-tauri/Cargo.toml` erhöhen, dann auf GitHub unter **Releases → Draft a new
release** ein Release mit neuem Tag (z. B. `v1.0.1`) veröffentlichen. Alternativ
unter **Actions → Release → Run workflow** den Tag eingeben, dann legt der
Workflow das Release selbst an (als Entwurf, veröffentlicht erst, wenn beide Builds fertig sind; so bleibt der Update-Check währenddessen intakt). Der Workflow „Release“ baut dann signierte Installer für Windows und macOS und
veröffentlicht sie unter Releases. Installierte Apps finden das Update über
**Einstellungen → Nach Updates suchen** (und prüfen beim Start automatisch).

Die Update-Pakete sind mit einem eigenen Schlüssel signiert. Der private
Schlüssel liegt als Secret `TAURI_SIGNING_PRIVATE_KEY` im Repo, sein Passwort
als `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Geht eins davon verloren, können installierte Apps keine Updates mehr annehmen.
Die Installer sind nicht von Apple bzw. Microsoft beglaubigt.

**Windows:** Beim ersten Start erscheint eine SmartScreen-Warnung. Klicke auf
„Weitere Informationen“ und dann auf „Trotzdem ausführen“.

**macOS:** Die App ist nur ad-hoc signiert, nicht von Apple notarisiert. Das
würde ein kostenpflichtiges Apple-Developer-Konto (99 $/Jahr) voraussetzen.
Beim ersten Start meldet macOS deshalb „JBLBase“ kann nicht geöffnet werden.
Klicke auf **Fertig** und gehe dann so vor:

1. JBLBase aus der `.dmg` in den Ordner **Programme** ziehen.
2. Einmal starten und die Meldung mit **Fertig** schließen.
3. **Systemeinstellungen → Datenschutz & Sicherheit** öffnen, ganz nach unten
   scrollen und bei „JBLBase wurde blockiert“ auf **Trotzdem öffnen** klicken.
   Danach mit dem Passwort bestätigen.

Alternativ geht es im Terminal mit einem Befehl:

```bash
xattr -dr com.apple.quarantine /Applications/JBLBase.app
```

Danach startet die App normal, auch bei allen weiteren Starts. Nach jedem
neuen Download einer neuen Version ist der Schritt einmal zu wiederholen.
(Der früher übliche Weg „Rechtsklick → Öffnen“ funktioniert seit macOS 15
nicht mehr.)

## Lichess-Puzzles

Im Puzzle-Tab unter **Datenbank hinzufügen** gibt es die Karte
„Lichess-Puzzles (offiziell)“. Sie lädt
<https://database.lichess.org/lichess_db_puzzle.csv.zst> (über 5 Mio. Aufgaben,
CC0) und baut daraus lokal die Datei `Lichess Puzzles.duckdb` im
Puzzle-Ordner. Wer die Datei schon hat, nimmt „Aus Datei importieren“
(`.csv.zst` oder entpackte `.csv`). Ein erneuter Import ersetzt die alte
Fassung, Lichess aktualisiert die Datei monatlich.

## Puzzle-Streak und Puzzle-Elo

Im Puzzle-Tab schaltest du oben zwischen **Training** und **Streak** um.

- **Streak:** Die erste Aufgabe liegt 400 Punkte unter deiner Puzzle-Elo
  (mindestens 600), jede gelöste Aufgabe macht die nächste um 50 Punkte
  schwerer. Ein falscher Zug, ein Hinweis oder das Anzeigen der Lösung beendet
  die Streak, die Schwierigkeit fällt auf den Startwert zurück. Die
  Wertungsspanne und „Steigernd“ sind in der Streak ohne Wirkung. Hat die
  Datenbank bei der Zielwertung keine Aufgabe (kleine eigene Datenbanken), wird
  die nächstliegende genommen.
- **Puzzle-Elo:** Jede Aufgabe zählt beim ersten Versuch, im Training wie in
  der Streak. Du startest bei 1500, gerechnet wird wie beim Schach-Elo gegen
  die Wertung der Aufgabe (K = 40 für die ersten 20 Aufgaben, danach 20).
- **Statistik:** Das Diagramm-Symbol neben den Einstellungen zeigt Elo,
  Höchstwert, beste und aktuelle Streak, Trefferquote, Ø Zeit, den Elo-Verlauf
  und die letzten Streaks. Dort lässt sich alles zurücksetzen.

Gespeichert wird lokal in `puzzle_stats.json` im App-Datenordner (derselbe
Ordner wie der Positionsspeicher). Eine laufende Streak übersteht auch einen
Neustart der App.

## Blind-Puzzles

Im Puzzle-Tab stellst du unter dem Modus **Blind** auf 30, 20 oder 10 Sekunden.
Die Stellung ist dann so lange zu sehen (mit „Jetzt ausblenden“ früher), danach
verschwinden die Figuren und du ziehst auf dem leeren Brett. Der letzte
Gegnerzug steht über dem Brett in Notation, bei längeren Aufgaben auch jeder
weitere Gegnerzug und die bisherigen Züge. Zugpunkte, Zughervorhebung und
Schach-Markierung sind im Blindmodus aus, weil sie die Figuren verraten würden.
Ist die Aufgabe gelöst oder falsch, kommen die Figuren zurück. Blind gilt im
Training wie in der Streak.

- **Feldnamen zeigen:** schreibt a1 bis h8 auf jedes Feld, solange die Figuren
  ausgeblendet sind. Ohne den Schalter gibt es gar keine Koordinaten.
- **Zug eintippen:** ein Eingabefeld über dem Brett. Erkannt wird deutsche und
  englische Notation (`Sxd4`, `Nxd4`, `S:d4`, `Dh5`, `e8D`, `0-0`), auch klein
  geschrieben, mit Schachzeichen oder Zugnummer, und UCI (`f3d4`). Ein Zug, den
  es in der Stellung nicht gibt, wird nur angemerkt und zählt nicht als Fehler.
  Ziehen auf dem Brett geht weiterhin.

## Taktiksuche im Repertoire

Jede Repertoire-Karte hat den Knopf **Taktiken suchen**. Die Engine prüft jede
Stellung, in der der Repertoire-Besitzer am Zug ist (Standardtiefe 18):

- Eine Aufgabe entsteht, wenn es genau einen klar gewinnenden Zug gibt
  (mindestens +2,0 oder Matt, der zweitbeste Zug hält keinen Vorteil) und der
  letzte Zug des Gegners ein echter Fehler war. Erzwungenes Zurückschlagen in
  gewonnener Stellung zählt also nicht.
- Die Lösung läuft weiter, solange es jeweils nur einen Gewinnzug gibt.
- Motive (Gabel, Fesselung, Spieß, Abzug, Opfer, Matt in N, Grundreihenmatt …)
  tragen die Lichess-Namen, der Filter im Puzzle-Tab funktioniert also.
- Die Elo-Schätzung richtet sich danach, ab welcher Suchtiefe die Engine den
  Zug findet, wie lang die Lösung ist und ob geopfert wird. Die Gewichte sind
  von Hand gesetzt (`src-tauri/src/tactics/rating.rs`), bis du sie eichst:
  Auf der Insight-Seite misst „Elo-Schätzung eichen“ eine Stichprobe der
  importierten Lichess-Puzzles mit deiner Engine und passt die Gewichte per
  kleinsten Quadraten an deren Wertungen an (`rating_model.json` im
  App-Datenordner). Die Seite zeigt, wie weit die Schätzung im Schnitt
  danebenliegt. Sie findet die Lichess-Puzzles selbst (sonst die größte
  andere Puzzle-Datenbank) und bietet, wenn keine da ist, den Download an.

Die Aufgaben landen in `Repertoire-Taktiken.duckdb` im Puzzle-Ordner und
erscheinen im Puzzle-Tab als eigene Datenbank. Eine neue Suche ersetzt die
Aufgaben desselben Repertoires. Jede Aufgabe steht nur einmal in der
Datenbank: Führt ein anderes Repertoire (oder eine Zugumstellung) zur selben
Stellung mit demselben Gegnerzug, wird sie nicht noch einmal angelegt. Alle
Bewertungen gehen in den Positionsspeicher, eine zweite Suche rechnet also nur
neue Stellungen.

## Strenge, Tempo und die Suche in eigenen Partien

**Strenge** (bei beiden Taktiksuchen wählbar):

|                                                       | Locker | Normal      | Streng      |
| ----------------------------------------------------- | ------ | ----------- | ----------- |
| Vorsprung nach dem ersten Zug                         | +1,5   | +2,0        | +3,0        |
| Abstand zum zweitbesten Zug (Gewinnchancen)           | 0,4    | 0,5         | 0,6         |
| Zweitbester Zug höchstens                             | +1,5   | +1,0        | +0,5        |
| Fehler des Gegners mindestens (Gewinnchancen)         | 0,25   | 0,3         | 0,4         |
| Einfaches Zurückschlagen, hängende Figur nehmen       | zählt  | zählt nicht | zählt nicht |
| Einzüger braucht ein Motiv (Gabel, Fesselung, Matt …) | nein   | nein        | ja          |
| Nachprüfung tiefer                                    | –      | +4 Halbzüge | +6 Halbzüge |

Dazu kommt „Mindestens eigene Züge in der Lösung“ (ab 2 nur Kombinationen).
Insight nutzt für übersehene Taktiken die Stufe Normal.

**Tempo:** Jede Stellung wird zuerst mit nur einer Linie bewertet (meist
direkt aus dem Positionsspeicher). Nur wo du danach klar besser stehst und der
letzte Zug des Gegners ein echter Fehler war, rechnet die Engine zwei Linien.
Die Antworten des Gegners in der Lösung brauchen ebenfalls nur eine Linie. Statt
einer Engine mit allen Threads rechnen mehrere Engines mit je einem Thread
nebeneinander (höchstens 8, je nach Leistung), jede an ihrer eigenen Stellung
bzw. Partie. Die Engine für die Elo-Schätzung startet erst, wenn wirklich eine
Taktik gefunden ist. Gemessen auf 4 Kernen, Tiefe 14, 16 Partien: vorher 219 s,
jetzt 42 s; ein zweiter Lauf kommt ganz aus dem Speicher (unter 1 s).

**Repertoire:** „Taktiken für Mich / Den Gegner“. Mit „Den Gegner“ findet die
Suche Fallen, die dein Gegner in deinen Linien stellen kann.

**Eigene Partien:** Im Puzzle-Tab öffnet das Zielscheiben-Symbol „Taktiken in
eigenen Partien suchen“. Wählbar sind Spieler (Konten und in Insight
hinzugefügte Spieler), Farbe, Zeitraum, Bedenkzeit, Ergebnis, höchstens N
Partien (neueste zuerst) und ob übersehene, gefundene oder beide Arten von
Taktiken gesammelt werden. Die Aufgaben landen in `Partien-Taktiken.duckdb`,
Partie für Partie, ein Abbruch verliert also nichts. Was Insight in derselben
Partie schon gefunden hat, wird nicht doppelt angelegt.

## Leistung und Restzeit

Taktiksuche, Insight und die Prüfung gemeldeter Aufgaben haben eine gemeinsame
Einstellung **Leistung**: Gering (ein Viertel der Kerne, 64 MB Hash), Mittel
(die Hälfte, 256 MB), Hoch (alle bis auf einen, 512 MB) und Maximal. Sie setzt
nur Threads und Hash, die übrigen Engine-Einstellungen bleiben. Vor dem Start
steht eine geschätzte Dauer, während des Laufs die Restzeit. Die Schätzung ist
anfangs grob und richtet sich nach jedem fertigen Lauf (je Tiefe und Stufe)
nach der gemessenen Geschwindigkeit dieses Rechners.

## Gemeldete Aufgaben

Im Puzzle-Tab meldet das Fähnchen eine Aufgabe als falsch (falsche Lösung,
anderer Zug gewinnt auch, Elo passt nicht, Sonstiges). Die Meldungen liegen
getrennt von den Puzzle-Datenbanken in `puzzle_reports.sqlite3` im
App-Datenordner und erscheinen unter **Gemeldete Aufgaben** (Symbol neben der
Datenbankauswahl). Dort prüft Stockfish sie in Tiefe 30 (einstellbar) und
schlägt vor:

- **Doch richtig**: Die gespeicherte Lösung ist auch tief gerechnet die
  einzige gewinnende (oder die Engine würde sie nur weiterführen).
- **Korrigieren**: Ein anderer erster Zug gewinnt, die Fortsetzung weicht ab
  oder die Aufgabe geht zu weit. Die neue Lösung und Elo stehen dabei.
- **Löschen**: Es gibt keinen eindeutig gewinnenden Zug.

Entschieden wird von Hand. Die Entscheidung wird in der Puzzle-Datenbank
vermerkt (Tabelle `reviews`), damit eine spätere Taktiksuche eine gelöschte
Aufgabe nicht zurückbringt und eine korrigierte korrigiert lässt.

Test mit echter Engine:

```bash
cd src-tauri
JBLBASE_TEST_ENGINE=/pfad/zu/stockfish cargo test -- --ignored tactics
```

## Insight

Die Seite **Insight** (Seitenleiste) analysiert alle Partien der verbundenen
Lichess- und Chess.com-Konten, die neuesten zuerst. Oben wählst du den
Spieler: alle Konten zusammen oder eines davon, für Analyse und Statistik.
„Spieler hinzufügen“ nimmt auch jemanden auf, dessen Partien in einer
Datenbank liegen, ohne verbundenes Konto.

- Tiefe 18 (Standard) oder 24, wahlweise nur eine bestimmte Zahl Partien pro
  Lauf. Anhalten verliert nichts: Fertige Partien stehen in
  `insight.sqlite3` im App-Datenordner, alle Bewertungen im Positionsspeicher.
- Je Zug wird gemessen, wie viel Gewinnchance er kostet (Formeln wie bei
  Lichess): ab 10 Punkten Ungenauigkeit, ab 20 Fehler, ab 30 Patzer (auf der
  Skala von -100 bis 100).
- Statistiken: Genauigkeit gesamt und pro Monat, nach Partiephase, Farbe,
  Bedenkzeit und Ergebnis, dazu die größten Patzer und die brillanten Züge.
- **Eröffnungen:** Getrennt nach Weiß und Schwarz, und nur die Eröffnungen,
  die du selbst gewählt hast: Den Namen gibt die tiefste bekannte Stellung,
  die durch einen deiner eigenen Züge entstand. Was der Gegner danach daraus
  macht, ändert den Namen nicht mehr.
- **Brillante Züge (!!):** Dein Zug ist der beste Zug der Engine, opfert
  mindestens eine Qualität (gemessen wie bei „Brillante Züge suchen“), du
  stehst danach nicht schlechter als −0,8, und vor dem letzten Zug des
  Gegners standest du nicht schon über +4. Ein Opfer, das nur dank eines
  gegnerischen Fehlers geht, zählt also.
- **Zur Partie springen:** Ein Klick auf einen Patzer oder brillanten Zug
  öffnet die Partie auf einem neuen Brett, direkt nach diesem Zug. Deine
  Züge tragen die Markierungen von Insight (?!, ?, ??, !!), nach jedem
  Fehler steht die bessere Fortsetzung als Variante, und jede Stellung hat
  die Bewertung aus dem Positionsspeicher (Bewertungskurve), ohne neu zu
  rechnen.
- Partien, die eine ältere Insight-Version analysiert hat, gelten als nicht
  analysiert, bis du die Analyse erneut startest. Das geht schnell, weil die
  Bewertungen schon im Positionsspeicher liegen; bis dahin bleiben ihre alten
  Zahlen sichtbar, nur ohne !! und eigene Eröffnungen.
- Übersehene Taktiken (du hattest einen einzigen Gewinnzug und hast ihn nicht
  gespielt) werden zu Aufgaben in `Partien-Taktiken.duckdb` und erscheinen im
  Puzzle-Tab, mit Motiv und geschätzter Elo wie bei der Repertoire-Suche.
- **Tempo:** Statt einer Engine mit allen Threads rechnen mehrere Engines
  nebeneinander, jede an einer eigenen Partie mit einem Thread (höchstens
  acht Engines; Hash wird aufgeteilt). Bei „Hoch“ auf 12 Kernen sind das acht
  Engines. Kurze Suchen
  bis Tiefe 18 nutzen viele Threads einer Engine schlecht, mehrere Engines
  schaffen deutlich mehr Stellungen. Jede Stellung wird mit einer Linie
  bewertet; die zweite Linie (ist der Gewinnzug der einzige?) wird nur dort
  gerechnet, wo du einen gewinnenden Zug ausgelassen hast. Tiefe und
  Bewertung bleiben gleich, Stellungen aus dem Positionsspeicher werden wie
  bisher nicht neu gerechnet. Die Engine für die Elo-Schätzung startet erst,
  wenn eine Partie wirklich eine übersehene Taktik hat.

Test mit echter Engine:

```bash
cd src-tauri
JBLBASE_TEST_ENGINE=/pfad/zu/stockfish cargo test -- --ignored insight
```
