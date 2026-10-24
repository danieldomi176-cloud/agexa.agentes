import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface Base44Secret {
  status: 'missing' | 'ready' | 'invalid';
  value: string;
}
/** Raw HMAC key only. Proxy credential placeholders cannot replace local signing material. */
export function readBase44Secret(env = process.env): Base44Secret {
  const raw = env.AGEXA_BASE44_EVENT_SECRET;
  const file = env.AGEXA_BASE44_EVENT_SECRET_FILE;
  const invalid: Base44Secret = { status: 'invalid', value: '' };
  if (!raw && !file) return { status: 'missing', value: '' };
  if (raw && file) return invalid;
  const validate = (value: string): Base44Secret =>
    value.length >= 32 && Buffer.byteLength(value) <= 4096 && !/[\r\n\0]/.test(value)
      ? { status: 'ready', value }
      : invalid;
  if (raw) return validate(raw);
  if (!file || !isAbsolute(file)) return invalid;
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 4096 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      return invalid;
    const bytes = Buffer.alloc(4097);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    // Exact bytes: no trimming, newline stripping or accidental key transformation.
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    return validate(value);
  } catch {
    return invalid;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
