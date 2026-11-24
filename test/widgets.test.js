import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WIDGETS, WIDGET_KEYS, refreshWidgets } from '../src/widgets.js';
import { DEVICE_TYPES, buildDiscoveredDevices } from '../src/devices.js';
import { LANGUAGES } from '../src/i18n.js';
import { CHARGER_ID, createChargePointState, homeSession } from './fixtures/fakeChargePoint.js';
import { connectedController, flush } from './helpers.js';

const controllers = [];
async function setup(options) {
  const result = await connectedController(options);
  controllers.push(result.controller);
  return result;
}
after(() => controllers.forEach((c) => c.stop()));

function chargerSettings(gladys) {
  return { device: gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, CHARGER_ID).device };
}

function featureIds(gladys, snapshot) {
  return new Set(
    buildDiscoveredDevices(gladys, snapshot).flatMap((d) => d.features.map((f) => f.external_id)),
  );
}

function assertValid(content, gladys, snapshot) {
  assert.deepEqual(validateWidgetContent(content), [], 'rendered exactly as sent');
  const known = featureIds(gladys, snapshot);
  for (const component of content.components) {
    if (component.device_feature) {
      assert.ok(known.has(component.device_feature), `unknown ${component.device_feature}`);
    }
  }
}

test('the charger widget of an idle charger is valid and has no button', async () => {
  const { gladys, controller, service } = await setup();
  const content = await WIDGETS[WIDGET_KEYS.CHARGER].get(gladys, controller, {
    settings: chargerSettings(gladys),
  });
  assertValid(content, gladys, service.snapshot);
  assert.ok(!content.components.some((c) => c.type === 'button'));
});

test('a plugged-in vehicle shows Start, a charging one shows Stop', async () => {
  const state = createChargePointState();
  state.charger.isPluggedIn = true;
  const { gladys, controller, service } = await setup({ state });
  const get = () =>
    WIDGETS[WIDGET_KEYS.CHARGER].get(gladys, controller, { settings: chargerSettings(gladys) });

  let content = await get();
  assertValid(content, gladys, service.snapshot);
  assert.equal(content.components.find((c) => c.type === 'button').action.key, 'start');

  state.charger.chargingStatus = 'CHARGING';
  state.session = homeSession();
  await controller.refreshNow();
  content = await get();
  assertValid(content, gladys, service.snapshot);
  const button = content.components.find((c) => c.type === 'button');
  assert.equal(button.action.key, 'stop');
  assert.equal(button.action.confirm, true);
});

test('the widget buttons start and stop the session, with a toast', async () => {
  const state = createChargePointState();
  state.charger.isPluggedIn = true;
  const { gladys, controller } = await setup({ state });
  const widget = WIDGETS[WIDGET_KEYS.CHARGER];
  const params = chargerSettings(gladys);

  const started = await widget.action(gladys, controller, { actionKey: 'start', params });
  assert.equal(state.startedOn, CHARGER_ID);
  assert.ok(started.en.length <= 200);
  await flush();

  const nothing = await widget.action(gladys, controller, { actionKey: 'stop', params });
  assert.match(nothing.en, /No charging session/);
});

test('without a chosen charger the widget asks for one', async () => {
  const { gladys, controller } = await setup();
  const content = await WIDGETS[WIDGET_KEYS.CHARGER].get(gladys, controller, { settings: {} });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.en, /Choose a home charger/);
});

test('the account widget lists the balance, the session and the stations', async () => {
  const state = createChargePointState();
  state.session = homeSession({ device_id: 31337, device_name: 'Mall', is_home_charger: false });
  const { gladys, controller, service } = await setup({ state });
  const content = await WIDGETS[WIDGET_KEYS.ACCOUNT].get(gladys, controller, {});
  assertValid(content, gladys, service.snapshot);
  const status = content.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].value, 'Mall');
  assert.ok(status.items.some((item) => item.label === 'Town Hall Lot 2'));
  assert.ok(content.components.some((c) => c.type === 'button' && c.action.key === 'stop'));
});

test('an unknown widget action fails, so the user sees the error', async () => {
  const { gladys, controller } = await setup();
  await assert.rejects(
    WIDGETS[WIDGET_KEYS.ACCOUNT].action(gladys, controller, { actionKey: 'nope', params: {} }),
    /Unknown widget action/,
  );
});

test('widget texts are translated in every language', async () => {
  const { gladys, controller } = await setup();
  const content = await WIDGETS[WIDGET_KEYS.CHARGER].get(gladys, controller, {
    settings: chargerSettings(gladys),
  });
  for (const component of content.components) {
    if (component.label && typeof component.label === 'object') {
      for (const lang of LANGUAGES) assert.ok(component.label[lang], `${lang} label`);
    }
  }
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
});
