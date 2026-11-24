// -----------------------------------------------------------------------------
// ChargePoint cloud API client.
//
// A JavaScript port of python-chargepoint (https://github.com/mbillow/python-chargepoint),
// the library behind the Home Assistant integration ha-chargepoint. Same
// endpoints, same authentication:
//
//   1. the region of the account is discovered from the username
//      (POST discovery.chargepoint.com/discovery/v3/globalconfig), which gives
//      the endpoints of every API;
//   2. the session is the `coulomb_sess` cookie, obtained by a password login
//      (SSO) or pasted by the user when the Datadome bot protection asks for a
//      captcha. ChargePoint renews it on every response: the client keeps the
//      freshest value in `token`, which the integration persists in /data;
//   3. once logged in, every request carries the cookie and the
//      `cp-session-*` headers.
//
// The client takes an injectable `fetch` (and `sleep`) so the tests never touch
// the network. It never logs the token nor the password.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CaptchaError, ChargePointError, InvalidSessionError, LoginError } from './errors.js';

const logger = createLogger({ name: 'chargepoint-api' });

export const DISCOVERY_API = 'https://discovery.chargepoint.com/discovery/v3/globalconfig';
export const COULOMB_SESSION = 'coulomb_sess';
const USER_AGENT = 'gladys-chargepoint';

