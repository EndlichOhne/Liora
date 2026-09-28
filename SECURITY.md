# Sicherheit von Liora

Dieser Text beschreibt, was der Code tut. Er behauptet nicht, dass das System unhackbar oder vollständig sicher ist.

## Grenzen

Liora ist eine private Anwendung mit Anmeldung. Jede Zeile privater Daten hängt an `user_id`. Eine fremde Kennung liefert dasselbe „nicht gefunden“ wie eine fehlende Kennung. Row Level Security ist nicht aktiv: die Anwendung verbindet sich als Tabellenbesitzer und filtert in den Abfragen. Das ist kein zweiter Datenbankzwang.

## Anmeldung

Better Auth. Cookies: Secure, SameSite=Lax, Path=/, Namen mit `__Host-`. HttpOnly kommt aus dem Better-Auth-Standard. Eine Sitzung läuft nach 12 Stunden ab. Die Sitzungs-ID wird nicht bei jedem Aufruf rotiert.

WebAuthn und Hardware-Schlüssel sind nicht eingerichtet.

Anmeldung, Registrierung und Zurücksetzen sind auf 10 Versuche in 10 Minuten je Netz begrenzt. Der Zähler steht in der Datenbank, nicht nur im Prozess. Die Antwort nennt kein Konto. Der genaue Text einer falschen Anmeldung kommt von Better Auth.

Wiederherstellungscodes werden gehasht. Nach erfolgreicher Nutzung wird der Code gelöscht.

## Produktion

Wenn die Umgebung als Produktion läuft (`VERCEL_ENV=production`, nicht während `npm run build`), startet die Datenbankverbindung nicht ohne `DATABASE_URL`, ein `BETTER_AUTH_SECRET` von mindestens 32 Zeichen und `BETTER_AUTH_URL`. Auth darf dort nicht ausgeschaltet sein. Die Vorschau nutzt weiter die lokale Datenbank.

## Daten

Neon, wenn `DATABASE_URL` gesetzt ist. Sonst eine Datei-PGLite unter `.data/pglite`. Ein Anwendungs-Backup der Produktionsdatenbank ist nicht eingerichtet. Eine lokale Kopie kann der Code anlegen; sie ist nicht verschlüsselt. Verschlüsselung im Ruhezustand durch den Anbieter wurde nicht geprüft. Transport in Produktion setzt HTTPS voraus; HSTS setzt nur die HTML-Middleware der Produktionsumgebung.

## Export und Löschen

Export und Kontolöschung verlangen eine Bestätigung, die 10 Minuten gilt. Das ist keine erneute Passworteingabe und kein zweiter Faktor. Gelöscht wird das eigene Benutzerkonto. Verknüpfte eigene Zeilen fallen über die Fremdschlüssel weg. Fremde Konten werden nicht gelöscht.

## Dateien

Erlaubte Typen sind Text, CSV, Markdown, PDF, DOCX, Tabellen und Bilder. Ausführbare Endungen werden abgelehnt. PDF und Bilder werden am Dateianfang geprüft. Der Dateiname wird auf den letzten Pfadteil gekürzt. Dokumenttext ist Daten, keine Anweisung.

## Netz

Recherche-Abrufe akzeptieren nur https. localhost, private Netze, Link-Local, Metadaten-Hosts, `file:`, `ftp:` und `gopher:` werden abgelehnt. Nach der DNS-Auflösung wird jede Antwortadresse geprüft. Eine Weiterleitung wird erneut geprüft und nicht verfolgt, wenn das Ziel privat ist.

Es gibt kein `Access-Control-Allow-Origin: *` im Anwendungscode. Eine eigene CORS-Middleware ist nicht eingerichtet.

In der Vorschau setzt die HTML-Antwort `nosniff`, eine Referrer-Policy und eine enge Permissions-Policy. Kein HSTS und kein `frame-ancestors`, weil die Vorschau in einem Rahmen läuft. In Produktion kommt `frame-ancestors` für die eigene Seite und grok.com dazu. Eine Script-CSP ist nicht gesetzt. `X-Frame-Options` ist nicht gesetzt.

## KI und Agenten

Schlüssel des Modellanbieters bleiben auf dem Server. Es gibt keinen `VITE_`-Namen dafür im Client, soweit der Sicherheitsbericht keinen solchen Namen sieht. Werte werden nicht angezeigt.

Agenten haben eine erlaubte Werkzeugliste. Alles andere ist verweigert. Es gibt keinen separaten Prozess, der das für jeden Lauf erzwingt.

Die Anwendung ändert Sicherheits-, Auth- oder Produktionscode nicht selbst.

Es gibt keinen Code-Ausführer.

## Protokoll

Gespeichert werden Aktion, Ressource und Ergebnis. Keine Passwörter, Tokens oder Dokumentinhalte.

## Wenn ein Geheimnis bekannt wird

1. Das Geheimnis beim Anbieter widerrufen.
2. Ein neues Geheimnis setzen, nicht das alte im Code lassen.
3. Sitzungen ungültig machen, indem das Auth-Geheimnis rotiert wird.
4. Das Protokoll auf `PERMISSION_DENIED` und `ACCOUNT_CHANGE` prüfen.
5. Falls Daten verändert wurden, aus einem Backup wiederherstellen. Ein Produktions-Backup ist derzeit nicht eingerichtet.
6. Den Vorfall festhalten, ohne das Geheimnis in das Protokoll zu schreiben.

## Bekannte Lücken

- Keine Row Level Security
- Kein WebAuthn
- Keine Script-CSP
- Keine geprüfte Verschlüsselung im Ruhezustand
- Kein Produktions-Backup
- Schritt-Bestätigung ist kein zweites Passwort
- Die Sitzung rotiert nicht
- Vektorsuche ist nicht eingerichtet
