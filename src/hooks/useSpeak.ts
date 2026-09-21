import { useCallback, useEffect, useState } from 'react';

/** The Swedish the app asks for. A voice for it is not guaranteed to exist. */
const LANG = 'sv-SE';

/**
 * Slightly under natural pace. A learner is matching what they hear against a
 * spelling they half know, and full speed gives them no time to do it.
 */
const RATE = 0.9;

function synthesis(): SpeechSynthesis | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.speechSynthesis;
}

/**
 * Picks a Swedish voice, or nothing. Every platform names and orders its voices
 * differently, so the language tag is the only thing worth matching on.
 */
function swedishVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return voices.find((voice) => voice.lang.replace('_', '-').toLowerCase().startsWith('sv'));
}

export interface Speaker {
  /** False when the browser has no speech synthesis, or no Swedish voice in it. */
  supported: boolean;
  speak: (text: string) => void;
}

/**
 * Reads Swedish aloud. Lives here rather than in `src/lib/` because it is all
 * DOM: `speechSynthesis` is a browser global with no pure part to extract.
 */
export function useSpeak(): Speaker {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>(undefined);

  useEffect(() => {
    const speech = synthesis();
    if (speech === undefined) return;

    // Chromium loads voices asynchronously and answers the first call with an
    // empty list, so the event is the only reliable way in. Firefox fires no
    // event but answers immediately, hence both.
    const read = () => {
      setVoice(swedishVoice(speech.getVoices()));
    };

    read();
    speech.addEventListener('voiceschanged', read);
    return () => {
      speech.removeEventListener('voiceschanged', read);
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      const speech = synthesis();
      if (speech === undefined || voice === undefined) return;

      // A second tap replaces the first rather than queueing behind it.
      speech.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = LANG;
      utterance.rate = RATE;
      speech.speak(utterance);
    },
    [voice],
  );

  return { supported: voice !== undefined, speak };
}
