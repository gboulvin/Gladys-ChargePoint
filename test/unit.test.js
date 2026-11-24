// Pure helpers: configuration, translations, mappings, controller messages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseStationIds } from '../src/config.js';
import { LANGUAGES, MESSAGES, t } from '../src/i18n.js';
import {
  CHARGING_STATE,
  CHARGING_STATE_LABELS,
  CONNECTOR_STATUS,
  CONNECTOR_STATUS_LABELS,
  closestAmperage,
  countAvailablePorts,
  currencyUnit,
  homeChargerChargingState,
  homeChargerConnectorStatus,
  isValidTime,
  ledLevelToPercent,
  percentToLedLevel,
  publicStationConnectorStatus,
} from '../src/mapping.js';
import { connectionErrorMessage } from '../src/controller.js';
import {
  CaptchaError,
  InvalidSessionError,
  LoginError,
  MissingCredentialsError,
  ChargePointError,
} from '../src/chargepoint/errors.js';

// --- Configuration ----------------------------------------------------------------

test('normalizeConfig returns the defaults when called with no argument', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.equal(config[key], value);
  }
  assert.deepEqual(config.publicStationIds, []);
});

test('normalizeConfig bounds the refresh interval and trims the credentials', () => {
  assert.equal(normalizeConfig({ poll_frequency: '10' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 180);
  assert.equal(normalizeConfig({ username: '  me@x.com ' }).username, 'me@x.com');
});

test('station ids accept commas, spaces and new lines, without duplicates', () => {
  assert.deepEqual(parseStationIds('123, 456;789\n123 abc'), [123, 456, 789]);
  assert.deepEqual(parseStationIds(''), []);
});

// --- Translations -------------------------------------------------------------------

test('every message exists in the four languages with the same placeholders', () => {
  for (const [key, message] of Object.entries(MESSAGES)) {
    const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join();
    for (const lang of LANGUAGES) {
      assert.ok(message[lang], `${key}.${lang}`);
      assert.equal(placeholders(message[lang]), placeholders(message.en), `${key}.${lang}`);
    }
  }
});

test('t() fills the placeholders in every language', () => {
  const text = t('ports_available', { available: 1, total: 2 });
  assert.equal(text.en, '1/2 available');
  assert.equal(text.de, '1/2 frei');
  assert.throws(() => t('nope'), /Unknown message/);
});

test('every state has a label', () => {
  for (const value of Object.values(CONNECTOR_STATUS))
    assert.ok(MESSAGES[CONNECTOR_STATUS_LABELS[value]]);
  for (const value of Object.values(CHARGING_STATE))
    assert.ok(MESSAGES[CHARGING_STATE_LABELS[value]]);
});

test('connection errors map to a message the user can act on', () => {
  assert.deepEqual(connectionErrorMessage(new MissingCredentialsError()), t('missing_credentials'));
  assert.deepEqual(connectionErrorMessage(new CaptchaError('x', 'u')), t('captcha_required'));
  assert.deepEqual(connectionErrorMessage(new LoginError('x')), t('invalid_credentials'));
  assert.deepEqual(connectionErrorMessage(new InvalidSessionError('x')), t('session_expired'));
  assert.deepEqual(connectionErrorMessage(new ChargePointError('x')), t('unreachable'));
});

// --- Mappings ------------------------------------------------------------------------

const status = (overrides = {}) => ({
  isConnected: true,
  isPluggedIn: false,
  chargingStatus: 'AVAILABLE',
  isDuringScheduledTime: false,
  ...overrides,
});

test('home charger connector status', () => {
  assert.equal(homeChargerConnectorStatus(null), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(
    homeChargerConnectorStatus(status({ isConnected: false })),
    CONNECTOR_STATUS.UNAVAILABLE,
  );
  assert.equal(homeChargerConnectorStatus(status()), CONNECTOR_STATUS.AVAILABLE);
  assert.equal(
    homeChargerConnectorStatus(status({ isPluggedIn: true })),
    CONNECTOR_STATUS.OCCUPIED,
  );
  assert.equal(
    homeChargerConnectorStatus(status({ chargingStatus: 'FAULTED' })),
    CONNECTOR_STATUS.FAULTED,
  );
});

test('home charger charging state', () => {
  const plugged = status({ isPluggedIn: true });
  assert.equal(homeChargerChargingState(status(), null, null), CHARGING_STATE.IDLE);
  assert.equal(homeChargerChargingState(plugged, null, null), CHARGING_STATE.EV_CONNECTED);
  assert.equal(
    homeChargerChargingState(status({ isPluggedIn: true, chargingStatus: 'CHARGING' }), null),
    CHARGING_STATE.CHARGING,
  );
  assert.equal(
    homeChargerChargingState(plugged, null, { scheduleEnabled: true }),
    CHARGING_STATE.PAUSED_BY_CHARGER,
  );
  assert.equal(
    homeChargerChargingState(plugged, { chargingState: 'IN_USE', powerKw: 0 }, null),
    CHARGING_STATE.PAUSED_BY_VEHICLE,
  );
  assert.equal(
    homeChargerChargingState(plugged, { chargingState: 'IN_USE', powerKw: 3 }, null),
    CHARGING_STATE.CHARGING,
  );
});

test('public station availability', () => {
  const station = (...statuses) => ({ ports: statuses.map((s) => ({ status: s })), status: '' });
  assert.equal(publicStationConnectorStatus(null), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(
    publicStationConnectorStatus(station('in_use', 'available')),
    CONNECTOR_STATUS.AVAILABLE,
  );
  assert.equal(
    publicStationConnectorStatus(station('in_use', 'in_use')),
    CONNECTOR_STATUS.OCCUPIED,
  );
  assert.equal(publicStationConnectorStatus(station('out_of_service')), CONNECTOR_STATUS.FAULTED);
  assert.equal(publicStationConnectorStatus(station('unavailable')), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(countAvailablePorts(station('available', 'available', 'in_use')), 2);
});

test('amperage, LED, currency and time helpers', () => {
  assert.equal(closestAmperage(30, [16, 24, 32]), 24);
  assert.equal(closestAmperage(10, [16, 24, 32]), 16);
  assert.equal(closestAmperage(31.6, []), 32);
  assert.equal(ledLevelToPercent(3), 60);
  assert.equal(percentToLedLevel(85, [0, 1, 2, 3, 4, 5]), 4);
  assert.equal(percentToLedLevel(100, [0, 2, 4]), 4);
  assert.equal(currencyUnit('eur'), 'euro');
  assert.equal(currencyUnit('JPY'), undefined);
  assert.ok(isValidTime('07:30'));
  assert.ok(!isValidTime('7:30'));
  assert.ok(!isValidTime('24:00'));
});
