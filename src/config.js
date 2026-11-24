// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  coulomb_token: '',
  // Seconds between two refreshes of the ChargePoint data (one minute minimum:
  // ChargePoint rate-limits aggressive clients, three minutes is what
  // ha-chargepoint uses by default).
  poll_frequency: 180,
  // Comma-separated device ids of public stations to follow.
  public_stations: '',
};

export const MIN_POLL_FREQUENCY = 60;
export const MAX_POLL_FREQUENCY = 3600;

/**
 * Parse the public station ids typed by the user: "12345, 67890" or one per
 * line. Unknown characters are ignored, duplicates dropped.
 * @param {unknown} raw
 * @returns {number[]}
 */
export function parseStationIds(raw) {
  const values = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/);
  const ids = values
    .map((value) => Number.parseInt(String(value).trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(ids)];
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pollFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    coulomb_token: String(raw.coulomb_token ?? '').trim(),
    poll_frequency: Number.isFinite(pollFrequency)
      ? Math.min(MAX_POLL_FREQUENCY, Math.max(MIN_POLL_FREQUENCY, pollFrequency))
      : DEFAULT_CONFIG.poll_frequency,
    public_stations: String(raw.public_stations ?? ''),
    publicStationIds: parseStationIds(raw.public_stations),
  };
}
