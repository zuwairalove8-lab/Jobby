/**
 * Remote-endpoint validation shared by the MCP marketplace and the browser
 * module. The edge functions enforce the same rules server-side; this copy
 * exists so the UI can fail fast with a clear message.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const PRIVATE_V4 = [
  { cidr: [10, 0, 0, 0], bits: 8 },
  { cidr: [127, 0, 0, 0], bits: 8 },
  { cidr: [169, 254, 0, 0], bits: 16 },
  { cidr: [172, 16, 0, 0], bits: 12 },
  { cidr: [192, 168, 0, 0], bits: 16 },
  { cidr: [0, 0, 0, 0], bits: 8 },
  { cidr: [100, 64, 0, 0], bits: 10 },
];

function ipv4ToInt(parts: number[]): number {
  return (
    (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>>
    0
  );
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p) || p > 255)) return true;
  const value = ipv4ToInt(parts);
  return PRIVATE_V4.some(({ cidr, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(cidr) & mask);
  });
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv4-mapped addresses: ::ffff:127.0.0.1
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return false;
}

export interface UrlValidation {
  ok: boolean;
  error?: string;
  url?: URL;
}

export function validateHttpsUrl(input: string): UrlValidation {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a URL.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only https:// endpoints are allowed.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Credentials in the URL are not allowed — use the auth fields.' };
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, error: 'Local and cloud-metadata hosts are blocked.' };
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, error: 'Private-network hostnames are blocked.' };
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { ok: false, error: 'Private, loopback and link-local addresses are blocked.' };
  }
  if (host.endsWith('.local') || /^(0|127|169\.254)\./.test(host)) {
    return { ok: false, error: 'Private addresses are blocked.' };
  }

  return { ok: true, url };
}
