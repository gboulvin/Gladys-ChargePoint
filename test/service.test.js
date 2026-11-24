import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChargePointService } from '../src/service.js';
import { normalizeConfig } from '../src/config.js';
import { createTokenStore } from '../src/tokenStore.js';
import {
  InvalidSessionError,
  MissingCredentialsError,
  CaptchaError,
} from '../src/chargepoint/errors.js';
import {
  CHARGER_ID,
  STATION_ID,
  createChargePointState,
  createFakeFetch,
  createMemoryStore,
  homeSession,
  noSleep,
} from './fixtures/fakeChargePoint.js';

function setup({
  state = createChargePointState(),
  store = createMemoryStore(),
  config = {},
} = {}) {
  const service = new ChargePointService({ store, fetch: createFakeFetch(state), sleep: noSleep });
  return {
    service,
    state,
    store,
    config: normalizeConfig({ username: 'driver@example.com', password: 'secret', ...config }),
  };
}

test('without credentials, connect asks for them', async () => {
  const { service } = setup();
  await assert.rejects(service.connect(normalizeConfig({})), MissingCredentialsError);
  await assert.rejects(
    service.connect(normalizeConfig({ username: 'driver@example.com' })),
    MissingCredentialsError,
  );
});

test('a password login stores the session token', async () => {
  const { service, store, config } = setup();
  await service.connect(config);
  assert.ok(service.connected);
  assert.deepEqual(store.value, { username: 'driver@example.com', token: 'fresh-token' });
});

test('the stored token is preferred: no password login on restart', async () => {
  const { service, state, config } = setup({
    store: createMemoryStore({ username: 'driver@example.com', token: 'good-token' }),
  });
  await service.connect(config);
  assert.equal(state.calls.filter((c) => c.url.includes('user/login')).length, 0);
});

test('a refused stored token falls back to the configured token, then to the password', async () => {
  const { service, state, config } = setup({
    store: createMemoryStore({ username: 'driver@example.com', token: 'expired' }),
    config: { coulomb_token: 'also-expired' },
  });
  await service.connect(config);
  assert.equal(service.client.token, 'fresh-token');
  assert.equal(state.calls.filter((c) => c.url.includes('user/login')).length, 1);
});

test('a token pasted in the configuration works without a password', async () => {
  const { service, config } = setup({ config: { password: '', coulomb_token: 'good-token' } });
  await service.connect(config);
  assert.ok(service.connected);
});

test('a captcha on login is reported as such', async () => {
  const { service, config } = setup({ state: createChargePointState({ captchaOnLogin: true }) });
  await assert.rejects(service.connect(config), CaptchaError);
});

test('refresh builds the snapshot of the whole account', async () => {
  const { service, config } = setup({ config: { public_stations: `${STATION_ID}` } });
  await service.connect(config);
  const snapshot = await service.refresh();
  assert.equal(snapshot.account.balance, 12.5);
  assert.equal(snapshot.currency.code, 'USD');
  assert.equal(snapshot.session, null);
  const charger = snapshot.homeChargers[CHARGER_ID];
  assert.equal(charger.status.isConnected, true);
  assert.equal(charger.config.stationNickname, 'Garage');
  assert.equal(charger.techInfo.softwareVersion, '5.5.1');
  assert.equal(snapshot.publicStations[STATION_ID].name, 'Town Hall Lot 2');
});

test('a charger whose status fails is kept, reported without status', async () => {
  const { service, state, config } = setup();
  await service.connect(config);
  state.failStatus = true;
  const snapshot = await service.refresh();
  assert.equal(snapshot.homeChargers[CHARGER_ID].status, null);
  assert.ok(snapshot.homeChargers[CHARGER_ID].config, 'the other reads still succeed');
});

test('a session API hiccup keeps the last known session', async () => {
  const { service, state, config } = setup();
  await service.connect(config);
  state.session = homeSession();
  const first = await service.refresh();
  assert.equal(first.session.energyKwh, 7.25);
  state.failSession = true;
  const second = await service.refresh();
  assert.equal(second.session.energyKwh, 7.25);
});

test('the last session of a device stays readable once finished', async () => {
  const { service, state, config } = setup();
  await service.connect(config);
  state.session = homeSession();
  await service.refresh();
  state.session = null;
  await service.refresh();
  assert.equal(service.sessionAt(CHARGER_ID), null);
  assert.equal(service.lastSessionAt(CHARGER_ID).energyKwh, 7.25);
});

test('an expired session re-logs in once by itself', async () => {
  const { service, state, config } = setup();
  await service.connect(config);
  state.validTokens.clear();
  state.issuedToken = 'second-token';
  const snapshot = await service.refresh();
  assert.ok(snapshot.account);
  assert.equal(service.client.token, 'second-token');
});

test('without a password, an expired session surfaces to the user', async () => {
  const { service, state, config } = setup({
    config: { password: '', coulomb_token: 'good-token' },
  });
  await service.connect(config);
  state.validTokens.clear();
  await assert.rejects(service.refresh(), InvalidSessionError);
});

test('a renewed cookie is persisted', async () => {
  const { service, state, store, config } = setup();
  await service.connect(config);
  state.renewToken = 'renewed';
  await service.refresh();
  assert.equal(store.value.token, 'renewed');
});

test('stopCharging resolves false when nothing is charging', async () => {
  const { service, config } = setup();
  await service.connect(config);
  await service.refresh();
  assert.equal(await service.stopCharging(null), false);
});

test('enabling the schedule reuses the known times when none are given', async () => {
  const { service, state, config } = setup();
  await service.connect(config);
  await service.refresh();
  await service.setSchedule(CHARGER_ID, true, { weekdayStart: '22:00' });
  assert.deepEqual(state.schedule.userSchedule, {
    weekdays: { startTime: '22:00', endTime: '07:00' },
    weekends: { startTime: '23:00', endTime: '07:00' },
  });
  await service.setSchedule(CHARGER_ID, false);
  assert.equal(state.schedule.scheduleEnabled, false);
});

test('the token store writes an owner-only file and reads it back', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
  const store = createTokenStore(dir);
  assert.equal(await store.read(), null);
  await store.write('me', 'tok');
  assert.deepEqual(await store.read(), { username: 'me', token: 'tok' });
  const file = path.join(dir, 'chargepoint-session.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { username: 'me', token: 'tok' });
});
