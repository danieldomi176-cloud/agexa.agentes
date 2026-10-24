import * as os from 'os';
import * as path from 'path';

/** Keep application state outside source control; preserve upstream defaults. */
export function getDataDirectory(): string {
  const configured = process.env.AGEXA_DATA_DIR;
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error('AGEXA_DATA_DIR must be absolute');
    return configured;
  }
  return path.join(os.homedir(), '.pixel-agents');
}
