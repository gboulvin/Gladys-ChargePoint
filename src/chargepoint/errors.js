// -----------------------------------------------------------------------------
// Errors raised by the ChargePoint client, mirroring python-chargepoint so the
// behavior stays comparable with the Home Assistant integration.
// -----------------------------------------------------------------------------

/** Any failed exchange with the ChargePoint API (network, 5xx, refused command). */
export class ChargePointError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ChargePointError';
    this.status = status;
    this.body = body;
  }
}

/** The e-mail / password pair was refused. */
export class LoginError extends ChargePointError {
  constructor(message, options) {
    super(message, options);
    this.name = 'LoginError';
  }
}

/** The session token (coulomb_sess cookie) expired or was revoked: HTTP 401. */
export class InvalidSessionError extends ChargePointError {
  constructor(message, options) {
    super(message, options);
    this.name = 'InvalidSessionError';
  }
}

/** The Datadome bot protection asks for a captcha: HTTP 403 with a captcha URL. */
export class CaptchaError extends ChargePointError {
  constructor(message, captchaUrl) {
    super(message, { status: 403 });
    this.name = 'CaptchaError';
    this.captchaUrl = captchaUrl;
  }
}

/** No credentials at all in the configuration. */
export class MissingCredentialsError extends Error {
  constructor() {
    super('No ChargePoint credentials configured');
    this.name = 'MissingCredentialsError';
  }
}

/** Errors that only a user action (new password / token) can fix. */
export function isAuthError(err) {
  return (
    err instanceof LoginError ||
    err instanceof InvalidSessionError ||
    err instanceof CaptchaError ||
    err instanceof MissingCredentialsError
  );
}
