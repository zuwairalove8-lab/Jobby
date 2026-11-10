/**
 * Optional voice input via the Web Speech API. It is browser-dependent, so the
 * composer only renders the microphone when a real implementation exists.
 */

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && ctor() !== null;
}

export function startDictation(
  onResult: (text: string) => void,
  onError: (message: string) => void,
): (() => void) | null {
  const Recognition = ctor();
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result?.isFinal) transcript += result[0]?.transcript ?? '';
    }
    if (transcript.trim()) onResult(transcript.trim());
  };

  recognition.onerror = (event) => {
    onError(
      event.error === 'not-allowed'
        ? 'Microphone permission was denied.'
        : `Dictation error: ${event.error ?? 'unknown'}.`,
    );
  };

  try {
    recognition.start();
  } catch {
    onError('Dictation could not start.');
    return null;
  }

  return () => {
    try {
      recognition.abort();
    } catch {
      /* already stopped */
    }
  };
}
