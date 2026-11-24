// -----------------------------------------------------------------------------
// Scene triggers (Gladys 5.1+): what HAPPENED between two snapshots.
//
// Each key is declared in the manifest `scene_triggers`; the integration fires
// it with `gladys.publishSceneEvent(key, data)` once per transition (never once
// per refresh). The `data` keys are the trigger `fields` (filters: `device` is
// the external id of the device, a "source": "devices" select) and its
// `variables` (readable by the scene as {{triggerEvent.data.<key>}}): any other
// key would be dropped by the core.
//
// Nothing fires on the first snapshot: there is no "before" to compare with,
// and a restart of the integration must not replay events.
// -----------------------------------------------------------------------------

import { countAvailablePorts, isHomeChargerCharging, isSessionActive, round } from './mapping.js';
import { DEVICE_TYPES } from './devices.js';

export const SCENE_TRIGGERS = {
  CHARGING_STARTED: 'charging_started',
  CHARGING_STOPPED: 'charging_stopped',
  VEHICLE_PLUGGED_IN: 'vehicle_plugged_in',
  VEHICLE_UNPLUGGED: 'vehicle_unplugged',
  PUBLIC_STATION_AVAILABLE: 'public_station_available',
};

function sessionAt(snapshot, deviceId) {
  const session = snapshot?.session;
  return session && session.deviceId === Number(deviceId) ? session : null;
}

function stoppedData(device, session) {
  return {
    device,
    energy_kwh: session ? round(session.energyKwh, 3) : 0,
    cost: session ? round(session.totalAmount, 2) : 0,
    duration_minutes: session ? Math.round(session.chargingTime / 60) : 0,
  };
}

/**
 * The scene events between `previous` and `current`.
 * @returns {{ key: string, data: Record<string, string | number> }[]}
 */
export function detectSceneEvents(gladys, previous, current) {
  if (!previous || !current) {
    return [];
  }
  const events = [];

  // Home chargers: plug and charge transitions.
  for (const [chargerId, charger] of Object.entries(current.homeChargers)) {
    const before = previous.homeChargers[chargerId];
    if (!before?.status || !charger.status) {
      continue; // unknown on one side: no transition to report
    }
    const device = gladys.externalIds(DEVICE_TYPES.HOME_CHARGER, chargerId).device;

    if (!before.status.isPluggedIn && charger.status.isPluggedIn) {
      events.push({ key: SCENE_TRIGGERS.VEHICLE_PLUGGED_IN, data: { device } });
    }
    const wasCharging = isHomeChargerCharging(before.status, sessionAt(previous, chargerId));
    const isCharging = isHomeChargerCharging(charger.status, sessionAt(current, chargerId));
    if (!wasCharging && isCharging) {
      events.push({ key: SCENE_TRIGGERS.CHARGING_STARTED, data: { device } });
    }
    if (wasCharging && !isCharging) {
      const session = sessionAt(current, chargerId) ?? sessionAt(previous, chargerId);
      events.push({ key: SCENE_TRIGGERS.CHARGING_STOPPED, data: stoppedData(device, session) });
    }
    if (before.status.isPluggedIn && !charger.status.isPluggedIn) {
      events.push({ key: SCENE_TRIGGERS.VEHICLE_UNPLUGGED, data: { device } });
    }
  }

  // Sessions away from home (public stations): reported on the account device.
  if (current.account?.userId) {
    const device = gladys.externalIds(DEVICE_TYPES.ACCOUNT, current.account.userId).device;
    const away = (snapshot) => {
      const session = snapshot.session;
      return isSessionActive(session) && !(String(session.deviceId) in snapshot.homeChargers)
        ? session
        : null;
    };
    const before = away(previous);
    const now = away(current);
    if (!before && now) {
      events.push({ key: SCENE_TRIGGERS.CHARGING_STARTED, data: { device } });
    }
    if (before && !now) {
      events.push({ key: SCENE_TRIGGERS.CHARGING_STOPPED, data: stoppedData(device, before) });
    }
  }

  // Followed public stations: a port frees up.
  for (const [stationId, station] of Object.entries(current.publicStations)) {
    const before = previous.publicStations[stationId];
    if (!before || !station) {
      continue;
    }
    const available = countAvailablePorts(station);
    if (countAvailablePorts(before) === 0 && available > 0) {
      events.push({
        key: SCENE_TRIGGERS.PUBLIC_STATION_AVAILABLE,
        data: {
          device: gladys.externalIds(DEVICE_TYPES.PUBLIC_STATION, stationId).device,
          available_ports: available,
        },
      });
    }
  }
  return events;
}
