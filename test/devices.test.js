import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_TYPES,
  FEATURES,
  buildDiscoveredDevices,
  homeChargerName,
  parseExternalId,
} from '../src/devices.js';
import { CHARGING_STATE, CONNECTOR_STATUS } from '../src/mapping.js';
import {
  CHARGER_ID,
  STATION_ID,
  USER_ID,
  createChargePointState,
  homeSession,
} from './fixtures/fakeChargePoint.js';
import { connectedController, flush, lastState } from './helpers.js';

const controllers = [];
async function setup(options) {
  const result = await connectedController(options);
  controllers.push(result.controller);
  return result;
}
after(() => controllers.forEach((c) => c.stop()));

test('the discovery lists the home charger, the account and the followed stations', async () => {
  const { gladys } = await setup();
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.deepEqual(ids, [
    gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID).device,
    gladys.externalIds(DEVICE_TYPES.ACCOUNT, USER_ID).device,
    gladys.externalIds(DEVICE_TYPES.PUBLIC_STATION, STATION_ID).device,
  ]);
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Garage');
});

test('every feature carries the columns Gladys needs to create it', async () => {
  const { gladys, service } = await setup();
  for (const device of buildDiscoveredDevices(gladys, service.snapshot)) {
    for (const feature of device.features) {
      for (const column of ['name', 'min', 'max', 'read_only', 'has_feedback']) {
        assert.notEqual(feature[column], undefined, `${feature.external_id}.${column}`);
      }
      assert.ok(feature.min <= feature.max, `${feature.external_id}: min <= max`);
    }
  }
});

test('the fake Gladys accepts the discovery payload', async () => {
  const { service } = await setup();
  const fresh = createFakeGladys();
  await fresh.publishDiscoveredDevices(buildDiscoveredDevices(fresh, service.snapshot));
  assert.equal(fresh.fake.discoveredDevices.length, 3);
});

test('the current limit range follows the values the charger accepts', async () => {
  const { gladys, service } = await setup();
  const [charger] = buildDiscoveredDevices(gladys, service.snapshot);
  const limit = charger.features.find((f) => f.external_id.endsWith(`:${FEATURES.AMPERAGE_LIMIT}`));
  assert.equal(limit.min, 16);
  assert.equal(limit.max, 48);
});

test('an idle charger publishes its states', async () => {
  const { gladys } = await setup();
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  assert.equal(lastState(gladys, ids.feature(FEATURES.CHARGE)), 0);
  assert.equal(lastState(gladys, ids.feature(FEATURES.PLUGGED)), 0);
  assert.equal(
    lastState(gladys, ids.feature(FEATURES.CONNECTOR_STATUS)),
    CONNECTOR_STATUS.AVAILABLE,
  );
  assert.equal(lastState(gladys, ids.feature(FEATURES.CHARGING_STATE)), CHARGING_STATE.IDLE);
  assert.equal(lastState(gladys, ids.feature(FEATURES.AMPERAGE_LIMIT)), 32);
  assert.equal(lastState(gladys, ids.feature(FEATURES.SCHEDULE)), 0);
  assert.equal(lastState(gladys, ids.feature(FEATURES.LED_BRIGHTNESS)), 60);
  assert.equal(lastState(gladys, ids.feature(FEATURES.POWER)), 0);
  const account = gladys.externalIds(DEVICE_TYPES.ACCOUNT, USER_ID);
  assert.equal(lastState(gladys, account.feature(FEATURES.BALANCE)), 12.5);
  const station = gladys.externalIds(DEVICE_TYPES.PUBLIC_STATION, STATION_ID);
  assert.equal(
    lastState(gladys, station.feature(FEATURES.CONNECTOR_STATUS)),
    CONNECTOR_STATUS.OCCUPIED,
  );
  assert.equal(lastState(gladys, station.feature(FEATURES.AVAILABLE_PORTS)), 0);
});

test('a charging session publishes power, energy, cost and duration', async () => {
  const state = createChargePointState();
  state.charger.isPluggedIn = true;
  state.charger.chargingStatus = 'CHARGING';
  state.session = homeSession();
  const { gladys } = await setup({ state });
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  assert.equal(lastState(gladys, ids.feature(FEATURES.CHARGE)), 1);
  assert.equal(
    lastState(gladys, ids.feature(FEATURES.CONNECTOR_STATUS)),
    CONNECTOR_STATUS.OCCUPIED,
  );
  assert.equal(lastState(gladys, ids.feature(FEATURES.CHARGING_STATE)), CHARGING_STATE.CHARGING);
  assert.equal(lastState(gladys, ids.feature(FEATURES.POWER)), 7200);
  assert.equal(lastState(gladys, ids.feature(FEATURES.SESSION_ENERGY)), 7.25);
  assert.equal(lastState(gladys, ids.feature(FEATURES.SESSION_COST)), 1.5);
  assert.equal(lastState(gladys, ids.feature(FEATURES.SESSION_DURATION)), 60);
});