// Start/stop commands are confirmed asynchronously by the station: poll the
// acknowledgement up to 20 times, 3 s apart (python-chargepoint's values).
const ACK_ATTEMPTS = 20;
const ACK_INTERVAL_MS = 3000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function joinUrl(base, path) {
  if (!base) {
    throw new ChargePointError(`ChargePoint endpoint missing for ${path}`);
  }
  return `${String(base).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Read the `coulomb_sess` value from the Set-Cookie headers of a response. */
export function readSessionCookie(headers) {
  const cookies =
    typeof headers?.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers?.get?.('set-cookie')].filter(Boolean);
  for (const cookie of cookies) {
    for (const part of cookie.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
      const match = part.trim().match(new RegExp(`^${COULOMB_SESSION}=([^;]*)`));
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  }
  return null;
}

// --- Parsers: API payloads -> the stable shapes the integration uses ---------

/** Endpoints come as `{ accounts_endpoint: { value: 'https://...' } }`. */
export function parseGlobalConfig(raw = {}) {
  const endpoints = {};
  for (const [key, value] of Object.entries(raw.endPoints ?? {})) {
    endpoints[key] = value && typeof value === 'object' ? (value.value ?? '') : value;
  }
  return {
    region: raw.region ?? '',
    currency: {
      code: raw.currency?.code ?? '',
      symbol: raw.currency?.symbol ?? '',
    },
    endpoints,
  };
}

export function parseAccount(raw = {}) {
  const amount = raw.accountBalance?.balance?.amount;
  return {
    userId: toNumber(raw.user?.userId),
    username: raw.user?.username ?? '',
    fullName: raw.user?.fullName ?? '',
    balance: amount === undefined || amount === '' ? null : toNumber(amount, null),
    currency: raw.accountBalance?.balance?.currency ?? '',
  };
}

export function parseHomeChargerStatus(chargerId, raw = {}) {
  const amperage = raw.chargeAmperageSettings ?? {};
  return {
    chargerId,
    brand: raw.brand ?? null,
    model: raw.model ?? '',
    macAddress: raw.macAddress ?? '',
    chargingStatus: String(raw.chargingStatus ?? '').toUpperCase(),
    isPluggedIn: raw.isPluggedIn === true,
    isConnected: raw.isConnected === true,
    isDuringScheduledTime: raw.isDuringScheduledTime === true,
    amperageLimit: toNumber(amperage.chargeLimit),
    possibleAmperageLimits: (amperage.possibleChargeLimit ?? [])
      .map((value) => toNumber(value, NaN))
      .filter(Number.isFinite)
      .sort((a, b) => a - b),
  };
}

export function parseTechnicalInfo(raw = {}) {
  return {
    serialNumber: raw.serialNumber ?? '',
    modelNumber: raw.modelNumber ?? '',
    softwareVersion: raw.softwareVersion ?? '',
    stopChargeSupported: raw.stopChargeSupported === true,
  };
}

export function parseChargerConfig(raw = {}) {
  const settings = raw.settings ?? raw;
  const brightness = settings.led?.brightness ?? {};
  return {
    stationNickname: settings.stationNickname ?? '',
    ledBrightness: {
      level: toNumber(brightness.level, 5),
      supportedLevels: (brightness.supportedLevels ?? []).map(Number).filter(Number.isFinite),
      isEnabled: brightness.isEnabled !== false,
    },
  };
}

function parseWindow(raw = {}) {
  return { startTime: raw.startTime ?? '', endTime: raw.endTime ?? '' };
}

function parseScheduleBlock(raw) {
  if (!raw) {
    return null;
  }
  return { weekdays: parseWindow(raw.weekdays), weekends: parseWindow(raw.weekends) };
}

export function parseSchedule(raw = {}) {
  return {
    scheduleEnabled: raw.scheduleEnabled === true,
    defaultSchedule: parseScheduleBlock(raw.defaultSchedule),
    userSchedule: parseScheduleBlock(raw.userSchedule),
  };
}

/** `user_status` of the mapcache API, `null` when nothing is charging. */
export function parseUserChargingStatus(raw) {
  if (!raw || Object.keys(raw).length === 0) {
    return null;
  }
  const charging = raw.charging ?? raw;
  return {
    sessionId: toNumber(charging.sessionId),
    state: String(charging.state ?? 'unknown'),
    stationIds: (charging.stations ?? []).map((station) => toNumber(station.deviceId)),
  };
}

/** `charging_status` of the driver-bff session API (snake_case). */
export function parseChargingSession(sessionId, raw = {}) {
  return {
    sessionId,
    deviceId: toNumber(raw.device_id),
    deviceName: raw.device_name ?? '',
    chargingState: String(raw.current_charging ?? '').toUpperCase(),
    chargingTime: toNumber(raw.charging_time),
    energyKwh: toNumber(raw.energy_kwh),
    powerKw: toNumber(raw.power_kw),
    totalAmount: toNumber(raw.total_amount),
    currency: typeof raw.currency_iso_code === 'string' ? raw.currency_iso_code : '',
    outletNumber: toNumber(raw.outlet_number, 1),
    isHomeCharger: raw.is_home_charger === true,
    startTime: raw.start_time ? new Date(toNumber(raw.start_time)).toISOString() : null,
  };
}

export function parseStation(raw = {}) {
  const ports = (raw.portsInfo?.ports ?? []).map((port) => ({
    outletNumber: toNumber(port.outletNumber),
    status: String(port.statusV2 || port.status || '').toLowerCase(),
    level: port.displayLevel ?? port.level ?? '',
    maxPowerKw: toNumber(port.powerRange?.max),
    connectors: (port.connectorList ?? []).map((c) => c.displayPlugType || c.plugType || ''),
  }));
  const names = Array.isArray(raw.name) ? raw.name : [raw.name].filter(Boolean);
  return {
    deviceId: toNumber(raw.deviceId),
    name: names.filter(Boolean).join(' '),
    address: [raw.address?.address1, raw.address?.city].filter(Boolean).join(', '),
    networkName: raw.network?.displayName || raw.network?.name || '',
    status: String(raw.stationStatusV2 || raw.stationStatus || '').toLowerCase(),
    ports,
  };
}

export function parseMapStation(raw = {}) {
  return {
    deviceId: toNumber(raw.device_id),
    name: [raw.name1, raw.name2].filter(Boolean).join(' '),
    address: [raw.address1, raw.city].filter(Boolean).join(', '),
    status: String(raw.station_status_v2 || raw.station_status || '').toLowerCase(),
    latitude: toNumber(raw.lat),
    longitude: toNumber(raw.lon),
    isHome: raw.is_home === true,
  };
}

// --- The client ---------------------------------------------------------------

export class ChargePointClient {
  /**
   * @param {object} options
   * @param {string} options.username ChargePoint e-mail / username
   * @param {string} [options.token] a known `coulomb_sess` value
   * @param {typeof fetch} [options.fetch]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({ username, token = '', fetch: fetchImpl = globalThis.fetch, sleep } = {}) {
    this.username = username;
    this.token = token ? decodeURIComponent(token) : null;
    this.fetch = fetchImpl;
    this.sleep = sleep ?? defaultSleep;
    this.userId = null;
    this.globalConfig = null;
  }

  get endpoints() {
    return this.globalConfig?.endpoints ?? {};
  }

  get currency() {
    return this.globalConfig?.currency ?? { code: '', symbol: '' };
  }

  headers(auth = true) {
    const headers = {
      'user-agent': USER_AGENT,
      accept: 'application/json',
    };
    if (auth && this.token) {
      headers.cookie = `${COULOMB_SESSION}=${encodeURIComponent(this.token)}`;
      if (this.userId !== null) {
        headers['cp-session-type'] = 'CP_SESSION_TOKEN';
        headers['cp-session-token'] = this.token;
        headers['cp-region'] = this.globalConfig?.region ?? '';
      }
    }
    return headers;
  }

  /**
   * One HTTP exchange. Keeps the renewed session cookie, maps 401 to
   * InvalidSessionError and a Datadome 403 to CaptchaError. Resolves the parsed
   * JSON body (or null) and the status; non-2xx statuses are left to the caller
   * unless `expectOk` (the default) is set.
   */
  async request(method, url, { json, expectOk = true, auth = true } = {}) {
    logger.debug(`[${method}] ${url.split('?')[0]}`);
    const init = { method, headers: this.headers(auth) };
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
    let response;
    try {
      response = await this.fetch(url, init);
    } catch (err) {
      throw new ChargePointError(`Network error on ${method} ${url.split('?')[0]}: ${err.message}`);
    }

    const refreshed = readSessionCookie(response.headers);
    if (refreshed) {
      this.token = refreshed;
    }

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (response.status === 401) {
      throw new InvalidSessionError('Session token has expired', { status: 401, body });
    }
    if (response.status === 403) {
      if (body && typeof body.url === 'string') {
        throw new CaptchaError(`${method} blocked by Datadome`, body.url);
      }
      throw new ChargePointError(`Forbidden: ${method} ${url.split('?')[0]}`, {
        status: 403,
        body,
      });
    }
    if (expectOk && (response.status < 200 || response.status >= 300)) {
      throw new ChargePointError(
        `ChargePoint answered HTTP ${response.status} on ${method} ${url.split('?')[0]}`,
        { status: response.status, body },
      );
    }
    return { status: response.status, body };
  }

  /** Discover the region of the account and the endpoints of its APIs. */
  async discover() {
    const { body } = await this.request('POST', DISCOVERY_API, {
      json: { username: this.username },
    });
    this.globalConfig = parseGlobalConfig(body ?? {});
    logger.debug(`Discovered ChargePoint region: ${this.globalConfig.region}`);
    return this.globalConfig;
  }

  /** Exchange the e-mail and password for a session token. */
  async loginWithPassword(password) {
    const url = joinUrl(this.endpoints.sso_endpoint, 'v1/user/login');
    this.token = null;
    let result;
    try {
      result = await this.request('POST', url, {
        json: { username: this.username, password },
        expectOk: false,
        auth: false,
      });
    } catch (err) {
      if (err instanceof InvalidSessionError) {
        throw new LoginError('ChargePoint refused the credentials', { status: 401 });
      }
      throw err;
    }
    if (result.status !== 200 || !this.token) {
      throw new LoginError('ChargePoint refused the credentials', { status: result.status });
    }
    await this.initAccount();
  }

  /** Read the account behind the token: user id, real username, balance. */
  async initAccount() {
    if (!this.token) {
      throw new InvalidSessionError('No session token');
    }
    const account = await this.getAccount();
    this.userId = account.userId;
    if (account.username && account.username !== this.username) {
      logger.warn('The configured username differs from the session one, using the session one');
      this.username = account.username;
    }
    return account;
  }

  async getAccount() {
    const { body } = await this.request(
      'GET',
      joinUrl(this.endpoints.accounts_endpoint, 'v1/driver/profile/user'),
    );
    return parseAccount(body ?? {});
  }

  async getHomeChargers() {
    const { body } = await this.request(
      'GET',
      joinUrl(
        this.endpoints.hcpo_hcm_endpoint,
        `api/v1/configuration/users/${this.userId}/chargers`,
      ),
    );
    return (body?.data ?? []).map((item) => toNumber(item.id)).filter(Boolean);
  }

  chargerUrl(chargerId, suffix) {
    return joinUrl(
      this.endpoints.hcpo_hcm_endpoint,
      `api/v1/configuration/users/${this.userId}/chargers/${chargerId}${suffix}`,
    );
  }

  async getHomeChargerStatus(chargerId) {
    const { body } = await this.request('GET', this.chargerUrl(chargerId, '/status'));
    return parseHomeChargerStatus(chargerId, body ?? {});
  }

  async getHomeChargerTechnicalInfo(chargerId) {
    const { body } = await this.request('GET', this.chargerUrl(chargerId, '/technical-info'));
    return parseTechnicalInfo(body ?? {});
  }

  async getHomeChargerConfig(chargerId) {
    const { body } = await this.request('GET', this.chargerUrl(chargerId, '/configurations'));
    return parseChargerConfig(body ?? {});
  }

  scheduleUrl(chargerId) {
    return joinUrl(
      this.endpoints.hcpo_hcm_endpoint,
      `api/v1/schedule/charger/${chargerId}/schedule`,
    );
  }

  async getHomeChargerSchedule(chargerId) {
    const { body } = await this.request('GET', this.scheduleUrl(chargerId));
    return parseSchedule(body ?? {});
  }

  async setHomeChargerSchedule(chargerId, { weekdays, weekends }) {
    const { body } = await this.request('PUT', this.scheduleUrl(chargerId), {
      json: {
        schedule: {
          weekdays: { startTime: weekdays.startTime, endTime: weekdays.endTime },
          weekends: { startTime: weekends.startTime, endTime: weekends.endTime },
        },
      },
    });
    return parseSchedule(body ?? {});
  }

  async disableHomeChargerSchedule(chargerId) {
    const { body } = await this.request('PUT', this.scheduleUrl(chargerId), { json: {} });
    return parseSchedule(body ?? {});
  }

  async setAmperageLimit(chargerId, amperage) {
    await this.request(
      'PUT',
      joinUrl(
        this.endpoints.hcpo_hcm_endpoint,
        `api/v1/configuration/chargers/${chargerId}/charge-amperage-limit`,
      ),
      { json: { chargeAmperageLimit: amperage } },
    );
  }

  async setLedBrightness(chargerId, level) {
    await this.request(
      'PUT',
      joinUrl(
        this.endpoints.hcpo_hcm_endpoint,
        `api/v1/configuration/chargers/${chargerId}/led-brightness`,
      ),
      { json: { ledBrightnessLevel: level } },
    );
  }

  async restartHomeCharger(chargerId) {
    await this.request('POST', this.chargerUrl(chargerId, '/restart'));
  }

  async getUserChargingStatus() {
    const { body } = await this.request('POST', joinUrl(this.endpoints.mapcache_endpoint, 'v2'), {
      json: { user_status: { mfhs: {} } },
    });
    return parseUserChargingStatus(body?.user_status);
  }

  async getChargingSession(sessionId) {
    const { body } = await this.request(
      'POST',
      joinUrl(this.endpoints.internal_api_gateway_endpoint, `driver-bff/v1/sessions/${sessionId}`),
      { json: { charging_status: { session_id: sessionId, mfhs: [] } } },
    );
    const status = body?.charging_status;
    if (!status || status.error || status.error_message) {
      throw new ChargePointError('Failed to get charging session data');
    }
    return parseChargingSession(sessionId, status);
  }

  async getStation(deviceId) {
    const url = new URL(joinUrl(this.endpoints.mapcache_endpoint, 'v3/station/info'));
    url.searchParams.set('deviceId', String(deviceId));
    url.searchParams.set('use_cache', 'false');
    const { body } = await this.request('GET', url.toString());
    return parseStation(body ?? {});
  }

  /** Stations inside a bounding box (clusters of a too-wide box are dropped). */
  async getNearbyStations({ swLat, swLon, neLat, neLon }) {
    const { body } = await this.request('POST', joinUrl(this.endpoints.mapcache_endpoint, 'v2'), {
      json: {
        user_id: this.userId,
        map_data: {
          sw_lon: swLon,
          ne_lat: neLat,
          ne_lon: neLon,
          sw_lat: swLat,
          screen_width: 2048,
          screen_height: 2048,
          waitlist: true,
          filter: {},
          mfhs: {},
        },
      },
    });
    return (body?.map_data?.stations ?? []).map(parseMapStation).filter((s) => s.deviceId);
  }

  /**
   * Send a start/stop command, then wait for the station to acknowledge it.
   * `onSent` is called once the command is accepted, before the confirmation
   * loop (callers with a short deadline answer there).
   */
  async sendSessionCommand(action, { deviceId, portNumber = 1, sessionId = 0 }, onSent) {
    const path = action === 'start' ? 'startsession' : 'stopSession';
    const request = { deviceId };
    if (action === 'stop') {
      request.portNumber = portNumber;
      request.sessionId = sessionId;
    }
    const { body } = await this.request(
      'POST',
      joinUrl(this.endpoints.accounts_endpoint, `v1/driver/station/${path}`),
      { json: request },
    );
    const ackId = body?.ackId;
    onSent?.();
    const ackUrl = joinUrl(this.endpoints.accounts_endpoint, 'v1/driver/station/session/ack');
    let lastError = `Session failed to ${action}`;
    for (let attempt = 1; attempt <= ACK_ATTEMPTS; attempt += 1) {
      const result = await this.request('POST', ackUrl, {
        json: { ackId, action: `${action}_session` },
        expectOk: false,
      });
      if (result.status === 200) {
        logger.info(`ChargePoint confirmed the ${action} command`);
        return;
      }
      lastError = result.body?.errorMessage ?? lastError;
      logger.debug(`${action} not confirmed yet (attempt ${attempt}/${ACK_ATTEMPTS})`);
      if (attempt < ACK_ATTEMPTS) {
        await this.sleep(ACK_INTERVAL_MS);
      }
    }
    throw new ChargePointError(lastError);
  }

  startSession(deviceId, onSent) {
    return this.sendSessionCommand('start', { deviceId }, onSent);
  }

  stopSession({ deviceId, outletNumber, sessionId }, onSent) {
    return this.sendSessionCommand(
      'stop',
      { deviceId, portNumber: outletNumber || 1, sessionId },
      onSent,
    );
  }
}
