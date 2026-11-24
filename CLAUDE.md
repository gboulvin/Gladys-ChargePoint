# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

The **ChargePoint** external integration for Gladys Assistant: a Node.js
service (Node 22+, ESM, no build step) that runs in its own sandboxed Docker
container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

The ChargePoint side is a JavaScript port of
[python-chargepoint](https://github.com/mbillow/python-chargepoint), the library
behind the Home Assistant integration
[ha-chargepoint](https://github.com/mbillow/ha-chargepoint). When ChargePoint
changes its API, look at those two repositories first: same endpoints, same
payloads, same authentication.

It is a **cloud** integration (manifest `transports: ["cloud"]`): no local API.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/service.test.js          # one file
node --test --test-name-pattern "schedule" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                     SDK wiring only: handlers registered before connect()
src/chargepoint/client.js    ChargePoint API client (port of python-chargepoint) + parsers
src/chargepoint/errors.js    LoginError, InvalidSessionError, CaptchaError...
src/service.js               session (stored token -> configured token -> password),
                             snapshot refresh, commands; auto re-login on 401
src/controller.js            refresh loop, publication (devices, states, scene events,
                             transports), operations shared by every surface, onSetValue
src/devices.js               Gladys devices + features (state functions) from a snapshot
src/mapping.js               pure ChargePoint -> Gladys mappings (OCPP-aligned enums)
src/events.js                scene triggers: transitions between two snapshots
src/scenes.js                scene action handlers (manifest `scene_actions`)
src/actions.js               Configuration screen actions (manifest `actions`)
src/widgets.js               dashboard widgets (manifest `widgets`)
src/i18n.js                  every user-facing message, en / fr / de / es
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/tokenStore.js            session token persisted in /data (0600)
gladys-assistant-integration.json  manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (en + fr mandatory)
test/                        node --test, fake ChargePoint cloud (test/fixtures) + the
                             SDK's fake Gladys
.github/scripts/release.mjs  release helpers (manifest bump, changelog), tested in test/
```

Data flow: the controller loop calls `service.refresh()` every
`poll_frequency` seconds → one immutable snapshot → `buildStates` +
`publishChangedStates`, `detectSceneEvents` + `publishSceneEvent`,
`publishTransports`, widget nudge. Commands go through the controller, then
schedule a quick refresh: never publish a scene event from a command.

## Rules

- **External ids are forever.** Devices are `home-charger:<charger id>`,
  `account:<user id>`, `public-station:<device id>` (built with
  `gladys.externalIds`), features use the keys of `FEATURES` in
  `src/devices.js`. Never rename one; the same goes for the manifest
  `config_schema`, `actions`, scene and widget keys and their fields/outputs.
- **Every feature carries `name`, `min`, `max`, `read_only` and
  `has_feedback`**: Gladys stores them NOT NULL. `test/devices.test.js` checks it.
- **Secrets.** The password and the `coulomb_sess` token are `secret` fields.
  Never log them, never put them in an error message, a scene output or a
  widget. The token file lives in `/data` only (the rootfs is read-only).
- **Gladys acks a feature command under 5 s.** Start/stop are confirmed by
  ChargePoint in up to a minute: `onSetValue` answers once the command is
  accepted (`runSessionCommand`), scene actions (timeout 90 s) wait for the
  confirmation.
- **Partial failures never empty the dashboard**: keep the previous session
  on a session API error, report a charger without status as unavailable.
- **Four languages.** Every user-facing text exists in English, French, German
  and Spanish: manifest texts (`label`, `description`, `placeholder`),
  messages (`src/i18n.js`, use `t()`), widget labels and `docs/*.md`, kept in
  sync. `test/manifest.test.js` and `test/unit.test.js` check them.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow does.
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language. Scene and widget fields need `gladys_version >=5.1.0`.
  `test/manifest.test.js` ties the manifest to the handlers: change both sides
  together.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network: extend
  `test/fixtures/fakeChargePoint.js` instead.
