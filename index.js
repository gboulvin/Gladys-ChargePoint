// -----------------------------------------------------------------------------
// Entry point of the ChargePoint integration for Gladys Assistant.
//
// This file only wires the SDK to the controller (src/controller.js): every
// handler is registered BEFORE connect(). The ChargePoint logic lives in
// src/: the API client (src/chargepoint/), the session and snapshot
// (src/service.js), the devices (src/devices.js), the scene triggers
// (src/events.js), the scene actions (src/scenes.js), the Configuration
// actions (src/actions.js) and the dashboard widgets (src/widgets.js).
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK): GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { ChargePointService } from './src/service.js';
import { createTokenStore } from './src/tokenStore.js';
import { ChargePointController, UserError } from './src/controller.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGETS, refreshWidgets } from './src/widgets.js';

const gladys = new GladysIntegration();
const service = new ChargePointService({ store: createTokenStore() });
const controller = new ChargePointController({
  gladys,
  service,
  // Every snapshot can change the computed widget rows: nudge them.
  onSnapshot: () => refreshWidgets(gladys),
});

// Errors meant for the user carry their translation; Gladys shows the English
// text of an Error, so surface the translated one in the logs too.
function rethrow(err) {
  if (err instanceof UserError) {
    logger.warn(err.message);
  }
  throw err;
}

// --- Discovery -------------------------------------------------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> refreshing and publishing the ChargePoint devices');
  await controller.scan();
});

// --- Commands on device features -------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await controller.setValue(device, feature, value).catch(rethrow);
});

// Polling is driven by the controller's own loop (one ChargePoint read serves
// every device), so the devices declare no poll_frequency: nothing to do here.

// --- Configuration actions ---------------------------------------------------------
for (const [actionKey, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(actionKey, (fields) => handler(controller, { fields }));
}

// --- Scene actions -------------------------------------------------------------------
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(controller, { fields }).catch(rethrow));
}

// --- Dashboard widgets -----------------------------------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, controller, request));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
    widget.action(gladys, controller, { actionKey, params, settings }),
  );
}

// --- Configuration updated by the user --------------------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> reconnecting with the new configuration');
  await controller.start(normalizeConfig(newConfig));
  refreshWidgets(gladys);
});

// --- Connection lifecycle -----------------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await controller.start(normalizeConfig(await gladys.getConfig()));
    // Nudges sent while the socket was down were dropped: re-sync dashboards.
    refreshWidgets(gladys);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Logs der Integration.',
        es: 'La inicialización falló, revise los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  controller.stop();
});

// --- Graceful shutdown ----------------------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  controller.stop();
});

// --- Startup ----------------------------------------------------------------------------------
logger.info('Starting the ChargePoint integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
