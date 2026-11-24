import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChargePointClient, readSessionCookie, parseStation } from '../src/chargepoint/client.js';
import { CaptchaError, InvalidSessionError, LoginError } from '../src/chargepoint/errors.js';
import {
  CHARGER_ID,
  USER_ID,
  createChargePointState,
  createFakeFetch,
  homeSession,
  noSleep,
} from './fixtures/fakeChargePoint.js';

async function loggedIn(state = createChargePointState()) {
  const client = new ChargePointClient({
    username: 'driver@example.com',
    token: 'good-token',
    fetch: createFakeFetch(state),
    sleep: noSleep,
  });
  await client.discover();
  await client.initAccount();
  return { client, state };
}

test('discovery reads the region and the endpoints of the account', async () => {
  const state = createChargePointState();
  const client = new ChargePointClient({ username: 'u', fetch: createFakeFetch(state) });
  const config = await client.discover();
  assert.equal(config.region, 'NA-US');
  assert.equal(config.currency.symbol, '$');
  assert.equal(config.endpoints.accounts_endpoint, 'https://account.test/account/');
  assert.deepEqual(state.calls[0].body, { username: 'u' });
});

test('a password login keeps the coulomb_sess cookie and reads the account', async () => {
  const state = createChargePointState();
  const client = new ChargePointClient({ username: 'u', fetch: createFakeFetch(state) });
  await client.discover();
  await client.loginWithPassword('secret');
  assert.equal(client.token, 'fresh-token');
  assert.equal(client.userId, USER_ID);
  // The session username wins over the typed one.
  assert.equal(client.username, 'driver@example.com');
});

test('a wrong password is a LoginError', async () => {
  const state = createChargePointState();
  const client = new ChargePointClient({ username: 'u', fetch: createFakeFetch(state) });
  await client.discover();
  await assert.rejects(client.loginWithPassword('nope'), LoginError);
});

test('a Datadome block is a CaptchaError carrying the captcha URL', async () => {
  const state = createChargePointState({ captchaOnLogin: true });
  const client = new ChargePointClient({ username: 'u', fetch: createFakeFetch(state) });
  await client.discover();
  await assert.rejects(client.loginWithPassword('secret'), (err) => {
    assert.ok(err instanceof CaptchaError);
    assert.equal(err.captchaUrl, 'https://captcha.test/challenge');
    return true;
  });
});

test('an expired token is an InvalidSessionError', async () => {
  const state = createChargePointState();
  const client = new ChargePointClient({
    username: 'u',
    token: 'expired',
    fetch: createFakeFetch(state),
  });
  await client.discover();
  await assert.rejects(client.initAccount(), InvalidSessionError);
});

test('every response renewing the cookie updates the token', async () => {
  const { client, state } = await loggedIn();
  state.renewToken = 'renewed';
  await client.getAccount();
  assert.equal(client.token, 'renewed');
});

test('authenticated requests carry the session headers, never the password', async () => {
  const { client, state } = await loggedIn();
  const headers = [];
  const fetch = client.fetch;
  client.fetch = (url, init) => {
    headers.push(init.headers);
    return fetch(url, init);
  };
  await client.getHomeChargers();
  assert.equal(headers[0]['cp-session-type'], 'CP_SESSION_TOKEN');
  assert.equal(headers[0]['cp-region'], 'NA-US');
  assert.match(headers[0].cookie, /^coulomb_sess=good-token$/);
  assert.ok(!JSON.stringify(state.calls).includes('secret'));
});

test('home charger data is parsed into stable shapes', async () => {
  const { client } = await loggedIn();
  assert.deepEqual(await client.getHomeChargers(), [CHARGER_ID]);
  const status = await client.getHomeChargerStatus(CHARGER_ID);
  assert.equal(status.chargingStatus, 'AVAILABLE');
  assert.equal(status.amperageLimit, 32);
  assert.deepEqual(status.possibleAmperageLimits, [16, 24, 32, 40, 48]);
  const config = await client.getHomeChargerConfig(CHARGER_ID);
  assert.equal(config.stationNickname, 'Garage');
  assert.equal(config.ledBrightness.level, 3);
  const schedule = await client.getHomeChargerSchedule(CHARGER_ID);
  assert.equal(schedule.scheduleEnabled, false);
  assert.equal(schedule.defaultSchedule.weekdays.startTime, '23:00');
});

test('the active session is read through the user status, null when idle', async () => {
  const { client, state } = await loggedIn();
  assert.equal(await client.getUserChargingStatus(), null);
  state.session = homeSession();
  const status = await client.getUserChargingStatus();
  assert.equal(status.sessionId, 555);
  const session = await client.getChargingSession(status.sessionId);
  assert.equal(session.deviceId, CHARGER_ID);
  assert.equal(session.chargingState, 'IN_USE');
  assert.equal(session.powerKw, 7.2);
  assert.equal(session.energyKwh, 7.25);
});

test('start waits for the acknowledgement, calling onSent first', async () => {
  const state = createChargePointState({ ackAttemptsBeforeOk: 3 });
  const { client } = await loggedIn(state);
  const order = [];
  await client.startSession(CHARGER_ID, () => order.push('sent'));
  order.push('confirmed');
  assert.deepEqual(order, ['sent', 'confirmed']);
  assert.equal(state.startedOn, CHARGER_ID);
  const acks = state.calls.filter((c) => c.url.endsWith('session/ack'));
  assert.equal(acks.length, 3);
  assert.deepEqual(acks[0].body, { ackId: 99, action: 'start_session' });
});

test('a command never acknowledged fails after 20 attempts', async () => {
  const state = createChargePointState({ ackAttemptsBeforeOk: 1000 });
  const { client } = await loggedIn(state);
  await assert.rejects(client.startSession(CHARGER_ID), /pending/);
  assert.equal(state.calls.filter((c) => c.url.endsWith('session/ack')).length, 20);
});

test('stop sends the port and the session of the running session', async () => {
  const { client, state } = await loggedIn();
  await client.stopSession({ deviceId: CHARGER_ID, outletNumber: 2, sessionId: 555 });
  assert.deepEqual(state.stopped, { deviceId: CHARGER_ID, portNumber: 2, sessionId: 555 });
});

test('readSessionCookie finds the cookie among several Set-Cookie headers', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'other=1; Path=/');
  headers.append('set-cookie', 'coulomb_sess=a%2Bb; Path=/');
  assert.equal(readSessionCookie(headers), 'a+b');
  assert.equal(readSessionCookie(new Headers()), null);
});

test('parseStation joins the names and lowercases the statuses', () => {
  const station = parseStation({
    deviceId: 1,
    name: ['A', 'B'],
    stationStatus: 'AVAILABLE',
    portsInfo: { ports: [{ outletNumber: 1, status: 'AVAILABLE' }] },
  });
  assert.equal(station.name, 'A B');
  assert.equal(station.status, 'available');
  assert.equal(station.ports[0].status, 'available');
});
