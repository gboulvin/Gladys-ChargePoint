// -----------------------------------------------------------------------------
// ChargePoint service: the session with the cloud, the data snapshot and the
// commands.
//
// One refresh reads everything the devices need (account, active session,
// home chargers with their status / technical info / configuration /
// schedule, tracked public stations) and produces an immutable snapshot. The
// devices, the scene triggers and the widgets are all computed from it.
//
// Like ha-chargepoint, a partial failure never empties the dashboard: a home
// charger whose status cannot be read is reported unavailable, the session of
// the previous snapshot is kept when the session API hiccups, and an expired
// session triggers one automatic re-login before asking the user.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ChargePointClient } from './chargepoint/client.js';
import {
  ChargePointError,
  InvalidSessionError,
  CaptchaError,
  MissingCredentialsError,
} from './chargepoint/errors.js';
import { isSessionActive } from './mapping.js';

const logger = createLogger({ name: 'chargepoint' });

export class ChargePointService {
  /**
   * @param {object} options
   * @param {{ read: Function, write: Function }} options.store token persistence
   * @param {typeof fetch} [options.fetch]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({ store, fetch, sleep } = {}) {
    this.store = store;
    this.fetch = fetch;
    this.sleep = sleep;
    this.config = null;
    this.client = null;
    this.snapshot = null;
    this.savedToken = null;
    // Last known session per device id: the energy of a finished session stays
    // readable ("last charge") once ChargePoint stops reporting it.
    this.lastSessions = new Map();
  }

  get connected() {
    return this.client !== null && this.client.userId !== null;
  }

  newClient(token) {
    return new ChargePointClient({
      username: this.config.username,
      token,
      fetch: this.fetch,
      sleep: this.sleep,
    });
  }

  /**
   * Open a session, trying in order: the token stored in /data (freshest), the
   * token typed in the configuration, then the password. Throws the most
   * meaningful error when none works.
   */
  async connect(config) {
    this.config = config;
    this.client = null;
    if (!config.username) {
      throw new MissingCredentialsError();
    }
    const stored = await this.store.read();
    const tokens = [];
    if (stored?.token && stored.username === config.username) {
      tokens.push(stored.token);
    }
    if (config.coulomb_token && !tokens.includes(config.coulomb_token)) {
      tokens.push(config.coulomb_token);
    }
    if (tokens.length === 0 && !config.password) {
      throw new MissingCredentialsError();
    }

    let lastError = null;
    for (const token of tokens) {
      const client = this.newClient(token);
      try {
        await client.discover();
        await client.initAccount();
        return this.adopt(client);
      } catch (err) {
        if (!(err instanceof InvalidSessionError) && !(err instanceof CaptchaError)) {
          throw err;
        }
        logger.info('A stored ChargePoint session was refused, trying the next credentials');
        lastError = err;
      }
    }
    if (config.password) {
      const client = this.newClient('');
      await client.discover();
      await client.loginWithPassword(config.password);
      return this.adopt(client);
    }
    throw lastError ?? new MissingCredentialsError();
  }

  async adopt(client) {
    this.client = client;
    await this.persistToken();
    logger.info(`Connected to ChargePoint (region ${client.globalConfig?.region || 'unknown'})`);
    return client;
  }

  async persistToken() {
    const token = this.client?.token;
    if (token && token !== this.savedToken) {
      await this.store.write(this.client.username, token);
      this.savedToken = token;
    }
  }

  /** Run an API call, re-logging in once when the session expired. */
  async withSession(fn) {
    if (!this.client) {
      await this.connect(this.config);
    }
    try {
      return await fn(this.client);
    } catch (err) {
      if (!(err instanceof InvalidSessionError)) {
        throw err;
      }
      logger.warn('ChargePoint session expired, logging in again');
      await this.connect(this.config);
      return fn(this.client);
    } finally {
      await this.persistToken();
    }
  }

  /** Read everything, build and keep the new snapshot. */
  async refresh() {
    const snapshot = await this.withSession((client) => this.fetchSnapshot(client));
    this.snapshot = snapshot;
    return snapshot;
  }

  async fetchSnapshot(client) {
    const previous = this.snapshot;
    const account = await client.getAccount();

    let status;
    let session = null;
    try {
      status = await client.getUserChargingStatus();
      if (status?.sessionId) {
        try {
          session = await client.getChargingSession(status.sessionId);
        } catch (err) {
          if (err instanceof InvalidSessionError) throw err;
          // The session API is eventually consistent: keep the last one
          // rather than resetting the energy counters to zero.
          logger.warn(`Cannot read the active session, keeping the last one (${err.message})`);
          session = previous?.session ?? null;
        }
      }
    } catch (err) {
      if (err instanceof InvalidSessionError) throw err;
      logger.warn(`Cannot read the charging status, keeping the last one (${err.message})`);
      status = previous?.status ?? null;
      session = previous?.session ?? null;
    }
    if (session) {
      this.lastSessions.set(session.deviceId, session);
    }

    const chargerIds = await client.getHomeChargers();
    const homeChargers = {};
    await Promise.all(
      chargerIds.map(async (chargerId) => {
        homeChargers[chargerId] = await this.fetchHomeCharger(client, chargerId);
      }),
    );

    const publicStations = {};
    await Promise.all(
      (this.config?.publicStationIds ?? []).map(async (stationId) => {
        try {
          publicStations[stationId] = await client.getStation(stationId);
        } catch (err) {
          if (err instanceof InvalidSessionError) throw err;
          logger.warn(`Cannot read public station ${stationId} (${err.message})`);
          publicStations[stationId] = null;
        }
      }),
    );

    return {
      fetchedAt: new Date().toISOString(),
      account,
      currency: client.currency,
      status,
      session,
      homeChargers,
      publicStations,
    };
  }

