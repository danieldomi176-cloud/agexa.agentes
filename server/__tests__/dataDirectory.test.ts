import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readConfig, writeConfig } from '../src/configPersistence.js';
import { getDataDirectory } from '../src/dataDirectory.js';
import { readLayoutFromFile, writeLayoutToFile } from '../src/layoutPersistence.js';
import { loadOrCreateStandaloneToken } from '../src/serverToken.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-state-'));
  vi.stubEnv('AGEXA_DATA_DIR', path.join(root, 'state'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Agexa state persistence', () => {
  it('keeps configuration, layout and a stable private token in the configured directory', () => {
    const config = readConfig();
    config.standalone.soundEnabled = false;
    expect(writeConfig(config)).toBe(true);
    expect(readConfig().standalone.soundEnabled).toBe(false);
    writeLayoutToFile({ version: 1, furniture: [] });
    expect(readLayoutFromFile()).toMatchObject({ version: 1, furniture: [] });
    const token = loadOrCreateStandaloneToken();
    expect(loadOrCreateStandaloneToken()).toBe(token);
    const tokenFile = path.join(getDataDirectory(), 'standalone-token');
    expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(getDataDirectory(), 'config.json'))).toBe(true);
  });

  it('rejects relative state directories', () => {
    vi.stubEnv('AGEXA_DATA_DIR', 'relative-state');
    expect(() => getDataDirectory()).toThrow('must be absolute');
  });

  it('preserves the upstream default when no override is configured', () => {
    vi.stubEnv('AGEXA_DATA_DIR', '');
    expect(getDataDirectory()).toBe(path.join(os.homedir(), '.pixel-agents'));
  });
});
