// -----------------------------------------------------------------------------
// Persistence of the ChargePoint session token.
//
// ChargePoint renews the `coulomb_sess` cookie on every response. Keeping the
// freshest one on disk lets the integration restart without a new password
// login (each login risks a Datadome captcha). The container rootfs is
// read-only: /data is the only writable volume. The file is written with
// owner-only permissions and its content is never logged.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'token-store' });

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
const FILE_NAME = 'chargepoint-session.json';

export function createTokenStore(dataDir = DEFAULT_DATA_DIR) {
  const file = path.join(dataDir, FILE_NAME);

  return {
    /** @returns {Promise<{ username: string, token: string } | null>} */
    async read() {
      try {
        const content = JSON.parse(await readFile(file, 'utf8'));
        if (typeof content?.username === 'string' && typeof content?.token === 'string') {
          return { username: content.username, token: content.token };
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Cannot read the stored session (${err.code ?? err.name})`);
        }
      }
      return null;
    },

    async write(username, token) {
      try {
        await mkdir(dataDir, { recursive: true });
        // Write then rename: a crash never leaves a half-written file.
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify({ username, token }), { mode: 0o600 });
        await rename(tmp, file);
      } catch (err) {
        logger.warn(`Cannot store the session (${err.code ?? err.name})`);
      }
    },

    async clear() {
      await this.write('', '');
    },
  };
}
