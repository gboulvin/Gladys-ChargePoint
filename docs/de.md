# ChargePoint

Steuern Sie Ihre ChargePoint-Heim-Ladestationen (ChargePoint Home, Home Flex)
aus Gladys, verfolgen Sie Ihre Ladevorgänge — zu Hause und im öffentlichen
Netz — und behalten Sie die Verfügbarkeit der öffentlichen Stationen im
Blick, die Sie nutzen.

Die Integration spricht mit der ChargePoint-Cloud, derselben wie die
ChargePoint-App (sie ist eine JavaScript-Portierung der Bibliothek
[python-chargepoint](https://github.com/mbillow/python-chargepoint) hinter der
Home-Assistant-Integration
[ha-chargepoint](https://github.com/mbillow/ha-chargepoint)). Es ist eine
**Cloud**-Integration: Gladys braucht Internetzugang, und die Ladestationen
müssen online sein.

> Diese Integration steht in keiner Verbindung zu ChargePoint, Inc.

## Konfiguration

1. Öffnen Sie den Reiter **Konfiguration** der Integration.
2. Geben Sie die **E-Mail** (oder den Benutzernamen) und das **Passwort**
   Ihres ChargePoint-Kontos ein und speichern Sie.
3. Der Status oben auf der Seite wird grün, sobald die Verbindung steht. Die
   Schaltfläche **Verbindung testen** zeigt, wie viele Heim-Ladestationen und
   öffentliche Stationen gefunden wurden.
4. Öffnen Sie den Reiter **Erkennung** und fügen Sie die gewünschten Geräte
   hinzu.

Die Integration hält die Sitzung danach selbst aktiv: ChargePoint erneuert
sie bei jeder Anfrage, und die neueste wird im privaten Volume `/data` der
Integration gespeichert, sodass ein Neustart keine neue Anmeldung erfordert.

### Wenn ChargePoint ein Captcha verlangt

ChargePoint schützt seine Anmeldeseite mit einer Bot-Erkennung (Datadome).
Blockiert sie die Anmeldung per Passwort, meldet der Status _ChargePoint
verlangt ein Captcha_. Verwenden Sie dann die Sitzung Ihres Browsers:

1. Melden Sie sich in einem Desktop-Browser auf
   [chargepoint.com](https://www.chargepoint.com) an.
2. Öffnen Sie die Entwicklertools (F12) → **Anwendung** (Chrome, Edge) oder
   **Web-Speicher** (Firefox) → **Cookies** → `https://www.chargepoint.com`.
3. Kopieren Sie den Wert des Cookies `coulomb_sess`.
4. Fügen Sie ihn in das Feld **Sitzungstoken (coulomb_sess)** der
   Konfiguration ein und speichern Sie.

Das Token ist geheim: Gladys zeigt es nie wieder an, und die Integration
schreibt es nie in ihre Logs.

### Optionen

- **Aktualisierungsintervall** — wie oft ChargePoint gelesen wird, in
  Sekunden: standardmäßig 3 Minuten, mindestens 1 Minute. Ein Befehl löst
  einige Sekunden später eine zusätzliche Abfrage aus.
- **Zu verfolgende öffentliche Stationen** — die IDs öffentlicher
  ChargePoint-Stationen, durch Kommas getrennt. Um sie zu finden, verwenden
  Sie die Schaltfläche **Stationen in der Nähe finden** mit Breiten- und
  Längengrad eines Ortes: Sie listet die IDs der Stationen in der Umgebung.

## Geräte

### Heim-Ladestation

Ein Gerät pro ChargePoint-Heim-Ladestation des Kontos, benannt nach ihrem
Spitznamen in der ChargePoint-App.

| Funktion               | Bedeutung                                                          |
| ---------------------- | ------------------------------------------------------------------ |
| Charging               | Startet (1) oder beendet (0) einen Ladevorgang                     |
| Vehicle plugged in     | Ob das Kabel an einem Fahrzeug steckt                              |
| Connector status       | Verfügbar, belegt, nicht verfügbar (offline) oder gestört          |
| Charging state         | Lädt, Fahrzeug verbunden, pausiert (Fahrzeug oder Ladestation)…    |
| Charging power         | Leistung des laufenden Ladevorgangs (W)                            |
| Session energy         | Energie des laufenden oder letzten Ladevorgangs (kWh)              |
| Session cost           | Kosten des laufenden oder letzten Ladevorgangs                     |
| Session duration       | Dauer des laufenden oder letzten Ladevorgangs (Minuten)            |
| Charging current limit | Maximaler Ladestrom (A), unter den Werten der Ladestation          |
| Charging schedule      | Schaltet den Ladeplan der ChargePoint-App ein oder aus             |
| LED brightness         | Helligkeit der LEDs der Ladestation (0 % = aus, in 20-%-Schritten) |

Ein Ladevorgang kann nur mit angeschlossenem Fahrzeug starten. ChargePoint
bestätigt Start- und Stoppbefehle innerhalb etwa einer Minute; der Status
folgt bei der nächsten Abfrage.

### ChargePoint-Konto

Das Guthaben des Kontos und der laufende Ladevorgang, wo auch immer er
stattfindet, öffentliche Stationen eingeschlossen (Laden, Leistung, Energie,
Kosten).

### Öffentliche Station

Ein Gerät pro verfolgter Station: ihre Verfügbarkeit (verfügbar, sobald ein
Anschluss frei ist) und die Anzahl freier Anschlüsse.

Jedes Gerät zeigt ein **Cloud**-Abzeichen, das auf _nicht erreichbar_
wechselt, wenn ChargePoint oder die Ladestation nicht antwortet.

## Aktionen (Konfigurationsseite)

- **Verbindung testen** — verbindet sich, liest alles und meldet das Konto
  und die Funde.
- **Heim-Ladestation neu starten** — startet die gewählte Ladestation aus der
  Ferne neu (sie ist einige Minuten offline).
- **Stationen in der Nähe finden** — listet die IDs der öffentlichen
  Stationen um einen Breiten-/Längengrad auf (Radius 100 m bis 5 km).

## Szenen

Die Integration fügt dem Szenen-Editor (Gladys 5.1 oder neuer) eigene Karten
in der Kategorie **Integrationen** hinzu.

Auslöser (Gerät leer lassen, um alle zu erfassen):

- **Ladevorgang gestartet** — eine Heim-Ladestation oder das Konto
  (öffentliche Station) beginnt zu laden.
- **Ladevorgang beendet** — ein Ladevorgang endet. Die folgenden Aktionen
  können `{{triggerEvent.data.energy_kwh}}`, `{{triggerEvent.data.cost}}` und
  `{{triggerEvent.data.duration_minutes}}` lesen.
- **Fahrzeug eingesteckt** / **Fahrzeug ausgesteckt** — das Kabel einer
  Heim-Ladestation.
- **Öffentliche Station frei** — eine verfolgte Station hatte keinen freien
  Anschluss und hat jetzt einen (`{{triggerEvent.data.available_ports}}`).

Aktionen:

- **Laden starten** — liefert `started`: falsch, wenn kein Fahrzeug
  angeschlossen ist, damit die folgenden Aktionen reagieren können.
- **Laden stoppen** — an einer Ladestation oder jeden laufenden Ladevorgang,
  wenn kein Gerät gewählt ist; liefert `stopped`.
- **Strombegrenzung einstellen** — liefert den tatsächlich angewendeten Strom
  (nächster akzeptierter Wert, nie über dem angeforderten).
- **Ladeplan einstellen** — aktiviert ihn (optional mit neuen Zeiten für
  Wochentage / Wochenende, `HH:MM`) oder deaktiviert ihn.
- **Heim-Ladestation neu starten**.

Beispiel: _Wenn der Strom günstig ist (Niedertarif-Auslöser), Laden starten;
wenn das Laden endet, mir Energie und Kosten schicken_.

## Dashboard

- **ChargePoint-Ladestation** — wählen Sie in den Widget-Einstellungen eine
  Heim-Ladestation: Leistung, Energie und Strombegrenzung live, ihr Status,
  Kabel, Netzwerk, Ladeplan, Dauer und Kosten des Ladevorgangs und eine
  Schaltfläche **Laden starten** / **Laden stoppen**.
- **ChargePoint-Konto** — Guthaben, Leistung live, laufender Ladevorgang,
  freie Anschlüsse der verfolgten Stationen und eine Schaltfläche **Laden
  stoppen** während eines Ladevorgangs.

## Fehlerbehebung

- **Status „ChargePoint hat die E-Mail oder das Passwort abgelehnt“** —
  prüfen Sie sie in der ChargePoint-App; die E-Mail ist die des Kontos.
- **Status „ChargePoint verlangt ein Captcha“** — siehe
  [oben](#wenn-chargepoint-ein-captcha-verlangt).
- **Status „Die ChargePoint-Sitzung ist abgelaufen“** — geben Sie Ihr
  Passwort ein (die Integration erneuert die Sitzung dann selbst) oder ein
  neues Sitzungstoken.
- **Eine Ladestation ist _nicht erreichbar_** — die Ladestation hat ihre
  WLAN-Verbindung zu ChargePoint verloren; prüfen Sie sie in der
  ChargePoint-App.

Setzen Sie `LOG_LEVEL=debug`, um die Details jeder Anfrage in den Logs der
Integration zu sehen (Gladys-Oberfläche oder `docker logs`). Tokens und
Passwörter werden nie protokolliert.
