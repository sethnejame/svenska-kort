import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechRecognitionConstructor, SpeechRecognitionLike } from '../types/speech';

function constructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * Errors that mean the platform has no working recognition service at all,
 * rather than that this one attempt went wrong. Chromium ships the constructor
 * everywhere but routes the audio to a speech service it can only reach in
 * official Google builds, so unofficial builds, Electron and most Linux
 * Chromium packages answer every single attempt with `network`.
 */
const UNAVAILABLE_ERRORS = new Set(['network', 'service-not-allowed']);

export interface Dictation {
  /**
   * False in every browser without the draft API, which is most of them, and
   * false once the API has proved it has nothing behind it.
   */
  supported: boolean;
  listening: boolean;
  /** Null until something goes wrong, and cleared by the next attempt. */
  error: string | null;
  start: () => void;
  stop: () => void;
}

export interface DictationOptions {
  /** BCP-47, so `en-US` to answer in English and `sv-SE` to answer in Swedish. */
  lang: string;
  onResult: (transcript: string) => void;
}

/**
 * Answering out loud. `SpeechRecognition` is a draft API, prefixed where it
 * exists at all, so the button that drives this hook is hidden outright when
 * `supported` is false rather than shown broken.
 */
export function useDictation({ lang, onResult }: DictationOptions): Dictation {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // Held in a ref so changing the handler does not have to tear down a session
  // the learner is in the middle of.
  const handler = useRef(onResult);
  handler.current = onResult;

  const supported = constructor() !== undefined && !unavailable;

  // A session left running past the card, or past the screen, would keep the
  // microphone open and eventually deliver a transcript to nothing.
  useEffect(() => {
    return () => {
      recognition.current?.abort();
      recognition.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Recognition = constructor();
    if (Recognition === undefined) return;

    recognition.current?.abort();
    setError(null);

    const session = new Recognition();
    session.lang = lang;
    session.continuous = false;
    session.interimResults = false;
    session.maxAlternatives = 1;

    session.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript !== undefined) handler.current(transcript);
    };

    session.onerror = (event) => {
      // `no-speech` is someone pressing the button and thinking; it is not
      // worth a message, and the end event tidies up either way.
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      // Retiring the button beats an error the learner can do nothing about:
      // this failure is the platform's, it will repeat on every card, and
      // typing was always the answer path anyway.
      if (UNAVAILABLE_ERRORS.has(event.error)) {
        setUnavailable(true);
        return;
      }

      setError(event.error);
    };

    session.onend = () => {
      setListening(false);
      recognition.current = null;
    };

    recognition.current = session;
    session.start();
    setListening(true);
  }, [lang]);

  return { supported, listening, error, start, stop };
}
