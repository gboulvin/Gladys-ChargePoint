// -----------------------------------------------------------------------------
// Gladys devices built from a ChargePoint snapshot.
//
// Three device types, each keyed by the id ChargePoint gives it (external ids
// are forever: never derive them from a name):
//
//   - home-charger:<charger id>   a ChargePoint Home / Home Flex of the account:
//     start/stop charging, current limit, charging schedule, LED brightness,
//     connector + charging state, power, energy, cost, duration;
//   - account:<user id>           the ChargePoint account: balance and the
//     active session wherever it runs (public stations included);
//   - public-station:<device id>  a public station the user follows:
//     availability and number of free ports.
//
// Each feature carries a `value(context)` computing its state from the
// snapshot: publishing the states is a loop over the features.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  CHARGING_STATE,
  CONNECTOR_STATUS,
  countAvailablePorts,
  currencyUnit,
  homeChargerChargingState,
  homeChargerConnectorStatus,
  isHomeChargerCharging,
  isSessionActive,
  ledLevelToPercent,
  publicStationConnectorStatus,
  round,
} from './mapping.js';

export const DEVICE_TYPES = {
  HOME_CHARGER: 'home-charger',
  ACCOUNT: 'account',
  PUBLIC_STATION: 'public-station',
};

// Feature keys: part of the feature external ids, never rename one.
export const FEATURES = {
  CHARGE: 'charge',
  PLUGGED: 'plugged',
  CONNECTOR_STATUS: 'connector-status',
  CHARGING_STATE: 'charging-state',
  POWER: 'power',
  SESSION_ENERGY: 'session-energy',
  SESSION_COST: 'session-cost',
  SESSION_DURATION: 'session-duration',
  AMPERAGE_LIMIT: 'amperage-limit',
  SCHEDULE: 'schedule',
  LED_BRIGHTNESS: 'led-brightness',
  BALANCE: 'balance',
  AVAILABLE_PORTS: 'available-ports',
};

const DEFAULT_AMPERAGE_RANGE = { min: 6, max: 80 };

/** Columns every feature needs (Gladys stores them NOT NULL). */
function feature(ids, key, definition) {
  const { value, ...rest } = definition;
  return {
    key,
    value,
    payload: {
      external_id: ids.feature(key),
      keep_history: true,
      ...rest,
    },
  };
}

function binary(name, category, type, { readOnly = true } = {}) {
  return { name, category, type, min: 0, max: 1, read_only: readOnly, has_feedback: !readOnly };
}

function currencyFeature(name, currency) {
  const unit = currencyUnit(currency?.code);
  return {
    name,
    category: C.CURRENCY,
    type: T.CURRENCY.DECIMAL,
    ...(unit ? { unit } : {}),
    min: 0,
    max: 100000,
    read_only: true,
    has_feedback: false,
  };
}

function sessionFeatures(ids, currency) {
  return [
    feature(ids, FEATURES.POWER, {
      name: 'Charging power',
      category: C.ELECTRICAL_VEHICLE_CHARGE,
      type: T.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
      unit: U.WATT,
      min: 0,
      max: 350000,
      read_only: true,
      has_feedback: false,
      value: ({ session }) => (isSessionActive(session) ? Math.round(session.powerKw * 1000) : 0),
    }),
    feature(ids, FEATURES.SESSION_ENERGY, {
      name: 'Session energy',
      category: C.ELECTRICAL_VEHICLE_CHARGE,
      type: T.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
      unit: U.KILOWATT_HOUR,
      min: 0,
      max: 1000,
      read_only: true,
      has_feedback: false,
      value: ({ lastSession }) => (lastSession ? round(lastSession.energyKwh, 3) : null),
    }),
    feature(ids, FEATURES.SESSION_COST, {
      ...currencyFeature('Session cost', currency),
      value: ({ lastSession }) => (lastSession ? round(lastSession.totalAmount, 2) : null),
    }),
  ];
}

// --- Home charger -----------------------------------------------------------

export function homeChargerName(charger) {
  const nickname = charger?.config?.stationNickname;
  if (nickname) {
    return nickname;
  }
  const brand =
    !charger?.status?.brand || charger.status.brand === 'CP' ? 'ChargePoint' : charger.status.brand;
  const model = (charger?.status?.model ?? '').split('-')[0];
  if (model.includes('CPH')) {
    return `${brand} Home Flex (${model})`;
  }
  return model ? `${brand} ${model}` : `${brand} ${charger?.id ?? ''}`.trim();
}

