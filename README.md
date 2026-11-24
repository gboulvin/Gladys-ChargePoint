# ChargePoint for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that
controls **ChargePoint** EV chargers: your ChargePoint Home / Home Flex
chargers, your ChargePoint account, and the public stations you follow.

It is a JavaScript port of
[python-chargepoint](https://github.com/mbillow/python-chargepoint) and
[ha-chargepoint](https://github.com/mbillow/ha-chargepoint) (the Home
Assistant integration), built on the official
[integration template](https://github.com/GladysAssistant/integration-template-js)
and the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js).

> Not affiliated with ChargePoint, Inc.

- **Cloud** integration (`transports: ["cloud"]`) — requires Gladys **5.1.0**
  or later.
- Languages: English, French, German, Spanish.
- User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
  [Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

| Surface         | What you get                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home charger    | Start / stop charging, current limit, charging schedule, LED brightness, plugged in, connector status, charging state, power, session energy / cost / duration, cloud badge |
| Account         | Balance, session in progress anywhere (public stations included): charging, power, energy, cost                                                                             |
| Public stations | Availability and free ports of the stations you follow                                                                                                                      |
| Scene triggers  | Charging started, charging stopped (energy, cost, duration), vehicle plugged in, vehicle unplugged, public station available                                                |
| Scene actions   | Start charging, stop charging, set the current limit, set the charging schedule, restart a home charger                                                                     |
| Widgets         | **ChargePoint charger** (live tiles, state, Start / Stop) and **ChargePoint account** (balance, session, followed stations)                                                 |
| Configuration   | Test the connection, restart a home charger, find the stations nearby                                                                                                       |

## Configuration

Enter the e-mail and password of your ChargePoint account. If ChargePoint's
bot protection asks for a captcha, paste the `coulomb_sess` cookie of
chargepoint.com in the **Session token** field instead — see the
[documentation](docs/en.md#when-chargepoint-asks-for-a-captcha). The renewed
session is kept in the integration's `/data` volume.

## Development

```bash
npm install
npm test               # node --test, against a fake ChargePoint cloud and the SDK's fake Gladys
npm run lint           # ESLint
npm run format:check   # Prettier
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="chargepoint" \
DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the project rules.

## Release

Describe the changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md),
then **Actions → Release → Run workflow** (patch / minor / major). The workflow
bumps the version in `package.json` and the manifest, moves the changelog,
tags, builds the multi-arch image to `ghcr.io/gboulvin/gladys-chargepoint` and
publishes the GitHub Release.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability privately.

## License

MIT — see [LICENSE](LICENSE). Portions ported from python-chargepoint and
ha-chargepoint, © Marc Billow, MIT.