  async fetchHomeCharger(client, chargerId) {
    const safe = async (label, fn) => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof InvalidSessionError) throw err;
        logger.warn(`Cannot read the ${label} of charger ${chargerId} (${err.message})`);
        return null;
      }
    };
    const [status, techInfo, config, schedule] = await Promise.all([
      safe('status', () => client.getHomeChargerStatus(chargerId)),
      safe('technical info', () => client.getHomeChargerTechnicalInfo(chargerId)),
      safe('configuration', () => client.getHomeChargerConfig(chargerId)),
      safe('schedule', () => client.getHomeChargerSchedule(chargerId)),
    ]);
    return { id: chargerId, status, techInfo, config, schedule };
  }

  // --- Snapshot helpers -------------------------------------------------------

  homeCharger(chargerId) {
    return this.snapshot?.homeChargers?.[chargerId] ?? null;
  }

  /** The active session running on that device (home charger), or null. */
  sessionAt(deviceId) {
    const session = this.snapshot?.session;
    return session && session.deviceId === Number(deviceId) ? session : null;
  }

  /** The last known session of a device, finished or not. */
  lastSessionAt(deviceId) {
    return this.lastSessions.get(Number(deviceId)) ?? null;
  }

  // --- Commands -----------------------------------------------------------------

  /**
   * Start a session on a home charger. Resolves once ChargePoint confirmed it;
   * `onSent` fires as soon as the command is accepted.
   */
  async startCharging(chargerId, { onSent } = {}) {
    const charger = this.homeCharger(chargerId);
    if (charger?.status && !charger.status.isPluggedIn) {
      throw new ChargePointError('Cannot start a session if the vehicle is not plugged in');
    }
    await this.withSession((client) => client.startSession(Number(chargerId), onSent));
  }

  /**
   * Stop the active session — on that device when given, any session (a public
   * station included) otherwise. Resolves `false` when nothing was charging.
   */
  async stopCharging(deviceId, { onSent } = {}) {
    const session = deviceId ? this.sessionAt(deviceId) : this.snapshot?.session;
    if (!session || !isSessionActive(session)) {
      return false;
    }
    await this.withSession((client) => client.stopSession(session, onSent));
    return true;
  }

  async setAmperageLimit(chargerId, amperage) {
    await this.withSession((client) => client.setAmperageLimit(Number(chargerId), amperage));
  }

  async setLedBrightness(chargerId, level) {
    await this.withSession((client) => client.setLedBrightness(Number(chargerId), level));
  }

  async restartCharger(chargerId) {
    await this.withSession((client) => client.restartHomeCharger(Number(chargerId)));
  }

  /**
   * Enable (with the given times, or the user/default ones) or disable the
   * charging schedule of a home charger.
   */
  async setSchedule(chargerId, enabled, times = {}) {
    if (!enabled) {
      return this.withSession((client) => client.disableHomeChargerSchedule(Number(chargerId)));
    }
    const current = this.homeCharger(chargerId)?.schedule;
    const base = current?.userSchedule ?? current?.defaultSchedule;
    const weekdays = {
      startTime: times.weekdayStart || base?.weekdays.startTime,
      endTime: times.weekdayEnd || base?.weekdays.endTime,
    };
    const weekends = {
      startTime: times.weekendStart || base?.weekends.startTime,
      endTime: times.weekendEnd || base?.weekends.endTime,
    };
    if (!weekdays.startTime || !weekdays.endTime || !weekends.startTime || !weekends.endTime) {
      throw new ChargePointError('No schedule times known for this charger');
    }
    return this.withSession((client) =>
      client.setHomeChargerSchedule(Number(chargerId), { weekdays, weekends }),
    );
  }

  async findNearbyStations({ latitude, longitude, radiusMeters }) {
    const latDelta = radiusMeters / 111_000;
    const lonDelta = radiusMeters / (111_000 * Math.cos((latitude * Math.PI) / 180));
    return this.withSession((client) =>
      client.getNearbyStations({
        swLat: latitude - latDelta,
        swLon: longitude - lonDelta,
        neLat: latitude + latDelta,
        neLon: longitude + lonDelta,
      }),
    );
  }
}
