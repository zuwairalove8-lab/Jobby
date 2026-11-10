/**
 * Incremental Server-Sent-Events parser.
 *
 * Chunks can split anywhere (including inside a JSON payload), so the parser
 * buffers until a full `data:` block arrives. Used by the chat stream.
 */
export interface SseParser {
  push(chunk: string): void;
  flush(): void;
}

export function createSseParser<T>(onEvent: (event: T) => void): SseParser {
  let buffer = '';

  const dispatch = (rawBlock: string) => {
    const dataLines = rawBlock
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));

    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') return;

    try {
      onEvent(JSON.parse(payload) as T);
    } catch {
      // Non-JSON keep-alive or comment — ignore rather than break the stream.
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const matchLength = buffer.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2;
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + matchLength);
        dispatch(block);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    },
    flush() {
      if (buffer.trim()) dispatch(buffer);
      buffer = '';
    },
  };
}
