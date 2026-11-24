// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// Each key is declared in the manifest `scene_actions` (fields + scalar
// outputs) and handled here; index.js registers them with
// `gladys.onSceneAction(key, ...)`. The rules that matter:
//   - `fields` arrive RESOLVED (scene variables substituted, defaults applied);
//     a "source": "devices" field is the chosen device external id;
//   - a situation the scene author can react to (vehicle not plugged in,
//     nothing to stop) is an OUTPUT, not a failure: a scene action is never a
//     condition, the author gates the following actions on the output;
//   - throwing fails this action only (ChargePoint unreachable, refused
//     command): the scene logs it and continues;
//   - never fire a scene event because of a received action: the next refresh
//     reports the transition like any other, once.
// The scene triggers are fired from the refresh loop, see src/events.js.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isValidTime } from './mapping.js';

const logger = createLogger({ name: 'scenes' });

function optionalTime(value, name) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (!isValidTime(String(value))) {
    throw new Error(`${name} must be a time like 22:30`);
  }
  return String(value);
}

export const SCENE_ACTIONS = {
  // Awaits the confirmation of ChargePoint (up to a minute).
  async start_charging(controller, { fields }) {
    logger.info(`Scene action start_charging <- ${fields.device}`);
    const chargerId = controller.requireHomeCharger(fields.device);
    const started = await controller.startCharging(chargerId, { wait: true });
    return { started };
  },

  async stop_charging(controller, { fields }) {
    logger.info(`Scene action stop_charging <- ${fields.device ?? 'any session'}`);
    const stopped = await controller.stopCharging(fields.device || null, { wait: true });
    return { stopped: Boolean(stopped) };
  },

  async set_amperage_limit(controller, { fields }) {
    logger.info(`Scene action set_amperage_limit <- ${fields.device} = ${fields.amperage} A`);
    const chargerId = controller.requireHomeCharger(fields.device);
    const amperage = await controller.setAmperageLimit(chargerId, fields.amperage);
    return { amperage };
  },

  async set_charging_schedule(controller, { fields }) {
    logger.info(`Scene action set_charging_schedule <- ${fields.device} = ${fields.enabled}`);
    const chargerId = controller.requireHomeCharger(fields.device);
    const enabled = fields.enabled === true || fields.enabled === 'true';
    await controller.setSchedule(chargerId, enabled, {
      weekdayStart: optionalTime(fields.weekday_start, 'weekday_start'),
      weekdayEnd: optionalTime(fields.weekday_end, 'weekday_end'),
      weekendStart: optionalTime(fields.weekend_start, 'weekend_start'),
      weekendEnd: optionalTime(fields.weekend_end, 'weekend_end'),
    });
    return { enabled };
  },

  async restart_charger(controller, { fields }) {
    logger.info(`Scene action restart_charger <- ${fields.device}`);
    const chargerId = controller.requireHomeCharger(fields.device);
    await controller.restartCharger(chargerId);
    return { restarted: true };
  },
};
