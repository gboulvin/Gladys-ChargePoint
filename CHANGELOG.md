# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First release of the ChargePoint integration for Gladys Assistant (5.1.0 or
  later), a JavaScript port of python-chargepoint / ha-chargepoint.
- Sign-in with the ChargePoint e-mail and password, or with the `coulomb_sess`
  session token when ChargePoint asks for a captcha. The renewed session is
  kept in `/data`, and an expired one triggers an automatic re-login.
- Home charger devices: start / stop charging, charging current limit,
  charging schedule, LED brightness, vehicle plugged in, connector status and
  charging state, charging power, session energy, cost and duration.
- ChargePoint account device: balance and the session in progress, public
  stations included.
- Public station devices for the stations the user follows: availability and
  free ports.
- A cloud transport badge on every device, unreachable when the charger or
  ChargePoint is.
- Scene triggers: charging started, charging stopped (with energy, cost and
  duration), vehicle plugged in, vehicle unplugged, public station available.
- Scene actions: start charging, stop charging, set the current limit, set
  the charging schedule, restart a home charger.
- Dashboard widgets: one home charger (live tiles, state, Start / Stop) and
  the account (balance, session, followed stations, Stop).
- Configuration actions: test the connection, restart a home charger, find
  the public stations nearby.
- English, French, German and Spanish everywhere: manifest, messages, widgets
  and documentation.

[Unreleased]: https://github.com/gboulvin/Gladys-ChargePoint/commits/main
