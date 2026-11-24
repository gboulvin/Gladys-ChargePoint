import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { SCENE_TRIGGERS, detectSceneEvents } from '../src/events.js';
import { DEVICE_TYPES } from '../src/devices.js';
import {
  CHARGER_ID,
  STATION_ID,
  USER_ID,
  createChargePointState,
  homeSession,
} from './fixtures/fakeChargePoint.js';
import { connectedController } from './helpers.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const declaration = (list, key) => manifest[list].find((entry) => entry.key === key);

const controllers = [];
async function setup(options) {
  const result = await connectedController(options);
  controllers.push(result.controller);
  return result;
}
after(() => controllers.forEach((c) => c.stop()));

function charger(id = CHARGER_ID) {
  return createFakeGladys().externalIds(DEVICE_TYPES.HOME_CHARGER, id).device;
}

// --- Triggers -------------------------------------------------------------------

test('plugging in, charging, stopping and unplugging fire one event each', async () => {
  const { gladys, controller, state } = await setup();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'nothing fires on the first snapshot');

  state.charger.isPluggedIn = true;
  await controller.refreshNow();
  state.charger.chargingStatus = 'CHARGING';
  state.session = homeSession();
  await controller.refreshNow();
  await controller.refreshNow(); // unchanged: no event
  state.charger.chargingStatus = 'AVAILABLE';
  state.session = null;
  await controller.refreshNow();
  state.charger.isPluggedIn = false;
  await controller.refreshNow();

  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    [
      SCENE_TRIGGERS.VEHICLE_PLUGGED_IN,
      SCENE_TRIGGERS.CHARGING_STARTED,
      SCENE_TRIGGERS.CHARGING_STOPPED,
      SCENE_TRIGGERS.VEHICLE_UNPLUGGED,
    ],
  );
  const stopped = gladys.fake.sceneEvents[2].data;
  assert.equal(stopped.device, gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID).device);
  assert.equal(stopped.energy_kwh, 7.25);
  assert.equal(stopped.cost, 1.5);
  assert.equal(stopped.duration_minutes, 60);
});

test('a session at a public station fires on the account device', async () => {
  const { gladys, controller, state } = await setup();
  state.session = homeSession({ device_id: 31337, is_home_charger: false });
  await controller.refreshNow();
  state.session = null;
  await controller.refreshNow();
  const account = gladys.externalIds(DEVICE_TYPES.ACCOUNT, USER_ID).device;
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [event.key, event.data.device]),
    [
      [SCENE_TRIGGERS.CHARGING_STARTED, account],
      [SCENE_TRIGGERS.CHARGING_STOPPED, account],
    ],
  );
});

test('a followed station freeing a port fires public_station_available', async () => {
  const { gladys, controller, state } = await setup();
  state.station.portsInfo.ports[1].statusV2 = 'available';
  await controller.refreshNow();
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.PUBLIC_STATION_AVAILABLE,
      data: {
        device: gladys.externalIds(DEVICE_TYPES.PUBLIC_STATION, STATION_ID).device,
        available_ports: 1,
      },
    },
  ]);
});

test('event data only carries keys the trigger declares, as primitives', () => {
  const gladys = createFakeGladys();
  const base = {
    account: { userId: USER_ID },
    session: null,
    homeChargers: {
      [CHARGER_ID]: { status: { isPluggedIn: true, chargingStatus: 'CHARGING' } },
    },
    publicStations: { [STATION_ID]: { ports: [{ status: 'in_use' }] } },
  };
  const next = {
    ...base,
    homeChargers: { [CHARGER_ID]: { status: { isPluggedIn: false, chargingStatus: 'AVAILABLE' } } },
    publicStations: { [STATION_ID]: { ports: [{ status: 'available' }] } },
  };
  const events = detectSceneEvents(gladys, base, next);
  assert.ok(events.length >= 3);
  for (const { key, data } of events) {
    const trigger = declaration('scene_triggers', key);
    assert.ok(trigger, `${key} is declared`);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [name, value] of Object.entries(data)) {
      assert.ok(declared.includes(name), `${key}: data.${name} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${name} is a primitive`);
    }
  }
});

