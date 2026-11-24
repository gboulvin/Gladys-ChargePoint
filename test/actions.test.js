import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS } from '../src/actions.js';
import { ChargePointService } from '../src/service.js';
import { ChargePointController } from '../src/controller.js';
import { normalizeConfig } from '../src/config.js';
import { DEVICE_TYPES } from '../src/devices.js';
import {
  CHARGER_ID,
  STATION_ID,
  createChargePointState,
  createFakeFetch,
  createMemoryStore,
  noSleep,
} from './fixtures/fakeChargePoint.js';
import { connectedController } from './helpers.js';

const controllers = [];
async function setup(options) {
  const result = await connectedController(options);
  controllers.push(result.controller);
  return result;
}
after(() => controllers.forEach((c) => c.stop()));

test('test_connection reports the account and what it found', async () => {
  const { controller } = await setup();
  const message = await ACTIONS.test_connection(controller);
  assert.equal(
    message.en,
    'Connected as driver@example.com: 1 home charger(s), 1 public station(s).',
  );
  assert.ok(message.fr && message.de && message.es);
});

test('a refused password is reported in the Configuration screen', async () => {
  const gladys = createFakeGladys();
  const service = new ChargePointService({
    store: createMemoryStore(),
    fetch: createFakeFetch(createChargePointState()),
    sleep: noSleep,
  });
  const controller = new ChargePointController({ gladys, service });
  controllers.push(controller);
  await controller.start(normalizeConfig({ username: 'driver@example.com', password: 'wrong' }));
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail or the password/);
  const message = await ACTIONS.test_connection(controller);
  assert.match(message.en, /refused/);
});

test('a successful start reports the connection as up', async () => {
  const { gladys } = await setup();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('restart_charger restarts the chosen charger', async () => {
  const { gladys, controller, state } = await setup();
  const message = await ACTIONS.restart_charger(controller, {
    fields: { device: gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID).device },
  });
  assert.equal(state.restarted, true);
  assert.match(message.en, /restarting/);
});

test('restart_charger on a public station explains what to choose', async () => {
  const { gladys, controller } = await setup();
  const message = await ACTIONS.restart_charger(controller, {
    fields: { device: gladys.externalIds(DEVICE_TYPES.PUBLIC_STATION, STATION_ID).device },
  });
  assert.equal(message.en, 'Choose a ChargePoint home charger.');
});

test('find_stations lists the public stations around a location, not the home ones', async () => {
  const { controller } = await setup();
  const message = await ACTIONS.find_stations(controller, {
    fields: { latitude: 1, longitude: 2, radius: 500 },
  });
  assert.equal(message.en, `Stations nearby: ${STATION_ID} (Town Hall)`);
});
