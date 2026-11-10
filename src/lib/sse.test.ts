import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse';

type Ev = { type: string; text?: string };

describe('createSseParser', () => {
  it('parses events split across chunk boundaries', () => {
    const events: Ev[] = [];
    const parser = createSseParser<Ev>((e) => events.push(e));

    parser.push('data: {"type":"delt');
    parser.push('a","text":"Hel"}\n\ndata: {"type":"delta","text":"lo"}\n\n');

    expect(events).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
    ]);
  });

  it('handles CRLF separators and ignores [DONE]', () => {
    const events: Ev[] = [];
    const parser = createSseParser<Ev>((e) => events.push(e));
    parser.push('data: {"type":"done"}\r\n\r\ndata: [DONE]\r\n\r\n');
    expect(events).toHaveLength(1);
  });

  it('ignores comments and malformed payloads', () => {
    const events: Ev[] = [];
    const parser = createSseParser<Ev>((e) => events.push(e));
    parser.push(': keep-alive\n\ndata: not-json\n\ndata: {"type":"ok"}\n\n');
    expect(events).toEqual([{ type: 'ok' }]);
  });

  it('flushes a trailing block', () => {
    const events: Ev[] = [];
    const parser = createSseParser<Ev>((e) => events.push(e));
    parser.push('data: {"type":"tail"}');
    parser.flush();
    expect(events).toEqual([{ type: 'tail' }]);
  });
});
