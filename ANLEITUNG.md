# EX-IPTV für Android – Anleitung (Version 0.2.0)

Diese Version baut die **echte Oberfläche der Windows-App** ein: dieselbe
Startseite mit Logo und Kacheln, dieselbe Seitenleiste, dieselben Bildschirme.
Das gelingt, indem die App den Original-Server im Hintergrund mitlaufen lässt
und seine Oberfläche in einem eingebauten Browserfenster anzeigt.

---

## Was sich gegenüber der ersten Version geändert hat

- **Vorher (0.1.0):** nur ein einfacher Anmelde-Bildschirm und eine Senderliste,
  ohne Startseite.
- **Jetzt (0.2.0):** die komplette Original-Oberfläche – Startseite, Kacheln,
  Filme, Serien, Programmführer, Favoriten – genau wie auf dem PC.

---

## Teil 1 – Das aktualisierte Projekt zu GitHub bringen

Du hast das Projekt **AndroidIPTV2026** schon mit GitHub Desktop eingerichtet.
Wir tauschen jetzt nur die alten Dateien gegen die neuen aus.

### 1. Den Projektordner öffnen
In **GitHub Desktop** oben auf **Repository → Show in Explorer**. Es öffnet sich
der Ordner, den GitHub Desktop verwaltet (darin liegt auch der versteckte
`.git`-Ordner).

### 2. Die alten Projektdateien löschen
Markiere im geöffneten Ordner **alles außer dem versteckten `.git`-Ordner** und
lösche es. (Den `.git`-Ordner unbedingt behalten – er ist die Verbindung zu
GitHub. Falls versteckte Ordner nicht sichtbar sind: im Explorer oben
**Anzeigen → Einblenden → Ausgeblendete Elemente**.)

### 3. Die neuen Dateien einfügen
- Entpacke die neue ZIP-Datei, die du gerade erhalten hast.
- Öffne den entpackten Ordner, markiere **den gesamten Inhalt** (Strg+A) –
  also die Ordner `app`, `.github`, `gradle` und die losen Dateien.
- Kopiere alles (Strg+C) und füge es in den GitHub-Projektordner ein (Strg+V).

> Achte wieder darauf, dass der versteckte Ordner **`.github`** mit dabei ist.

### 4. Hochladen
Geh zurück in **GitHub Desktop**. Links unter „Changes" erscheinen jetzt viele
geänderte Dateien. Schreib unten ins Feld **Summary** z. B.
`Echte Oberflaeche eingebaut`, klick auf **Commit to main** und danach oben auf
**Push origin**.

---

## Teil 2 – Die App wird automatisch gebaut

- Geh auf github.com in dein Projekt, Reiter **Actions**.
- Der Lauf **APK bauen** startet von selbst (gelber Punkt = läuft,
  grüner Haken = fertig). Dauer: ca. 4–7 Minuten.

### Die fertige App herunterladen
- Auf den fertigen (grünen) Lauf klicken.
- Unten unter **Artifacts** die Datei **EX-IPTV-APK** herunterladen und
  entpacken – darin liegt **app-debug.apk**.

---

## Teil 3 – Installieren

Genau wie bei der ersten Version:

- **Handy:** APK übertragen, antippen, „unbekannte Quellen" einmalig erlauben,
  installieren.
- **Fire-TV-Stick:** Einstellungen → Mein Fire-TV → Entwickleroptionen →
  „Apps unbekannter Herkunft" einschalten; mit der **Downloader**-App über einen
  Link installieren.
- **Android-TV:** unbekannte Quellen erlauben; per **Downloader** oder USB-Stick.

Die App ist deutlich größer als vorher (ca. 25–30 MB), weil der komplette Server
mit eingebaut ist. Das ist normal.

---

## Teil 4 – Erste Nutzung

Beim Start zeigt die App kurz „Wird gestartet …", während der Server hochfährt
(ein paar Sekunden). Dann erscheint die **echte Startseite** mit Logo und Kacheln.

Beim ersten Mal ist noch keine Senderliste hinterlegt. Über die Oberfläche
(genau wie auf dem PC) fügst du deine Liste hinzu – entweder mit
**Xtream-Zugangsdaten** (Server, Benutzer, Passwort) oder als **M3U-Link**.
Danach stehen Live-TV, Filme und Serien zur Verfügung.

---

## Bedienung

- **Handy:** alles per Fingertipp.
- **Fernseher / Fire-Stick:** mit der Fernbedienung (Steuerkreuz + OK,
  Zurück-Taste). Die Oberfläche ist auf Fokus-Steuerung ausgelegt.

---

## Wichtig: Was schon geht und was noch Feinarbeit braucht

Der größte Schritt ist geschafft – die **Oberfläche ist jetzt identisch** mit der
Windows-App. Was auf deinem Gerät noch erprobt werden muss, ist die
**Videowiedergabe im eingebauten Browserfenster**: ob die Sender so flüssig
laufen wie auf dem PC.

Bitte teste nach der Installation vor allem:
1. Erscheint die Startseite mit Logo und Kacheln?
2. Kannst du eine Senderliste hinzufügen und die Sender sehen?
3. Spielt ein Sender ab?

Falls die Startseite erscheint, aber ein Sender nicht abspielt oder ruckelt:
Das ist der erwartete nächste Baustein. Beschreib mir genau, was passiert
(am besten mit Screenshot), dann arbeite ich gezielt an der Wiedergabe weiter –
so wie wir es bei der Windows-App über viele Runden gemacht haben.

**Noch nicht enthalten:** die höchsten Umwandlungsstufen (ffmpeg) für Sender mit
ungewöhnlichen Tonformaten. Die direkte Wiedergabe und der Formatwechsel sind
dabei; ffmpeg wird später nachgerüstet, falls einzelne Sender es brauchen.

---

## Wenn der Bau fehlschlägt

1. **Actions** → auf den **roten** Lauf klicken.
2. Auf den Schritt **Debug-APK bauen** klicken, damit die Fehlermeldung
   sichtbar wird.
3. Fehlermeldung kopieren oder Screenshot machen und mir schicken – ich behebe
   es gezielt.
