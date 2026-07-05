# Gerettete Web-Quelle (Stand 1.10.34)
Aus den fertigen Programmdateien zurückgewonnen (Go bettet web/ per go:embed als
Klartext ein; Extraktion via laufendem Server unter QEMU + validierte Schnitte).
- app.js / tvnav.js: vom laufenden 1.10.33-Server geholt (identisch mit 1.10.34), Syntax geprüft.
- style.css / index.html: Stand 1.10.34 (inkl. Handy-Layout), aus der Windows-EXE, geprüft.
- assets/ + vendor/: vollständig vom Server geholt.
Zweck: Grundlage für den Neubau des Go-Servers (siehe ../SERVER-SPEZIFIKATION.md)
und für künftige UI-Arbeit. NICHT löschen.
