// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
//   - `charger`  : one home charger (chosen in the widget settings): live power,
//     energy and current limit tiles, its state, cable, network, schedule and
//     session, and a Start / Stop button;
//   - `account`  : the ChargePoint account: balance, the session in progress
//     wherever it runs, the followed public stations, and a Stop button.
//
// The content is declarative (the core renders it with its theme, dark mode
// and translations). Tiles bound to a `device_feature` are live; the computed
// rows follow the refresh loop, which nudges the widgets after every snapshot.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, FEATURES, homeChargerIdOf } from './devices.js';
import { t } from './i18n.js';
import {
  CHARGING_STATE,
  CHARGING_STATE_LABELS,
  CONNECTOR_STATUS,
  CONNECTOR_STATUS_LABELS,
  countAvailablePorts,
  homeChargerChargingState,
  homeChargerConnectorStatus,
  isHomeChargerCharging,
  isSessionActive,
} from './mapping.js';
import { UserError } from './controller.js';

const logger = createLogger({ name: 'widgets' });

export const WIDGET_KEYS = { CHARGER: 'charger', ACCOUNT: 'account' };
const BUTTON_ACTIONS = { START: 'start', STOP: 'stop' };

const CONNECTOR_COLORS = {
  [CONNECTOR_STATUS.AVAILABLE]: WIDGET_COLORS.SUCCESS,
  [CONNECTOR_STATUS.OCCUPIED]: WIDGET_COLORS.INFO,
  [CONNECTOR_STATUS.RESERVED]: WIDGET_COLORS.WARNING,
  [CONNECTOR_STATUS.UNAVAILABLE]: WIDGET_COLORS.NEUTRAL,
  [CONNECTOR_STATUS.FAULTED]: WIDGET_COLORS.DANGER,
};

const CHARGING_COLORS = {
  [CHARGING_STATE.CHARGING]: WIDGET_COLORS.SUCCESS,
  [CHARGING_STATE.EV_CONNECTED]: WIDGET_COLORS.INFO,
  [CHARGING_STATE.PAUSED_BY_VEHICLE]: WIDGET_COLORS.WARNING,
  [CHARGING_STATE.PAUSED_BY_CHARGER]: WIDGET_COLORS.WARNING,
  [CHARGING_STATE.IDLE]: WIDGET_COLORS.NEUTRAL,
  [CHARGING_STATE.DISCHARGING]: WIDGET_COLORS.INFO,
};

