// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each key is declared in the manifest `actions`; index.js registers them with
// `gladys.onAction(key, ...)`. The resolved multi-language message is shown
// under the button; a thrown error is shown as a failure.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { UserError } from './controller.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'actions' });

async function userMessage(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError) {
      return err.translated;
    }
    throw err;
  }
}

export const ACTIONS = {
  async test_connection(controller) {
    logger.info('Action test_connection');
    return controller.testConnection();
  },

  async restart_charger(controller, { fields }) {
    logger.info(`Action restart_charger <- ${fields.device}`);
    return userMessage(async () => {
      await controller.restartCharger(controller.requireHomeCharger(fields.device));
      return t('charger_restarting');
    });
  },

  async find_stations(controller, { fields }) {
    logger.info('Action find_stations');
    return userMessage(() => controller.findStations(fields));
  },
};
