# EX-IPTV für Android – Anleitung

Diese Anleitung führt dich Schritt für Schritt von null bis zur fertigen App auf
deinem Handy, Android-Fernseher oder Fire-TV-Stick. Du brauchst **keinen**
Entwickler-PC und **kein** Android Studio – die App wird kostenlos in der
GitHub-Cloud gebaut.

---

## Was du brauchst

- Ein kostenloses GitHub-Konto (Anmeldung dauert 2 Minuten).
- Diese Projektdateien (die Sie gerade als ZIP erhalten haben).
- Deine Xtream-Zugangsdaten vom IPTV-Anbieter: Server-Adresse, Benutzername, Passwort.

---

## Teil 1 – Projekt zu GitHub hochladen

### 1. GitHub-Konto erstellen
Gehe auf **https://github.com** und registriere dich (falls noch nicht geschehen).

### 2. Neues Repository (Projekt) anlegen
- Oben rechts auf das **+** klicken → **New repository**.
- **Repository name:** z. B. `ex-iptv`
- Auf **privat** oder **öffentlich** stellen (beides geht).
- **Nicht** „Add a README" anhaken.
- Auf **Create repository** klicken.

### 3. Die Projektdateien hochladen
- Entpacke die erhaltene ZIP-Datei auf deinem Computer.
- Auf der neuen GitHub-Seite auf **uploading an existing file** klicken
  (oder **Add file → Upload files**).
- Ziehe **den gesamten Inhalt** des entpackten Ordners in das Browserfenster.

> **Wichtig:** Es muss ein Ordner namens **`.github`** mit dabei sein (er enthält
> die Bau-Anweisung). Falls dein Datei-Manager Ordner mit einem Punkt am Anfang
> ausblendet, schalte „versteckte Dateien anzeigen" ein – sonst startet der Bau nicht.

- Unten auf **Commit changes** klicken.

---

## Teil 2 – Die App wird automatisch gebaut

Sobald die Dateien hochgeladen sind, startet der Bau von selbst.

- Klicke oben auf den Reiter **Actions**.
- Du siehst einen Lauf namens **APK bauen**. Ein gelber Punkt heißt „läuft gerade",
  ein grüner Haken heißt „fertig". Der erste Bau dauert ca. **3–6 Minuten**.
- Falls dort nichts erscheint: auf **Actions** → links **APK bauen** → rechts
  **Run workflow** klicken, um den Bau von Hand zu starten.

### Die fertige App herunterladen
- Klicke auf den fertigen (grünen) Lauf.
- Ganz unten unter **Artifacts** liegt eine Datei namens **EX-IPTV-APK**.
- Lade sie herunter und **entpacke** sie – darin liegt die Datei **`app-debug.apk`**.

Das ist deine Installationsdatei.

---

## Teil 3 – App auf die Geräte bringen

### Auf dem Handy / Tablet
1. Übertrage die `app-debug.apk` aufs Handy (z. B. per Download, USB oder Messenger).
2. Öffne die Datei. Android fragt nach der Erlaubnis, Apps aus „unbekannten Quellen"
   zu installieren – diese einmalig erteilen.
3. Auf **Installieren** tippen. Fertig – die App **EX-IPTV** liegt im App-Menü.

### Auf dem Fire-TV-Stick
1. Am Fire-TV: **Einstellungen → Mein Fire-TV → Entwickleroptionen** →
   **Apps unbekannter Herkunft** einschalten.
2. Installiere aus dem Amazon-App-Store die kostenlose App **Downloader**.
3. Lade die `app-debug.apk` irgendwo hoch, wo man sie per Link herunterladen kann
   (z. B. ein eigener Cloud-Speicher), und gib diesen Link in **Downloader** ein.
4. Die App lädt und installiert sich. EX-IPTV erscheint dann unter „Apps & Sender".

### Auf dem Android-Fernseher
1. **Einstellungen → Geräteeinstellungen → Sicherheit** → unbekannte Quellen erlauben.
2. Genau wie beim Fire-TV mit der **Downloader**-App oder einem USB-Stick installieren.

---

## Teil 4 – Erste Nutzung

Beim ersten Start fragt die App nach:
- **Server-Adresse** (z. B. `http://deinserver.de:8080`)
- **Benutzername**
- **Passwort**

Diese bekommst du von deinem IPTV-Anbieter. Nach der Anmeldung siehst du links die
Kategorien und rechts die Sender. Mit **Fingertipp** (Handy) oder **Fernbedienung**
(TV/Fire-Stick, Steuerkreuz + OK-Taste) wählst du einen Sender aus.

---

## Bedienung

- **Handy:** alles per Fingertipp.
- **Fernseher / Fire-Stick:** mit der Fernbedienung. Das aktuell ausgewählte Feld
  ist violett hervorgehoben. Mit dem Steuerkreuz bewegst du die Auswahl, mit **OK**
  bestätigst du, mit **Zurück** verlässt du die Wiedergabe.

---

## Was diese erste Version kann (und was noch kommt)

Diese erste Fassung (0.1.0) ist bewusst schlank und deckt den Kern ab:
**Anmeldung mit Xtream-Zugangsdaten und Live-Fernsehen.**

Noch **nicht** enthalten und für die nächsten Versionen geplant:
Filme und Serien (VOD), Programmführer (EPG), Favoriten, M3U-Listen, Aufnahmen,
Suche – also schrittweise das, was die Windows-Version schon kann.

---

## Wenn der Bau fehlschlägt

Da diese App neu ist und nicht auf jedem Gerät vorab getestet werden konnte, kann
der allererste Bau in der Cloud einen Fehler zeigen (das ist normal bei einer
Erstfassung). In dem Fall:

1. Gehe zu **Actions** → auf den **roten** (fehlgeschlagenen) Lauf klicken.
2. Klicke auf den Schritt **Debug-APK bauen**, sodass die rote Fehlermeldung
   sichtbar wird.
3. Kopiere die Fehlermeldung (oder mache einen Screenshot) und schicke sie mir.

Ich behebe den Fehler dann gezielt – genau wie wir es bei der Windows-Version
gemacht haben, nur dass das Bauen hier in der Cloud statt auf deinem PC passiert.
