// -----------------------------------------------------------------------------
// The integration controller: ties the ChargePoint service to Gladys.
//
//   - a refresh loop at the interval of the configuration: one snapshot, then
//     the changed states, the scene events, the transport badges and a widget
//     nudge — all derived from that snapshot;
//   - the commands (Gladys device features, manifest actions, scene actions,
//     widget buttons), written once here and reached from every surface.
//
// index.js only wires the SDK callbacks to this class.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import {
  CaptchaError,
  InvalidSessionError,
  LoginError,
  MissingCredentialsError,
  isAuthError,
} from './chargepoint/errors.js';
import {
  DEVICE_TYPES,
  FEATURES,
  buildDiscoveredDevices,
  buildStates,
  describeDevices,
  homeChargerIdOf,
  parseExternalId,
} from './devices.js';
import { detectSceneEvents } from './events.js';
import { t } from './i18n.js';
import {
  closestAmperage,
  isSessionActive,
  ledLevelToPercent,
  percentToLedLevel,
  publicStationConnectorStatus,
} from './mapping.js';

const logger = createLogger({ name: 'controller' });

// An unchanged value is still re-sent every 30 minutes, so it stays recently
// dated in Gladys (the host API accepts 300 states per minute).
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;
// After a command, ChargePoint needs a few seconds to reflect it.
const POST_COMMAND_REFRESH_MS = 10_000;

/** Raised to the user with a translated message. */
export class UserError extends Error {
  constructor(messageKey, vars) {
    super(t(messageKey, vars).en);
    this.name = 'UserError';
    this.messageKey = messageKey;
    this.translated = t(messageKey, vars);
  }
}

export function connectionErrorMessage(err) {
  if (err instanceof MissingCredentialsError) return t('missing_credentials');
  if (err instanceof CaptchaError) return t('captcha_required');
  if (err instanceof LoginError) return t('invalid_credentials');
  if (err instanceof InvalidSessionError) return t('session_expired');
  return t('unreachable');
}

export class ChargePointController {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {import('./service.js').ChargePointService} options.service
   * @param {() => void} [options.onSnapshot] called after every published refresh
   */
  constructor({ gladys, service, onSnapshot }) {
    this.gladys = gladys;
    this.service = service;
    this.onSnapshot = onSnapshot ?? (() => {});
    this.config = null;
    this.timer = null;
    this.quickTimer = null;
    this.inFlight = null;
    this.publishedDeviceIds = '';
    this.stopped = true;
  }

  // --- Lifecycle --------------------------------------------------------------