test('every device shows a cloud badge, unreachable when the charger is offline', async () => {
  const state = createChargePointState();
  state.charger.isConnected = false;
  const { gladys } = await setup({ state });
  const transports = Object.fromEntries(
    gladys.fake.transports.map((entry) => [entry.device_external_id, entry.transport]),
  );
  assert.equal(
    transports[gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID).device],
    DEVICE_TRANSPORTS.UNREACHABLE,
  );
  assert.equal(
    transports[gladys.externalIds(DEVICE_TYPES.ACCOUNT, USER_ID).device],
    DEVICE_TRANSPORTS.CLOUD,
  );
});

test('the connector of an offline charger is unavailable', async () => {
  const state = createChargePointState();
  state.charger.isConnected = false;
  const { gladys } = await setup({ state });
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  assert.equal(
    lastState(gladys, ids.feature(FEATURES.CONNECTOR_STATUS)),
    CONNECTOR_STATUS.UNAVAILABLE,
  );
});

test('setting the current limit picks the closest accepted value and confirms it', async () => {
  const { gladys, controller, state } = await setup();
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  const feature = { external_id: ids.feature(FEATURES.AMPERAGE_LIMIT) };
  await controller.setValue({ external_id: ids.device }, feature, 30);
  assert.equal(state.charger.chargeAmperageSettings.chargeLimit, 24);
  assert.equal(lastState(gladys, feature.external_id), 24);
});

test('the schedule switch enables and disables the charging schedule', async () => {
  const { gladys, controller, state } = await setup();
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  const feature = { external_id: ids.feature(FEATURES.SCHEDULE) };
  await controller.setValue({ external_id: ids.device }, feature, 1);
  assert.equal(state.schedule.scheduleEnabled, true);
  assert.equal(lastState(gladys, feature.external_id), 1);
  await controller.setValue({ external_id: ids.device }, feature, 0);
  assert.equal(state.schedule.scheduleEnabled, false);
});

test('the LED dimmer maps percents to the charger levels', async () => {
  const { gladys, controller, state } = await setup();
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  const feature = { external_id: ids.feature(FEATURES.LED_BRIGHTNESS) };
  await controller.setValue({ external_id: ids.device }, feature, 85);
  assert.equal(state.chargerConfig.settings.led.brightness.level, 4);
  assert.equal(lastState(gladys, feature.external_id), 80);
});

test('the charge switch starts a session once the command is accepted', async () => {
  const state = createChargePointState({ ackAttemptsBeforeOk: 2 });
  state.charger.isPluggedIn = true;
  const { gladys, controller } = await setup({ state });
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  await controller.setValue(
    { external_id: ids.device },
    { external_id: ids.feature(FEATURES.CHARGE) },
    1,
  );
  assert.equal(state.startedOn, CHARGER_ID);
  await flush();
});

test('the charge switch refuses to start an unplugged vehicle', async () => {
  const { gladys, controller } = await setup();
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  await assert.rejects(
    controller.setValue(
      { external_id: ids.device },
      { external_id: ids.feature(FEATURES.CHARGE) },
      1,
    ),
    /Plug the vehicle in/,
  );
});

test('the charge switch stops the running session', async () => {
  const state = createChargePointState();
  state.charger.isPluggedIn = true;
  state.session = homeSession({ outlet_number: 1 });
  const { gladys, controller } = await setup({ state });
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  await controller.setValue(
    { external_id: ids.device },
    { external_id: ids.feature(FEATURES.CHARGE) },
    0,
  );
  assert.deepEqual(state.stopped, { deviceId: CHARGER_ID, portNumber: 1, sessionId: 555 });
  await flush();
});

test('read-only features refuse commands', async () => {
  const { gladys, controller } = await setup();
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  await assert.rejects(
    controller.setValue(
      { external_id: ids.device },
      { external_id: ids.feature(FEATURES.POWER) },
      1,
    ),
    /read-only/,
  );
});

test('external ids are parsed back to their type and platform id', () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID);
  assert.deepEqual(parseExternalId(gladys, ids.feature(FEATURES.CHARGE)), {
    type: DEVICE_TYPES.HOME_CHARGER,
    platformId: String(CHARGER_ID),
    featureKey: FEATURES.CHARGE,
  });
  assert.equal(parseExternalId(gladys, 'ext:other:home-charger:1'), null);
});

test('a charger without nickname is named after its model', () => {
  assert.equal(
    homeChargerName({ id: 1, status: { brand: 'CP', model: 'CPH50-NEMA6' }, config: null }),
    'ChargePoint Home Flex (CPH50)',
  );
  assert.equal(homeChargerName({ id: 1, status: { brand: 'XYZ', model: 'M1' } }), 'XYZ M1');
});

test('the charging station categories are the ones of the SDK', () => {
  assert.equal(DEVICE_FEATURE_CATEGORIES.CHARGING_STATION, 'charging-station');
});