function amperageRange(status) {
  const limits = status?.possibleAmperageLimits ?? [];
  if (limits.length === 0) {
    return DEFAULT_AMPERAGE_RANGE;
  }
  return { min: limits[0], max: limits[limits.length - 1] };
}

function homeChargerFeatures(ids, charger, currency) {
  const range = amperageRange(charger?.status);
  return [
    feature(ids, FEATURES.CHARGE, {
      ...binary('Charging', C.ELECTRICAL_VEHICLE_CHARGE, T.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON, {
        readOnly: false,
      }),
      value: ({ charger: c, session }) =>
        c?.status ? (isHomeChargerCharging(c.status, session) ? 1 : 0) : null,
    }),
    feature(ids, FEATURES.PLUGGED, {
      ...binary(
        'Vehicle plugged in',
        C.ELECTRICAL_VEHICLE_CHARGE,
        T.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
      ),
      value: ({ charger: c }) => (c?.status ? (c.status.isPluggedIn ? 1 : 0) : null),
    }),
    feature(ids, FEATURES.CONNECTOR_STATUS, {
      name: 'Connector status',
      category: C.CHARGING_STATION,
      type: T.CHARGING_STATION.CONNECTOR_STATUS,
      min: CONNECTOR_STATUS.AVAILABLE,
      max: CONNECTOR_STATUS.FAULTED,
      read_only: true,
      has_feedback: false,
      value: ({ charger: c }) => homeChargerConnectorStatus(c?.status),
    }),
    feature(ids, FEATURES.CHARGING_STATE, {
      name: 'Charging state',
      category: C.CHARGING_STATION,
      type: T.CHARGING_STATION.CHARGING_STATE,
      min: CHARGING_STATE.CHARGING,
      max: CHARGING_STATE.DISCHARGING,
      read_only: true,
      has_feedback: false,
      value: ({ charger: c, session }) =>
        c?.status ? homeChargerChargingState(c.status, session, c.schedule) : null,
    }),
    ...sessionFeatures(ids, currency),
    feature(ids, FEATURES.SESSION_DURATION, {
      name: 'Session duration',
      category: C.DURATION,
      type: T.DURATION.INTEGER,
      unit: U.MINUTES,
      min: 0,
      max: 100000,
      read_only: true,
      has_feedback: false,
      value: ({ lastSession }) => (lastSession ? Math.round(lastSession.chargingTime / 60) : null),
    }),
    feature(ids, FEATURES.AMPERAGE_LIMIT, {
      name: 'Charging current limit',
      category: C.ELECTRICAL_VEHICLE_CHARGE,
      type: T.ELECTRICAL_VEHICLE_CHARGE.TARGET_CURRENT,
      unit: U.AMPERE,
      min: range.min,
      max: range.max,
      read_only: false,
      has_feedback: true,
      value: ({ charger: c }) => (c?.status?.amperageLimit ? c.status.amperageLimit : null),
    }),
    feature(ids, FEATURES.SCHEDULE, {
      ...binary('Charging schedule', C.SWITCH, T.SWITCH.BINARY, { readOnly: false }),
      value: ({ charger: c }) => (c?.schedule ? (c.schedule.scheduleEnabled ? 1 : 0) : null),
    }),
    feature(ids, FEATURES.LED_BRIGHTNESS, {
      name: 'LED brightness',
      category: C.SWITCH,
      type: T.SWITCH.DIMMER,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
      value: ({ charger: c }) =>
        c?.config ? ledLevelToPercent(c.config.ledBrightness.level) : null,
    }),
  ];
}

// --- Account ------------------------------------------------------------------

function accountFeatures(ids, currency) {
  return [
    feature(ids, FEATURES.BALANCE, {
      ...currencyFeature('Account balance', currency),
      value: ({ snapshot }) =>
        snapshot.account.balance === null ? null : round(snapshot.account.balance, 2),
    }),
    feature(ids, FEATURES.CHARGE, {
      ...binary(
        'Charging session',
        C.ELECTRICAL_VEHICLE_CHARGE,
        T.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
      ),
      value: ({ session }) => (isSessionActive(session) ? 1 : 0),
    }),
    ...sessionFeatures(ids, currency),
  ];
}

// --- Public station -----------------------------------------------------------

