import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDictation } from './useDictation';
import type {
  SpeechRecognitionLike,
  SpeechRecognitionResult,
  SpeechRecognitionResultList,
} from '../types/speech';

function alternative(text: string): SpeechRecognitionResult {
  const only = { transcript: text, confidence: 1 };
  return { length: 1, isFinal: true, item: () => only, 0: only };
}

/** An indexed, `item`-bearing list, which an array on its own is not. */
function resultList(results: SpeechRecognitionResult[]): SpeechRecognitionResultList {
  const list: SpeechRecognitionResultList = {
    length: results.length,
    item: (index) => {
      const result = results[index];
      if (result === undefined) throw new RangeError('no such result');
      return result;
    },
  };
  return Object.assign(list, { ...results });
}

/** Every constructed session lands here so a test can drive its callbacks. */
const sessions: FakeRecognition[] = [];

class FakeRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: SpeechRecognitionLike['onresult'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  started = 0;
  stopped = 0;
  aborted = 0;

  constructor() {
    sessions.push(this);
  }

  start() {
    this.started += 1;
  }

  stop() {
    this.stopped += 1;
  }

  abort() {
    this.aborted += 1;
  }

  /** The shape `onresult` reads: results[0][0].transcript. */
  emit(transcript: string) {
    this.onresult?.({ results: resultList([alternative(transcript)]) });
  }
}

function stub() {
  sessions.length = 0;
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
}

function latest(): FakeRecognition {
  const session = sessions.at(-1);
  if (session === undefined) throw new Error('no session was started');
  return session;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDictation', () => {
  it('is unsupported when the browser has neither spelling of the API', () => {
    const { result } = renderHook(() => useDictation({ lang: 'sv-SE', onResult: () => {} }));
    expect(result.current.supported).toBe(false);
  });

  it('finds the webkit-prefixed constructor, which is where it usually is', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const { result } = renderHook(() => useDictation({ lang: 'sv-SE', onResult: () => {} }));
    expect(result.current.supported).toBe(true);
  });

  it('starts one short session in the asked-for language', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'sv-SE', onResult: () => {} }));

    act(() => {
      result.current.start();
    });

    expect(latest()).toMatchObject({
      lang: 'sv-SE',
      continuous: false,
      interimResults: false,
      started: 1,
    });
    expect(result.current.listening).toBe(true);
  });

  it('hands the transcript over and settles when the session ends', () => {
    stub();
    const onResult = vi.fn();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult }));

    act(() => {
      result.current.start();
    });
    act(() => {
      latest().emit('dog');
      latest().onend?.();
    });

    expect(onResult).toHaveBeenCalledWith('dog');
    expect(result.current.listening).toBe(false);
  });

  it('ignores a result event that carries nothing', () => {
    stub();
    const onResult = vi.fn();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult }));

    act(() => {
      result.current.start();
    });
    act(() => {
      latest().onresult?.({ results: resultList([]) });
    });

    expect(onResult).not.toHaveBeenCalled();
  });

  it('calls whatever handler is current, not the one from the first render', () => {
    stub();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onResult }: { onResult: (t: string) => void }) =>
        useDictation({ lang: 'en-US', onResult }),
      { initialProps: { onResult: first } },
    );

    act(() => {
      result.current.start();
    });
    rerender({ onResult: second });
    act(() => {
      latest().emit('dog');
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('dog');
  });

  it('reports a real failure but says nothing about silence', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult: () => {} }));

    act(() => {
      result.current.start();
    });
    act(() => {
      latest().onerror?.({ error: 'no-speech' });
    });
    expect(result.current.error).toBeNull();

    act(() => {
      latest().onerror?.({ error: 'aborted' });
    });
    expect(result.current.error).toBeNull();

    act(() => {
      latest().onerror?.({ error: 'not-allowed' });
    });
    expect(result.current.error).toBe('not-allowed');
  });

  it('retires the button when the platform has no service behind the API', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult: () => {} }));
    expect(result.current.supported).toBe(true);

    act(() => {
      result.current.start();
    });
    act(() => {
      latest().onerror?.({ error: 'network' });
    });

    // No message: the learner cannot act on it, and it would return per card.
    expect(result.current.error).toBeNull();
    expect(result.current.supported).toBe(false);
  });

  it('retires the button when the service refuses outright', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult: () => {} }));

    act(() => {
      result.current.start();
    });
    act(() => {
      latest().onerror?.({ error: 'service-not-allowed' });
    });

    expect(result.current.supported).toBe(false);
  });

  it('keeps the button for a failure the learner can fix', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult: () => {} }));

    act(() => {
      result.current.start();
    });
    act(() => {
      latest().onerror?.({ error: 'not-allowed' });
    });

    expect(result.current.supported).toBe(true);
    expect(result.current.error).toBe('not-allowed');
  });

  it('clears the last failure when the learner tries again', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult: () => {} }));

    act(() => {
      result.current.start();
    });
    act(() => {
      latest().onerror?.({ error: 'not-allowed' });
    });
    expect(result.current.error).toBe('not-allowed');

    act(() => {
      result.current.start();
    });
    expect(result.current.error).toBeNull();
  });

  it('aborts the session in flight rather than stacking a second one', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult: () => {} }));

    act(() => {
      result.current.start();
    });
    const first = latest();
    act(() => {
      result.current.start();
    });

    expect(first.aborted).toBe(1);
    expect(sessions).toHaveLength(2);
  });

  it('stops the session on request', () => {
    stub();
    const { result } = renderHook(() => useDictation({ lang: 'en-US', onResult: () => {} }));

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.stop();
    });

    expect(latest().stopped).toBe(1);
  });

  it('never leaves the microphone open past the screen', () => {
    stub();
    const { result, unmount } = renderHook(() =>
      useDictation({ lang: 'en-US', onResult: () => {} }),
    );

    act(() => {
      result.current.start();
    });
    unmount();

    expect(latest().aborted).toBe(1);
  });
});
