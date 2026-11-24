// -----------------------------------------------------------------------------
// Pure mapping functions: ChargePoint data -> Gladys values.
//
// Gladys describes a charging station with two generic enums aligned on OCPP
// 2.0.1 (see the core constants CHARGING_STATION_CONNECTOR_STATUS and
// CHARGING_STATION_CHARGING_STATE): the availability of the connector, and the
// state of the charging session while a vehicle is connected. ChargePoint
// reports its own vocabulary; everything that translates one into the other
// lives here, without I/O, so the tests cover it exhaustively.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';

// Values of the core constants (not exported by the SDK).
export const CONNECTOR_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2,
  UNAVAILABLE: 3,
  FAULTED: 4,
};

export const CHARGING_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
  DISCHARGING: 5,
};

// Message keys (src/i18n.js) naming each value, for the widgets.
export const CONNECTOR_STATUS_LABELS = {
  [CONNECTOR_STATUS.AVAILABLE]: 'state_available',
  [CONNECTOR_STATUS.OCCUPIED]: 'state_occupied',
  [CONNECTOR_STATUS.RESERVED]: 'state_reserved',
  [CONNECTOR_STATUS.UNAVAILABLE]: 'state_unavailable',
  [CONNECTOR_STATUS.FAULTED]: 'state_faulted',
};

export const CHARGING_STATE_LABELS = {
  [CHARGING_STATE.CHARGING]: 'state_charging',
  [CHARGING_STATE.EV_CONNECTED]: 'state_ev_connected',
  [CHARGING_STATE.PAUSED_BY_VEHICLE]: 'state_paused_by_vehicle',
  [CHARGING_STATE.PAUSED_BY_CHARGER]: 'state_paused_by_charger',
  [CHARGING_STATE.IDLE]: 'state_idle',
  [CHARGING_STATE.DISCHARGING]: 'state_idle',
};

const FAULT_PATTERN = /fault|error|out_of_service|broken|repair/i;
const IN_USE_PATTERN = /in_use|occupied|charging|busy/i;

/** A session ChargePoint still reports as running ("IN_USE"). */
export function isSessionActive(session) {
  return Boolean(session) && /IN_USE|CHARGING/.test(session.chargingState ?? '');
}

/** Is energy flowing (or about to) on this home charger right now? */
export function isHomeChargerCharging(status, session) {
  if (status?.chargingStatus === 'CHARGING') {
    return true;
  }
  return isSessionActive(session);
}

export function homeChargerConnectorStatus(status) {
  if (!status || !status.isConnected) {
    return CONNECTOR_STATUS.UNAVAILABLE;
  }
  if (FAULT_PATTERN.test(status.chargingStatus)) {
    return CONNECTOR_STATUS.FAULTED;
  }
  if (status.isPluggedIn) {
    return CONNECTOR_STATUS.OCCUPIED;
  }
  return CONNECTOR_STATUS.AVAILABLE;
}

/**
 * The session state of a home charger. Gladys only reads it while the
 * connector is OCCUPIED; with no vehicle the integration reports IDLE so a
 * stale "charging" never lingers on the dashboard.
 */
export function homeChargerChargingState(status, session, schedule) {
  if (!status) {
    return CHARGING_STATE.IDLE;
  }
  const sessionState = session?.chargingState ?? '';
  if (status.chargingStatus === 'CHARGING' || (isSessionActive(session) && session.powerKw > 0)) {
    return CHARGING_STATE.CHARGING;
  }
  if (!status.isPluggedIn) {
    return CHARGING_STATE.IDLE;
  }
  if (/FULLY|DONE|COMPLETE/.test(status.chargingStatus) || /FULLY|DONE/.test(sessionState)) {
    return CHARGING_STATE.PAUSED_BY_VEHICLE;
  }
  if (schedule?.scheduleEnabled && !status.isDuringScheduledTime) {
    return CHARGING_STATE.PAUSED_BY_CHARGER;
  }
  if (isSessionActive(session)) {
    // Session open, no power: the vehicle is not drawing (full or delayed).
    return CHARGING_STATE.PAUSED_BY_VEHICLE;
  }
  return CHARGING_STATE.EV_CONNECTED;
}

export function countAvailablePorts(station) {
  return (station?.ports ?? []).filter((port) => /^available/.test(port.status)).length;
}

export function publicStationConnectorStatus(station) {
  if (!station) {
    return CONNECTOR_STATUS.UNAVAILABLE;
  }
  const statuses = station.ports.length > 0 ? station.ports.map((p) => p.status) : [station.status];
  if (statuses.some((status) => /^available/.test(status))) {
    return CONNECTOR_STATUS.AVAILABLE;
  }
  if (statuses.some((status) => IN_USE_PATTERN.test(status))) {
    return CONNECTOR_STATUS.OCCUPIED;
  }
  if (statuses.some((status) => /reserved|waitlist/.test(status))) {
    return CONNECTOR_STATUS.RESERVED;
  }
  if (statuses.some((status) => FAULT_PATTERN.test(status))) {
    return CONNECTOR_STATUS.FAULTED;
  }
  return CONNECTOR_STATUS.UNAVAILABLE;
}

/** Gladys unit of a currency code, `undefined` when Gladys has none. */
export function currencyUnit(code) {
  switch (String(code ?? '').toUpperCase()) {
    case 'EUR':
      return DEVICE_FEATURE_UNITS.EURO;
    case 'USD':
    case 'CAD':
    case 'AUD':
      return DEVICE_FEATURE_UNITS.DOLLAR;
    case 'GBP':
      return DEVICE_FEATURE_UNITS.POUND_STERLING;
    default:
      return undefined;
  }
}

/** The amperage ChargePoint accepts closest to the requested one, never above it. */
export function closestAmperage(requested, allowed) {
  if (!allowed || allowed.length === 0) {
    return Math.round(requested);
  }
  const below = allowed.filter((value) => value <= requested);
  return below.length > 0 ? Math.max(...below) : Math.min(...allowed);
}

/**
 * LED brightness: ChargePoint levels 0..5 (0 = off, 5 = 100 %), exposed in
 * Gladys as a 0-100 % dimmer.
 */
export function ledLevelToPercent(level) {
  return Math.max(0, Math.min(100, Math.round(level * 20)));
}

export function percentToLedLevel(percent, supportedLevels = []) {
  const wanted = Math.round(Math.max(0, Math.min(100, percent)) / 20);
  if (supportedLevels.length === 0) {
    return wanted;
  }
  return supportedLevels.reduce((best, level) =>
    Math.abs(level - wanted) < Math.abs(best - wanted) ? level : best,
  );
}

/** "HH:MM" (24 h) check for the charging schedule times. */
export function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}