  /** (Re)start with a configuration: connect, publish, then loop. */
  async start(config) {
    this.stop();
    this.stopped = false;
    this.config = config;
    this.publishedDeviceIds = '';
    try {
      await this.service.connect(config);
    } catch (err) {
      await this.reportFailure(err);
      this.scheduleNext();
      return false;
    }
    await this.refreshNow();
    return true;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.quickTimer);
    this.timer = null;
    this.quickTimer = null;
  }

  scheduleNext() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.refreshNow().catch((err) => logger.error('Refresh failed', err));
    }, this.config.poll_frequency * 1000);
    this.timer.unref?.();
  }

  /** A quick refresh shortly after a command, coalesced. */
  scheduleQuickRefresh(delayMs = POST_COMMAND_REFRESH_MS) {
    clearTimeout(this.quickTimer);
    if (this.stopped) return;
    this.quickTimer = setTimeout(() => {
      this.refreshNow().catch((err) => logger.error('Refresh failed', err));
    }, delayMs);
    this.quickTimer.unref?.();
  }

  /** One refresh at a time: concurrent callers share the running one. */
  refreshNow() {
    if (!this.inFlight) {
      this.inFlight = this.doRefresh().finally(() => {
        this.inFlight = null;
        this.scheduleNext();
      });
    }
    return this.inFlight;
  }

  async doRefresh() {
    const previous = this.service.snapshot;
    let snapshot;
    try {
      snapshot = await this.service.refresh();
    } catch (err) {
      await this.reportFailure(err);
      return null;
    }
    await this.publishSnapshot(previous, snapshot);
    await this.gladys.setConnectionStatus(true);
    return snapshot;
  }

  async reportFailure(err) {
    if (isAuthError(err)) {
      logger.error(`ChargePoint authentication failed: ${err.name}`);
    } else {
      logger.error(`ChargePoint unreachable: ${err.message}`);
    }
    await this.gladys.setConnectionStatus(false, connectionErrorMessage(err)).catch(() => {});
    if (this.service.snapshot) {
      await this.publishTransports(true).catch(() => {});
    }
  }

  async publishSnapshot(previous, snapshot) {
    const devices = buildDiscoveredDevices(this.gladys, snapshot);
    const deviceIds = JSON.stringify(devices.map((d) => [d.external_id, d.features.length]));
    if (deviceIds !== this.publishedDeviceIds) {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedDeviceIds = deviceIds;
    }

    const states = buildStates(this.gladys, snapshot, this.service);
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }

    for (const { key, data } of detectSceneEvents(this.gladys, previous, snapshot)) {
      logger.info(`Scene event ${key}`);
      await this.gladys.publishSceneEvent(key, data).catch((err) => {
        logger.warn(`Scene event ${key} refused: ${err.message}`);
      });
    }

    await this.publishTransports(false);
    this.onSnapshot();
  }

  /** Cloud badge per device; unreachable when ChargePoint or the device is. */
  async publishTransports(serviceDown) {
    const snapshot = this.service.snapshot;
    const entries = describeDevices(this.gladys, snapshot).map((device) => {
      let reachable = !serviceDown;
      if (device.type === DEVICE_TYPES.HOME_CHARGER) {
        const status = snapshot.homeChargers[device.platformId]?.status;
        reachable = reachable && Boolean(status?.isConnected);
      }
      if (device.type === DEVICE_TYPES.PUBLIC_STATION) {
        reachable = reachable && Boolean(snapshot.publicStations[device.platformId]);
      }
      return {
        external_id: device.ids.device,
        transport: reachable ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
      };
    });
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  /** Discovery requested by the user: refresh, then publish the full list. */
  async scan() {
    if (!this.service.connected && this.config) {
      await this.service.connect(this.config);
    }
    await this.refreshNow();
    await this.gladys.publishDiscoveredDevices(
      buildDiscoveredDevices(this.gladys, this.service.snapshot),
    );
  }

  // --- Helpers ----------------------------------------------------------------

  requireSnapshot() {
    if (!this.service.snapshot) {
      throw new UserError('not_connected');
    }
    return this.service.snapshot;
  }

  /** The home charger id behind a device external id (scene / action field). */
  requireHomeCharger(externalId) {
    const chargerId = homeChargerIdOf(this.gladys, externalId);
    if (chargerId === null || !this.requireSnapshot().homeChargers[chargerId]) {
      throw new UserError('not_a_home_charger');
    }
    return chargerId;
  }

  /**
   * Run a start/stop command. With `wait`, resolve once ChargePoint confirmed
   * it; otherwise as soon as it is accepted (Gladys acks a feature command
   * under 5 s, the confirmation can take a minute), the confirmation then
   * running in the background.
   */
  runSessionCommand(command, { wait }) {
    if (wait) {
      return command(undefined).finally(() => this.scheduleQuickRefresh(2000));
    }
    return new Promise((resolve, reject) => {
      let sent = false;
      command(() => {
        sent = true;
        resolve(true);
      }).then(
        (result) => {
          resolve(result);
          this.scheduleQuickRefresh(2000);
        },
        (err) => {
          if (sent) {
            logger.error(`ChargePoint did not confirm the command: ${err.message}`);
            this.scheduleQuickRefresh(2000);
          } else {
            reject(err);
          }
        },
      );
    });
  }

  // --- Operations (shared by every surface) ------------------------------------

  /** Resolves false when the vehicle is not plugged in. */
  async startCharging(chargerId, { wait = false } = {}) {
    const charger = this.requireSnapshot().homeChargers[chargerId];
    if (charger?.status && !charger.status.isPluggedIn) {
      return false;
    }
    await this.runSessionCommand((onSent) => this.service.startCharging(chargerId, { onSent }), {
      wait,
    });
    return true;
  }

  /** Resolves false when nothing was charging. `deviceExternalId` optional. */
  async stopCharging(deviceExternalId, { wait = false } = {}) {
    this.requireSnapshot();
    let deviceId = null;
    if (deviceExternalId) {
      const parsed = parseExternalId(this.gladys, deviceExternalId);
      // The account device means "wherever the session runs".
      deviceId = parsed?.type === DEVICE_TYPES.HOME_CHARGER ? parsed.platformId : null;
    }
    const session = deviceId ? this.service.sessionAt(deviceId) : this.service.snapshot.session;
    if (!isSessionActive(session)) {
      return false;
    }
    return this.runSessionCommand((onSent) => this.service.stopCharging(deviceId, { onSent }), {
      wait,
    });
  }

  /** Resolves the amperage actually applied. */
  async setAmperageLimit(chargerId, requested) {
    const status = this.requireSnapshot().homeChargers[chargerId]?.status;
    const amperage = closestAmperage(Number(requested), status?.possibleAmperageLimits);
    await this.service.setAmperageLimit(chargerId, amperage);
    if (status) status.amperageLimit = amperage;
    this.scheduleQuickRefresh();
    return amperage;
  }

  async setSchedule(chargerId, enabled, times) {
    this.requireSnapshot();
    await this.service.setSchedule(chargerId, enabled, times);
    const charger = this.service.homeCharger(chargerId);
    if (charger) {
      // Reflect the change until the next refresh reads it back.
      charger.schedule = { ...(charger.schedule ?? {}), scheduleEnabled: enabled };
    }
    this.scheduleQuickRefresh();
    return enabled;
  }

  /** Resolves the LED level (0-5) actually applied. */
  async setLedBrightness(chargerId, percent) {
    const config = this.requireSnapshot().homeChargers[chargerId]?.config;
    const level = percentToLedLevel(Number(percent), config?.ledBrightness.supportedLevels);
    await this.service.setLedBrightness(chargerId, level);
    if (config) config.ledBrightness.level = level;
    this.scheduleQuickRefresh();
    return level;
  }

  async restartCharger(chargerId) {
    this.requireSnapshot();
    await this.service.restartCharger(chargerId);
    this.scheduleQuickRefresh(60_000);
  }

  // --- Gladys device features -----------------------------------------------------

  async setValue(device, feature, value) {
    const parsed = parseExternalId(this.gladys, feature.external_id);
    if (!parsed || parsed.type !== DEVICE_TYPES.HOME_CHARGER) {
      throw new Error(`Feature ${feature.external_id} is read-only`);
    }
    const chargerId = Number(parsed.platformId);
    if (!this.requireSnapshot().homeChargers[chargerId]) {
      throw new UserError('not_a_home_charger');
    }
    switch (parsed.featureKey) {
      case FEATURES.CHARGE: {
        if (Number(value) === 1) {
          if (!(await this.startCharging(chargerId))) {
            throw new UserError('not_plugged_in');
          }
        } else if (!(await this.stopCharging(device.external_id))) {
          throw new UserError('no_active_session');
        }
        return;
      }
      case FEATURES.AMPERAGE_LIMIT: {
        const amperage = await this.setAmperageLimit(chargerId, value);
        await this.gladys.publishState(feature.external_id, amperage);
        return;
      }
      case FEATURES.SCHEDULE: {
        const enabled = Number(value) === 1;
        await this.setSchedule(chargerId, enabled);
        await this.gladys.publishState(feature.external_id, enabled ? 1 : 0);
        return;
      }
      case FEATURES.LED_BRIGHTNESS: {
        const level = await this.setLedBrightness(chargerId, value);
        await this.gladys.publishState(feature.external_id, ledLevelToPercent(level));
        return;
      }
      default:
        throw new Error(`Feature ${feature.external_id} is read-only`);
    }
  }

  // --- Manifest actions (Configuration screen) ------------------------------------

  async testConnection() {
    try {
      if (!this.service.connected) {
        await this.service.connect(this.config);
      }
      await this.refreshNow();
    } catch (err) {
      return connectionErrorMessage(err);
    }
    const snapshot = this.service.snapshot;
    if (!snapshot) {
      return t('not_connected');
    }
    return t('connection_ok', {
      username: snapshot.account.username || this.config.username,
      chargers: Object.keys(snapshot.homeChargers).length,
      stations: Object.keys(snapshot.publicStations).length,
    });
  }

  async findStations({ latitude, longitude, radius }) {
    this.requireSnapshot();
    const stations = await this.service.findNearbyStations({
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusMeters: Math.min(5000, Math.max(100, Number(radius) || 1000)),
    });
    const publicOnes = stations.filter((station) => !station.isHome).slice(0, 10);
    if (publicOnes.length === 0) {
      return t('no_station_found');
    }
    const list = publicOnes
      .map((station) => `${station.deviceId} (${station.name || station.address || '?'})`)
      .join(', ');
    return t('stations_found', { list });
  }

  /** Public station availability, for the widgets. */
  publicStationRows() {
    const snapshot = this.service.snapshot;
    return Object.entries(snapshot?.publicStations ?? {}).map(([stationId, station]) => ({
      stationId,
      station,
      status: publicStationConnectorStatus(station),
    }));
  }
}