function formatDuration(seconds) {
  const minutes = Math.round((seconds ?? 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

function formatMoney(amount, symbol) {
  const value = Number(amount ?? 0).toFixed(2);
  return symbol ? `${value} ${symbol}` : value;
}

function message(key, vars) {
  return { type: 'text', variant: 'caption', text: t(key, vars) };
}

/** The live status row of a home charger. */
function chargerStateRow(charger, session) {
  const connector = homeChargerConnectorStatus(charger.status);
  if (connector !== CONNECTOR_STATUS.OCCUPIED) {
    return { value: t(CONNECTOR_STATUS_LABELS[connector]), color: CONNECTOR_COLORS[connector] };
  }
  const state = homeChargerChargingState(charger.status, session, charger.schedule);
  return { value: t(CHARGING_STATE_LABELS[state]), color: CHARGING_COLORS[state] };
}

function chargerContent(gladys, controller, settings) {
  const service = controller.service;
  const chargerId = homeChargerIdOf(gladys, settings.device);
  if (chargerId === null) {
    return { ttl_seconds: 300, components: [message('choose_charger')] };
  }
  const charger = service.homeCharger(chargerId);
  if (!charger?.status) {
    return { ttl_seconds: 60, components: [message('charger_unavailable')] };
  }
  const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, chargerId);
  const session = service.sessionAt(chargerId);
  const lastSession = session ?? service.lastSessionAt(chargerId);
  const symbol = service.snapshot.currency?.symbol;
  const charging = isHomeChargerCharging(charger.status, session);

  const statusItems = [
    { label: t('status'), icon: 'battery-charging', ...chargerStateRow(charger, session) },
    {
      label: t('cable'),
      icon: 'link',
      value: t(charger.status.isPluggedIn ? 'plugged_in' : 'unplugged'),
      color: charger.status.isPluggedIn ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t('network'),
      icon: 'wifi',
      value: t(charger.status.isConnected ? 'online' : 'offline'),
      color: charger.status.isConnected ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  ];
  if (charger.schedule) {
    statusItems.push({
      label: t('schedule'),
      icon: 'clock',
      value: t(charger.schedule.scheduleEnabled ? 'enabled' : 'disabled'),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (lastSession) {
    statusItems.push(
      {
        label: t('duration'),
        icon: 'watch',
        value: formatDuration(lastSession.chargingTime),
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: t('session_cost'),
        icon: 'credit-card',
        value: formatMoney(lastSession.totalAmount, symbol),
        color: WIDGET_COLORS.NEUTRAL,
      },
    );
  }

  const components = [
    { type: 'value', label: t('power'), icon: 'zap', device_feature: ids.feature(FEATURES.POWER) },
    {
      type: 'value',
      label: t('energy'),
      icon: 'battery',
      device_feature: ids.feature(FEATURES.SESSION_ENERGY),
    },
    {
      type: 'value',
      label: t('amperage_limit'),
      icon: 'sliders',
      device_feature: ids.feature(FEATURES.AMPERAGE_LIMIT),
    },
    { type: 'status', items: statusItems },
  ];
  if (charging) {
    components.push({
      type: 'button',
      label: t('stop'),
      icon: 'square',
      style: 'danger',
      action: { key: BUTTON_ACTIONS.STOP, params: { device: ids.device }, confirm: true },
    });
  } else if (charger.status.isPluggedIn) {
    components.push({
      type: 'button',
      label: t('start'),
      icon: 'play',
      style: 'primary',
      action: { key: BUTTON_ACTIONS.START, params: { device: ids.device } },
    });
  }
  return { ttl_seconds: 60, components };
}

function accountContent(gladys, controller) {
  const snapshot = controller.service.snapshot;
  if (!snapshot?.account?.userId) {
    return { ttl_seconds: 60, components: [message('not_connected')] };
  }
  const ids = gladys.externalIds(DEVICE_TYPES.ACCOUNT, snapshot.account.userId);
  const session = isSessionActive(snapshot.session) ? snapshot.session : null;
  const items = [
    {
      label: t('current_session'),
      icon: 'battery-charging',
      value: session ? session.deviceName || String(session.deviceId) : t('none'),
      color: session ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (session) {
    items.push({
      label: t('session_cost'),
      icon: 'credit-card',
      value: formatMoney(session.totalAmount, snapshot.currency?.symbol),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const stations = controller.publicStationRows();
  for (const { stationId, station, status } of stations.slice(0, 8)) {
    items.push({
      label: (station?.name || stationId).slice(0, 40),
      icon: 'map-pin',
      value: station
        ? t('ports_available', {
            available: countAvailablePorts(station),
            total: station.ports.length,
          })
        : t('state_unavailable'),
      color: CONNECTOR_COLORS[status],
    });
  }

  const components = [
    {
      type: 'value',
      label: t('balance'),
      icon: 'credit-card',
      device_feature: ids.feature(FEATURES.BALANCE),
    },
    { type: 'value', label: t('power'), icon: 'zap', device_feature: ids.feature(FEATURES.POWER) },
    { type: 'status', items },
  ];
  if (stations.length === 0) {
    components.push(message('no_public_station'));
  }
  if (session) {
    components.push({
      type: 'button',
      label: t('stop'),
      icon: 'square',
      style: 'danger',
      action: { key: BUTTON_ACTIONS.STOP, params: {}, confirm: true },
    });
  }
  return { ttl_seconds: 60, components };
}

/**
 * A widget button: start or stop a session. `params` come from the content
 * above (never from the viewer). Answers a toast.
 */
async function sessionButton(controller, { actionKey, params }) {
  logger.info(`onWidgetAction <- ${actionKey}`);
  try {
    if (actionKey === BUTTON_ACTIONS.START) {
      const started = await controller.startCharging(controller.requireHomeCharger(params.device));
      return started ? t('start_requested') : t('not_plugged_in');
    }
    if (actionKey === BUTTON_ACTIONS.STOP) {
      const stopped = await controller.stopCharging(params.device || null);
      return stopped ? t('stop_requested') : t('no_active_session');
    }
  } catch (err) {
    if (err instanceof UserError) {
      return err.translated;
    }
    throw err;
  }
  throw new Error(`Unknown widget action: ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEYS.CHARGER]: {
    async get(gladys, controller, { settings = {} }) {
      return chargerContent(gladys, controller, settings);
    },
    action: (gladys, controller, request) => sessionButton(controller, request),
  },
  [WIDGET_KEYS.ACCOUNT]: {
    async get(gladys, controller) {
      return accountContent(gladys, controller);
    },
    action: (gladys, controller, request) => sessionButton(controller, request),
  },
};

/** Ask the core to re-pull every widget now (after each refresh). */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
