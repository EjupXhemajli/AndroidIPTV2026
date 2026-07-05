# Audit-Log EX-IPTV Android

## 0.4.29 (Player-Härtung, Basis 0.4.28 / In-App 1.10.33)
Skill: code-audit. Nur Kotlin editierbar (Go-Server liegt als .so vor).
- [H] MainActivity.kt:712 Hard-Recover: prepare-Fehler wurde verschluckt -> jetzt geloggt UND Eskalation via handleFailure() (Stream bleibt nicht tot).
- [M] MainActivity.kt:503,512,667,703,772 leere catch-Blöcke -> android.util.Log.w (Diagnose weltweiter Ausfälle).
- [N] MainActivity.kt:325 Connect-Timeout 20s -> 13s (schnelleres Failover bei blockierten Auslands-Servern; Read bleibt 20s).
- Offen (nicht im Repo editierbar): Go-Server (User-Agent/429, Playlist-Fetch-Backoff, DNS) nur als kompilierte .so vorhanden.
- Keystore app/exiptv.jks weiterhin im öffentlichen Repo -> rotieren + entfernen (nur du im Repo).

## 0.4.30 (Weltweit-Härtung Teil 2 + Quellcode-Rettung)
- [H] MainActivity.kt buildSource: User-Agent "EX-IPTV/1.0" -> "VLC/3.0.20 LibVLC/3.0.20".
  Beleg app.js:1545: Live/VOD gehen als DIREKTE Provider-URLs an ExoPlayer -> UA wirkt beim Anbieter.
  Unbekannte UAs werden von restriktiven Panels geblockt (429-Klasse).
- [H] Neue WorldErrorPolicy: 429/503 nicht mehr fatal, sondern Backoff 4s..20s, bis 12 Versuche.
- [+] web-quelle/ ins Repo: komplette Web-UI (app.js, style.css 1.10.34, index.html, tvnav.js,
  assets, vendor) aus Binaries gerettet; SERVER-SPEZIFIKATION.md (alle Routen) als Neubau-Grundlage.

## 0.4.31 (Länder-Robustheit + Mehrfachlisten geprüft)
- [FAKT] Live-Test am emulierten Server: /api/playlist/add nimmt 16/16 Listen an, KEIN Limit
  vorhanden; enabled-Regler und userAgent existieren pro Liste. 15 Listen = bereits möglich.
- [H] Neuer DNS-Resolver im nativen Player: DNS-über-HTTPS (cloudflare-dns.com, Bootstrap
  1.1.1.1/1.0.0.1) mit SafeDns-Fallback aufs System-DNS. Umgeht nationale DNS-Sperren
  für Provider-Domains (typische Ursache "läuft in Land A, nicht in Land B").
- [H] buildSource: DefaultHttpDataSource -> media3 OkHttpDataSource(streamHttpClient);
  Timeouts 13s/20s im Client, Redirects via OkHttp-Standard.
- [DEP] media3-datasource-okhttp:1.4.1, okhttp:4.12.0, okhttp-dnsoverhttps:4.12.0.

## 0.4.32 (Handy-Layout aktiviert: UI aus App-Assets)
- [ROOT-CAUSE] Repo-Basis 0.4.28 -> .so-UI 1.10.33 OHNE Handy-Layout (das kam erst in 1.10.34/0.4.29,
  nie ins Repo hochgeladen). Deshalb volle Seitenleiste auf dem Telefon.
- [FIX] WebViewClient.shouldInterceptRequest: index.html/app.js/style.css/tvnav.js kommen jetzt aus
  app/src/main/assets/web/ (gerettete 1.10.34-Quelle inkl. @media max-width:600px). Fallback: Server.
- [+] Versionsanzeige unten links jetzt "v<server>-a1" -> eindeutige Kontrolle, dass die Asset-UI aktiv ist.
- Konsequenz: Oberfläche ist wieder voll wartbar ohne Go-Quellcode (Assets statt .so).