function publicStationFeatures(ids) {
  return [
    feature(ids, FEATURES.CONNECTOR_STATUS, {
      name: 'Availability',
      category: C.CHARGING_STATION,
      type: T.CHARGING_STATION.CONNECTOR_STATUS,
      min: CONNECTOR_STATUS.AVAILABLE,
      max: CONNECTOR_STATUS.FAULTED,
      read_only: true,
      has_feedback: false,
      value: ({ station }) => publicStationConnectorStatus(station),
    }),
    feature(ids, FEATURES.AVAILABLE_PORTS, {
      name: 'Available ports',
      category: C.COUNTER_SENSOR,
      type: T.SENSOR.INTEGER,
      min: 0,
      max: 100,
      read_only: true,
      has_feedback: false,
      value: ({ station }) => (station ? countAvailablePorts(station) : null),
    }),
  ];
}

// --- Assembly -----------------------------------------------------------------

/**
 * Every device of the snapshot, as `{ type, platformId, payload, features }`
 * where `payload` is what Gladys receives and `features` keep the state
 * functions.
 */
export function describeDevices(gladys, snapshot) {
  if (!snapshot) {
    return [];
  }
  const devices = [];
  const { currency } = snapshot;

  for (const charger of Object.values(snapshot.homeChargers)) {
    const ids = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, charger.id);
    devices.push({
      type: DEVICE_TYPES.HOME_CHARGER,
      platformId: String(charger.id),
      name: homeChargerName(charger),
      model: charger.status?.model ?? '',
      features: homeChargerFeatures(ids, charger, currency),
      ids,
    });
  }

  if (snapshot.account?.userId) {
    const ids = gladys.externalIds(DEVICE_TYPES.ACCOUNT, snapshot.account.userId);
    devices.push({
      type: DEVICE_TYPES.ACCOUNT,
      platformId: String(snapshot.account.userId),
      name: 'ChargePoint account',
      features: accountFeatures(ids, currency),
      ids,
    });
  }

  for (const [stationId, station] of Object.entries(snapshot.publicStations)) {
    const ids = gladys.externalIds(DEVICE_TYPES.PUBLIC_STATION, stationId);
    devices.push({
      type: DEVICE_TYPES.PUBLIC_STATION,
      platformId: String(stationId),
      name: station?.name ? `ChargePoint ${station.name}` : `ChargePoint station ${stationId}`,
      features: publicStationFeatures(ids),
      ids,
    });
  }
  return devices;
}

/** The discovery payload Gladys receives. */
export function buildDiscoveredDevices(gladys, snapshot) {
  return describeDevices(gladys, snapshot).map((device) => ({
    name: device.name,
    external_id: device.ids.device,
    ...(device.model ? { model: device.model } : {}),
    features: device.features.map((f) => f.payload),
  }));
}

/** The state context of one device. */
export function deviceContext(device, snapshot, service) {
  switch (device.type) {
    case DEVICE_TYPES.HOME_CHARGER: {
      const charger = snapshot.homeChargers[device.platformId];
      const session = service.sessionAt(device.platformId);
      return {
        snapshot,
        charger,
        session,
        lastSession: session ?? service.lastSessionAt(device.platformId),
      };
    }
    case DEVICE_TYPES.ACCOUNT: {
      const session = snapshot.session;
      const lastSession =
        session ??
        [...service.lastSessions.values()].sort((a, b) =>
          String(b.startTime).localeCompare(String(a.startTime)),
        )[0] ??
        null;
      return { snapshot, session, lastSession };
    }
    default:
      return { snapshot, station: snapshot.publicStations[device.platformId] ?? null };
  }
}

/** Every state of every device, ready for `publishChangedStates`. */
export function buildStates(gladys, snapshot, service) {
  const states = [];
  for (const device of describeDevices(gladys, snapshot)) {
    const context = deviceContext(device, snapshot, service);
    for (const f of device.features) {
      const state = f.value(context);
      if (state !== null && state !== undefined && Number.isFinite(state)) {
        states.push({ device_feature_external_id: f.payload.external_id, state });
      }
    }
  }
  return states;
}

/**
 * Split a device or feature external id into its parts:
 * `ext:<selector>:<type>:<platformId>[:<featureKey>]`.
 */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [type, platformId, ...rest] = externalId.slice(prefix.length).split(':');
  if (!Object.values(DEVICE_TYPES).includes(type) || !platformId) {
    return null;
  }
  return { type, platformId, featureKey: rest.length > 0 ? rest.join(':') : null };
}

/** The home charger id behind a device external id, or null. */
export function homeChargerIdOf(gladys, externalId) {
  const parsed = parseExternalId(gladys, externalId);
  return parsed?.type === DEVICE_TYPES.HOME_CHARGER ? Number(parsed.platformId) : null;
}
