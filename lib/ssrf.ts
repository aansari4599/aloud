import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { resolve, sep } from 'node:path';
import { PATCHED_DIR } from './constants';
import { AppError } from './errors';

// file:// is only ever allowed for our own fixtures and patched copies (ARCHITECTURE §10),
// and only when the caller explicitly opts in — never for user-supplied URLs.
const ALLOWED_FILE_ROOTS = [resolve(process.cwd(), 'fixtures'), resolve(PATCHED_DIR)];

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, incl. metadata 169.254.169.254
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  )
    return true; // link-local fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
  if (lower.startsWith('::ffff:')) return isPrivateV4(lower.slice('::ffff:'.length)); // mapped v4
  return false;
}

function isPrivateIp(ip: string): boolean {
  return isIP(ip) === 4 ? isPrivateV4(ip) : isPrivateV6(ip);
}

export interface SsrfOptions {
  /** Allow file:// under fixtures/ or PATCHED_DIR. Internal callers only — never user input. */
  allowFile?: boolean;
}

/**
 * Validates a URL before any navigation (ARCHITECTURE §10). Resolves DNS and rejects
 * loopback/private/link-local/metadata targets. Throws AppError; returns the sanitized
 * URL with credentials stripped.
 */
export async function ssrfGuard(rawUrl: string, opts: SsrfOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError('UNREACHABLE', `Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol === 'file:') {
    if (!opts.allowFile) {
      throw new AppError('BLOCKED_PRIVATE_NETWORK', 'file:// URLs are not allowed');
    }
    const path = resolve(decodeURIComponent(url.pathname));
    const allowed = ALLOWED_FILE_ROOTS.some((root) => path === root || path.startsWith(root + sep));
    if (!allowed) {
      throw new AppError('BLOCKED_PRIVATE_NETWORK', 'file:// path outside allowed roots');
    }
    return url;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('BLOCKED_PRIVATE_NETWORK', `Scheme not allowed: ${url.protocol}`);
  }

  url.username = '';
  url.password = '';

  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // unbracket IPv6
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new AppError('BLOCKED_PRIVATE_NETWORK', 'localhost is not allowed');
  }

  let addresses: string[];
  if (isIP(hostname) !== 0) {
    addresses = [hostname];
  } else {
    try {
      const records = await lookup(hostname, { all: true });
      addresses = records.map((r) => r.address);
    } catch {
      throw new AppError('UNREACHABLE', `DNS lookup failed for ${hostname}`);
    }
  }

  if (addresses.length === 0) {
    throw new AppError('UNREACHABLE', `No addresses resolved for ${hostname}`);
  }
  if (addresses.some(isPrivateIp)) {
    throw new AppError('BLOCKED_PRIVATE_NETWORK', `${hostname} resolves to a private address`);
  }

  return url;
}
