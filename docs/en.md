# ChargePoint

Control your ChargePoint home chargers (ChargePoint Home, Home Flex) from
Gladys, follow your charging sessions — at home and on the public network —
and watch the availability of the public stations you use.

The integration talks to the ChargePoint cloud, the same one the ChargePoint
mobile app uses (it is a JavaScript port of the
[python-chargepoint](https://github.com/mbillow/python-chargepoint) library
behind the Home Assistant integration
[ha-chargepoint](https://github.com/mbillow/ha-chargepoint)). It is a
**cloud** integration: Gladys needs Internet access, and the chargers must be
online.

> This integration is not affiliated with ChargePoint, Inc.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Enter the **e-mail** (or username) and the **password** of your
   ChargePoint account, then save.
3. The status at the top of the page turns green once connected. The
   **Test the connection** button tells you how many home chargers and public
   stations were found.
4. Open the **Discovery** tab and add the devices you want.

The integration then keeps the session alive by itself: ChargePoint renews it
on every request, and the latest one is stored in the integration's private
`/data` volume, so a restart does not log in again.

### When ChargePoint asks for a captcha

ChargePoint protects its login page with a bot detection (Datadome). When it
blocks the password login, the status says _ChargePoint asks for a captcha_.
Use the session of your browser instead:

1. Sign in on [chargepoint.com](https://www.chargepoint.com) in a desktop
   browser.
2. Open the developer tools (F12) → **Application** (Chrome, Edge) or
   **Storage** (Firefox) → **Cookies** → `https://www.chargepoint.com`.
3. Copy the value of the `coulomb_sess` cookie.
4. Paste it in the **Session token (coulomb_sess)** field of the
   configuration and save.

The token is a secret: Gladys never shows it again, and the integration never
writes it to its logs.

### Options

- **Refresh interval** — how often ChargePoint is read, in seconds: 3 minutes
  by default, 1 minute at least. Commands trigger an extra read a few seconds
  later.
- **Public stations to follow** — the IDs of public ChargePoint stations,
  separated by commas. To find them, use the **Find stations nearby** button
  with the latitude and longitude of a place: it lists the IDs of the stations
  around it.

## Devices

### Home charger

One device per ChargePoint home charger of the account, named after its
nickname in the ChargePoint app.

| Feature                | What it does                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| Charging               | Starts (1) or stops (0) a charging session                       |
| Vehicle plugged in     | Whether the cable is plugged into a vehicle                      |
| Connector status       | Available, occupied, unavailable (charger offline) or faulted    |
| Charging state         | Charging, vehicle connected, paused by the vehicle or charger…   |
| Charging power         | Power delivered by the current session (W)                       |
| Session energy         | Energy of the current or last session (kWh)                      |
| Session cost           | Cost of the current or last session                              |
| Session duration       | Duration of the current or last session (minutes)                |
| Charging current limit | Maximum charging current (A), among the values the charger takes |
| Charging schedule      | Turns the charging schedule of the ChargePoint app on or off     |
| LED brightness         | Brightness of the charger LEDs (0 % = off, by steps of 20 %)     |

Starting a session needs a plugged-in vehicle. ChargePoint confirms start and
stop commands within about a minute; the state follows on the next read.

### ChargePoint account

The balance of the account and the session in progress wherever it runs, a
public station included (charging, power, energy, cost).

### Public station

One device per followed station: its availability (available as soon as one
port is free) and the number of free ports.

Every device shows a **cloud** badge, which turns to _unreachable_ when
ChargePoint or the charger cannot be reached.

## Actions (Configuration screen)

- **Test the connection** — connects, reads everything, and reports the
  account and what it found.
- **Restart a home charger** — restarts the chosen charger remotely (it goes
  offline for a few minutes).
- **Find stations nearby** — lists the IDs of the public stations around a
  latitude / longitude (radius 100 m to 5 km).

## Scenes

The integration adds its own cards to the scene editor (Gladys 5.1 or later),
under the **Integrations** category.

Triggers (leave the device empty to match any):

- **Charging started** — a home charger, or the account (public station),
  starts charging.
- **Charging stopped** — a session ends. The following actions can read
  `{{triggerEvent.data.energy_kwh}}`, `{{triggerEvent.data.cost}}` and
  `{{triggerEvent.data.duration_minutes}}`.
- **Vehicle plugged in** / **Vehicle unplugged** — the cable of a home
  charger.
- **Public station available** — a followed station had no free port and now
  has one (`{{triggerEvent.data.available_ports}}`).

Actions:

- **Start charging** — returns `started`: false when no vehicle is plugged
  in, so the next actions can react.
- **Stop charging** — on a charger, or any session in progress when no device
  is chosen; returns `stopped`.
- **Set the current limit** — returns the current actually applied (the
  closest value the charger accepts, never above the requested one).
- **Set the charging schedule** — enables it (optionally with new weekday /
  weekend times, `HH:MM`) or disables it.
- **Restart a home charger**.

Example: _when the electricity is cheap (off-peak trigger), start charging;
when charging stops, send me the energy and the cost_.

## Dashboard

- **ChargePoint charger** — pick a home charger in the widget settings: live
  power, energy and current limit, its state, cable, network, schedule,
  duration and cost of the session, and a **Start charging** / **Stop
  charging** button.
- **ChargePoint account** — balance, live power, the session in progress, the
  free ports of the followed stations, and a **Stop charging** button during
  a session.

## Troubleshooting

- **Status "ChargePoint refused the e-mail or the password"** — check them in
  the ChargePoint app; the e-mail is the one of the account.
- **Status "ChargePoint asks for a captcha"** — see
  [above](#when-chargepoint-asks-for-a-captcha).
- **Status "The ChargePoint session expired"** — enter your password (the
  integration then renews the session alone) or a new session token.
- **A charger shows _unreachable_** — the charger lost its Wi-Fi connection to
  ChargePoint; check it in the ChargePoint app.

Set `LOG_LEVEL=debug` to get the details of every request in the integration
logs (Gladys UI, or `docker logs`). Tokens and passwords are never logged.