test('nothing fires without a previous snapshot', () => {
  assert.deepEqual(detectSceneEvents(createFakeGladys(), null, { homeChargers: {} }), []);
});

// --- Actions --------------------------------------------------------------------

test('start_charging confirms the session and returns started', async () => {
  const state = createChargePointState({ ackAttemptsBeforeOk: 3 });
  state.charger.isPluggedIn = true;
  const { controller } = await setup({ state });
  const outputs = await SCENE_ACTIONS.start_charging(controller, {
    fields: { device: charger() },
  });
  assert.deepEqual(outputs, { started: true });
  assert.equal(state.startedOn, CHARGER_ID);
});

test('start_charging reports an unplugged vehicle through its output', async () => {
  const { controller, state } = await setup();
  const outputs = await SCENE_ACTIONS.start_charging(controller, {
    fields: { device: charger() },
  });
  assert.deepEqual(outputs, { started: false });
  assert.equal(state.startedOn, undefined);
});

test('start_charging on something else than a home charger fails', async () => {
  const { controller } = await setup();
  await assert.rejects(
    SCENE_ACTIONS.start_charging(controller, { fields: { device: charger(1) } }),
    /home charger/,
  );
});

test('stop_charging without a device stops any session in progress', async () => {
  const state = createChargePointState();
  state.session = homeSession({ device_id: 31337, outlet_number: 2, is_home_charger: false });
  const { controller } = await setup({ state });
  assert.deepEqual(await SCENE_ACTIONS.stop_charging(controller, { fields: {} }), {
    stopped: true,
  });
  assert.deepEqual(state.stopped, { deviceId: 31337, portNumber: 2, sessionId: 555 });
});

test('stop_charging with nothing to stop returns stopped: false', async () => {
  const { controller } = await setup();
  assert.deepEqual(
    await SCENE_ACTIONS.stop_charging(controller, { fields: { device: charger() } }),
    { stopped: false },
  );
});

test('set_amperage_limit returns the applied current', async () => {
  const { controller, state } = await setup();
  const outputs = await SCENE_ACTIONS.set_amperage_limit(controller, {
    fields: { device: charger(), amperage: 45 },
  });
  assert.deepEqual(outputs, { amperage: 40 });
  assert.equal(state.charger.chargeAmperageSettings.chargeLimit, 40);
});

test('set_charging_schedule applies the given times', async () => {
  const { controller, state } = await setup();
  const outputs = await SCENE_ACTIONS.set_charging_schedule(controller, {
    fields: { device: charger(), enabled: true, weekday_start: '21:30', weekend_end: '09:00' },
  });
  assert.deepEqual(outputs, { enabled: true });
  assert.deepEqual(state.schedule.userSchedule, {
    weekdays: { startTime: '21:30', endTime: '07:00' },
    weekends: { startTime: '23:00', endTime: '09:00' },
  });
});

test('set_charging_schedule refuses a malformed time', async () => {
  const { controller } = await setup();
  await assert.rejects(
    SCENE_ACTIONS.set_charging_schedule(controller, {
      fields: { device: charger(), enabled: true, weekday_start: '9pm' },
    }),
    /weekday_start/,
  );
});

test('restart_charger restarts the charger', async () => {
  const { controller, state } = await setup();
  assert.deepEqual(
    await SCENE_ACTIONS.restart_charger(controller, { fields: { device: charger() } }),
    { restarted: true },
  );
  assert.equal(state.restarted, true);
});

test('scene action outputs only use declared keys', async () => {
  const state = createChargePointState();
  state.charger.isPluggedIn = true;
  const { controller } = await setup({ state });
  const fields = {
    start_charging: { device: charger() },
    stop_charging: {},
    set_amperage_limit: { device: charger(), amperage: 16 },
    set_charging_schedule: { device: charger(), enabled: false },
    restart_charger: { device: charger() },
  };
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    const outputs = await handler(controller, { fields: fields[key] });
    const declared = keysOf(declaration('scene_actions', key).outputs);
    for (const name of Object.keys(outputs)) {
      assert.ok(declared.includes(name), `${key}: output ${name} is not declared`);
    }
  }
});
