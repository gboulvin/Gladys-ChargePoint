// -----------------------------------------------------------------------------
// An in-memory ChargePoint cloud, for the tests: a `fetch` replacement that
// answers the endpoints the client calls, with payloads shaped like the real
// API (camelCase for the account/home charger APIs, snake_case for the session
// API). Tests never touch the network.
// -----------------------------------------------------------------------------

const BASE = {
  accounts: 'https://account.test/account/',
  hcpo: 'https://hcpo.test/',
  mapcache: 'https://mc.test/map-prod/',
  gateway: 'https://gw.test/',
  sso: 'https://sso.test/api/',
};

export const CHARGER_ID = 4242;
export const USER_ID = 1001;
export const STATION_ID = 777;

export function createChargePointState(overrides = {}) {
  return {
    password: 'secret',
    validTokens: new Set(['good-token']),
    issuedToken: 'fresh-token',
    renewToken: null, // when set, every response renews the cookie to it
    captchaOnLogin: false,
    failStatus: false,
    failSession: false,
    charger: {
      brand: 'CP',
      model: 'CPH50-NEMA6-50-L23',
      chargingStatus: 'AVAILABLE',
      isPluggedIn: false,
      isConnected: true,
      isDuringScheduledTime: false,
      chargeAmperageSettings: { chargeLimit: 32, possibleChargeLimit: [16, 24, 32, 40, 48] },
    },
    chargerConfig: {
      settings: {
        stationNickname: 'Garage',
        led: { brightness: { level: 3, supportedLevels: [0, 1, 2, 3, 4, 5], isEnabled: true } },
      },
    },
    schedule: {
      scheduleEnabled: false,
      defaultSchedule: {
        weekdays: { startTime: '23:00', endTime: '07:00' },
        weekends: { startTime: '23:00', endTime: '07:00' },
      },
      userSchedule: null,
    },
    session: null, // { sessionId, deviceId, ... } in snake_case API shape when charging
    station: {
      deviceId: STATION_ID,
      name: ['Town Hall', 'Lot 2'],
      address: { address1: '1 Main St', city: 'Springfield' },
      stationStatusV2: 'in_use',
      portsInfo: {
        ports: [
          { outletNumber: 1, statusV2: 'in_use', displayLevel: 'L2' },
          { outletNumber: 2, statusV2: 'in_use', displayLevel: 'L2' },
        ],
        portCount: 2,
      },
    },
    calls: [],
    ackAttemptsBeforeOk: 1,
    ...overrides,
  };
}

function json(body, { status = 200, cookie } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie) {
    headers.append(
      'set-cookie',
      `coulomb_sess=${encodeURIComponent(cookie)}; Path=/; Max-Age=7200`,
    );
  }
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });
}

