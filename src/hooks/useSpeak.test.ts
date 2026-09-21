import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSpeak } from './useSpeak';

/** jsdom implements neither half of the speech API, so both are stood up here. */
class FakeSynthesis extends EventTarget {
  voices: { lang: string; name: string }[] = [];
  spoken: { text: string; lang: string; rate: number; voice: unknown }[] = [];
  cancelled = 0;

  getVoices() {
    return this.voices;
  }

  cancel() {
    this.cancelled += 1;
  }

  speak(utterance: { text: string; lang: string; rate: number; voice: unknown }) {
    this.spoken.push(utterance);
  }
}

class FakeUtterance {
  lang = '';
  rate = 1;
  voice: unknown = null;
  constructor(public text: string) {}
}

function stub(voices: { lang: string; name: string }[]): FakeSynthesis {
  const speech = new FakeSynthesis();
  speech.voices = voices;
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return speech;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSpeak', () => {
  it('is unsupported when no voice speaks Swedish', () => {
    stub([{ lang: 'en-US', name: 'Alex' }]);
    const { result } = renderHook(() => useSpeak());
    expect(result.current.supported).toBe(false);
  });

  it('accepts an underscored tag, which some platforms still ship', () => {
    stub([{ lang: 'sv_SE', name: 'Alva' }]);
    const { result } = renderHook(() => useSpeak());
    expect(result.current.supported).toBe(true);
  });

  it('picks up voices that only arrive with the voiceschanged event', () => {
    const speech = stub([]);
    const { result } = renderHook(() => useSpeak());
    expect(result.current.supported).toBe(false);

    speech.voices = [{ lang: 'sv-SE', name: 'Alva' }];
    act(() => {
      speech.dispatchEvent(new Event('voiceschanged'));
    });

    expect(result.current.supported).toBe(true);
  });

  it('speaks Swedish slowly, cancelling whatever was already running', () => {
    const speech = stub([
      { lang: 'en-US', name: 'Alex' },
      { lang: 'sv-SE', name: 'Alva' },
    ]);
    const { result } = renderHook(() => useSpeak());

    act(() => {
      result.current.speak('hund');
    });

    expect(speech.cancelled).toBe(1);
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0]).toMatchObject({
      text: 'hund',
      lang: 'sv-SE',
      rate: 0.9,
      voice: { name: 'Alva' },
    });
  });

  it('stays silent rather than reading Swedish in an English voice', () => {
    const speech = stub([{ lang: 'en-US', name: 'Alex' }]);
    const { result } = renderHook(() => useSpeak());

    act(() => {
      result.current.speak('hund');
    });

    expect(speech.spoken).toHaveLength(0);
  });

  it('stops listening for voices once the screen is gone', () => {
    const speech = stub([]);
    const remove = vi.spyOn(speech, 'removeEventListener');
    const { unmount } = renderHook(() => useSpeak());

    unmount();
    expect(remove).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
  });
});
