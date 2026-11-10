import type { ApplicationStatus } from '../types';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [3600, 'minute'],
    [86_400, 'hour'],
    [604_800, 'day'],
    [2_592_000, 'week'],
    [31_536_000, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  const divisors: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86_400,
    week: 604_800,
    month: 2_592_000,
    year: 31_536_000,
  };
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [limit, unit] of units) {
    if (seconds < limit) {
      return fmt.format(-Math.round(seconds / (divisors[unit] ?? 1)), unit);
    }
  }
  return '—';
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function initials(name: string | null | undefined, fallback = 'JB'): string {
  const clean = (name ?? '').trim();
  if (!clean) return fallback;
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusTone(status: ApplicationStatus): string {
  switch (status) {
    case 'discovered':
      return 'text-muted border-line bg-raised/60';
    case 'saved':
      return 'text-cyan border-cyan/30 bg-cyan/10';
    case 'reviewing':
      return 'text-violet border-violet/30 bg-violet/10';
    case 'ready':
      return 'text-warn border-warn/30 bg-warn/10';
    case 'submitted':
      return 'text-cyan border-cyan/40 bg-cyan/15';
    case 'interview':
      return 'text-warn border-warn/40 bg-warn/15';
    case 'accepted':
      return 'text-good border-good/40 bg-good/10';
    case 'rejected':
      return 'text-bad border-bad/40 bg-bad/10';
    default:
      return 'text-muted border-line';
  }
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return '—';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
