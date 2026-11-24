// Shared setup: a connected controller over the fake ChargePoint cloud and the
// fake Gladys of the SDK.

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ChargePointService } from '../src/service.js';
import { ChargePointController } from '../src/controller.js';
import { normalizeConfig } from '../src/config.js';
import {
  STATION_ID,
  createChargePointState,
  createFakeFetch,
  createMemoryStore,
  noSleep,
} from './fixtures/fakeChargePoint.js';

export async function connectedController({ state = createChargePointState(), config = {} } = {}) {
  const gladys = createFakeGladys();
  const service = new ChargePointService({
    store: createMemoryStore(),
    fetch: createFakeFetch(state),
    sleep: noSleep,
  });
  const controller = new ChargePointController({ gladys, service });
  await controller.start(
    normalizeConfig({
      username: 'driver@example.com',
      password: 'secret',
      public_stations: String(STATION_ID),
      ...config,
    }),
  );
  return { gladys, service, controller, state };
}

/** Wait for the background work of a command (promises, not timers). */
export const flush = () => new Promise((resolve) => setImmediate(resolve));

/** The last published value of a feature. */
export function lastState(gladys, featureExternalId) {
  const states = gladys.fake.states.filter(
    (s) => s.device_feature_external_id === featureExternalId,
  );
  return states.at(-1)?.state;
}