function tokenOf(init) {
  const match = /coulomb_sess=([^;]+)/.exec(init?.headers?.cookie ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}

/** A `fetch` answering like the ChargePoint cloud, over `state`. */
export function createFakeFetch(state) {
  let ackAttempts = 0;
  return async function fakeFetch(url, init = {}) {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const { pathname } = new URL(url);
    state.calls.push({ method, url, body });

    if (url.startsWith('https://discovery.chargepoint.com')) {
      return json({
        region: 'NA-US',
        currency: { code: 'USD', symbol: '$' },
        endPoints: {
          accounts_endpoint: { value: BASE.accounts },
          hcpo_hcm_endpoint: { value: BASE.hcpo },
          mapcache_endpoint: { value: BASE.mapcache },
          internal_api_gateway_endpoint: { value: BASE.gateway },
          sso_endpoint: { value: BASE.sso },
        },
      });
    }

    if (url === `${BASE.sso}v1/user/login`) {
      if (state.captchaOnLogin) {
        return json({ url: 'https://captcha.test/challenge' }, { status: 403 });
      }
      if (body.password !== state.password) {
        return json({ errorMessage: 'bad credentials' }, { status: 401 });
      }
      state.validTokens.add(state.issuedToken);
      return json({}, { cookie: state.issuedToken });
    }

    const token = tokenOf(init);
    if (!token || !state.validTokens.has(token)) {
      return json({ error: 'unauthorized' }, { status: 401 });
    }
    const cookie = state.renewToken ?? undefined;
    if (cookie) state.validTokens.add(cookie);
    const ok = (payload) => json(payload, { cookie });

    if (pathname === '/account/v1/driver/profile/user') {
      return ok({
        user: { userId: USER_ID, username: 'driver@example.com', fullName: 'Driver' },
        accountBalance: { accountNumber: 'A1', balance: { amount: '12.5', currency: 'USD' } },
      });
    }
    if (pathname === `/api/v1/configuration/users/${USER_ID}/chargers`) {
      return ok({ data: [{ id: String(CHARGER_ID) }] });
    }
    const chargerBase = `/api/v1/configuration/users/${USER_ID}/chargers/${CHARGER_ID}`;
    if (pathname === `${chargerBase}/status`) {
      if (state.failStatus) return json({ error: 'boom' }, { status: 500 });
      return ok(state.charger);
    }
    if (pathname === `${chargerBase}/technical-info`) {
      return ok({ serialNumber: 'SN1', softwareVersion: '5.5.1', modelNumber: 'CPH50' });
    }
    if (pathname === `${chargerBase}/configurations`) {
      return ok(state.chargerConfig);
    }
    if (pathname === `${chargerBase}/restart` && method === 'POST') {
      state.restarted = true;
      return ok({});
    }
    if (pathname === `/api/v1/schedule/charger/${CHARGER_ID}/schedule`) {
      if (method === 'PUT') {
        state.schedule = {
          ...state.schedule,
          scheduleEnabled: Boolean(body.schedule),
          userSchedule: body.schedule ?? state.schedule.userSchedule,
        };
      }
      return ok(state.schedule);
    }
    if (pathname === `/api/v1/configuration/chargers/${CHARGER_ID}/charge-amperage-limit`) {
      state.charger.chargeAmperageSettings.chargeLimit = body.chargeAmperageLimit;
      return ok({});
    }
    if (pathname === `/api/v1/configuration/chargers/${CHARGER_ID}/led-brightness`) {
      state.chargerConfig.settings.led.brightness.level = body.ledBrightnessLevel;
      return ok({});
    }
    if (pathname === '/map-prod/v2' && body.user_status) {
      if (!state.session) return ok({ user_status: {} });
      return ok({
        user_status: {
          charging: {
            sessionId: state.session.session_id,
            state: 'in_use',
            stations: [{ deviceId: state.session.device_id }],
          },
        },
      });
    }
    if (pathname === '/map-prod/v2' && body.map_data) {
      return ok({
        map_data: {
          stations: [
            { device_id: STATION_ID, name1: 'Town Hall', address1: '1 Main St', lat: 1, lon: 2 },
            { device_id: CHARGER_ID, name1: 'Garage', is_home: true },
          ],
        },
      });
    }
    if (pathname.startsWith('/driver-bff/v1/sessions/')) {
      if (state.failSession || !state.session) return json({}, { status: 500 });
      return ok({ charging_status: state.session });
    }
    if (pathname === '/map-prod/v3/station/info') {
      return ok(state.station);
    }
    if (pathname === '/account/v1/driver/station/startsession') {
      ackAttempts = 0;
      state.startedOn = body.deviceId;
      return ok({ ackId: 99 });
    }
    if (pathname === '/account/v1/driver/station/stopSession') {
      ackAttempts = 0;
      state.stopped = body;
      return ok({ ackId: 98 });
    }
    if (pathname === '/account/v1/driver/station/session/ack') {
      ackAttempts += 1;
      if (ackAttempts >= state.ackAttemptsBeforeOk) return ok({});
      return json({ errorMessage: 'pending' }, { status: 400 });
    }
    return json({ error: `unhandled ${method} ${pathname}` }, { status: 404 });
  };
}

/** A charging session at the home charger, in the session API shape. */
export function homeSession(overrides = {}) {
  return {
    session_id: 555,
    device_id: CHARGER_ID,
    device_name: 'Garage',
    current_charging: 'in_use',
    charging_time: 3600,
    energy_kwh: 7.25,
    power_kw: 7.2,
    total_amount: 1.5,
    currency_iso_code: 'USD',
    outlet_number: 1,
    is_home_charger: true,
    start_time: 1_700_000_000_000,
    ...overrides,
  };
}

/** An in-memory token store. */
export function createMemoryStore(initial = null) {
  const store = {
    value: initial,
    async read() {
      return store.value;
    },
    async write(username, token) {
      store.value = { username, token };
    },
  };
  return store;
}

export const noSleep = async () => {};
