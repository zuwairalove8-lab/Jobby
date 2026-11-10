import { describe, expect, it } from 'vitest';
import { validateHttpsUrl } from './url';

describe('validateHttpsUrl', () => {
  it('accepts a normal https endpoint', () => {
    const result = validateHttpsUrl('https://mcp.example.com/tools');
    expect(result.ok).toBe(true);
    expect(result.url?.hostname).toBe('mcp.example.com');
  });

  it('rejects http', () => {
    expect(validateHttpsUrl('http://mcp.example.com').ok).toBe(false);
  });

  it('rejects loopback and private ranges', () => {
    expect(validateHttpsUrl('https://127.0.0.1/x').ok).toBe(false);
    expect(validateHttpsUrl('https://10.1.2.3/x').ok).toBe(false);
    expect(validateHttpsUrl('https://192.168.0.10/x').ok).toBe(false);
    expect(validateHttpsUrl('https://172.16.4.4/x').ok).toBe(false);
  });

  it('rejects the cloud metadata address', () => {
    expect(validateHttpsUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(validateHttpsUrl('https://metadata.google.internal/x').ok).toBe(false);
  });

  it('rejects embedded credentials and local hostnames', () => {
    expect(validateHttpsUrl('https://user:pass@example.com').ok).toBe(false);
    expect(validateHttpsUrl('https://service.localhost/x').ok).toBe(false);
  });

  it('rejects garbage', () => {
    expect(validateHttpsUrl('').ok).toBe(false);
    expect(validateHttpsUrl('nope').ok).toBe(false);
  });
});
