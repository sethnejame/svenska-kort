import { describe, expect, it } from 'vitest';
import type { WordEntry } from '../types/word';
import { checkAnswer, collectAllAnswers } from './checkAnswer';

function entry(english: string[], overrides: Partial<WordEntry> = {}): WordEntry {
  return { id: 'fixture-other', swedish: 'ord', english, pos: 'other', ...overrides };
}

// The deck the learner is playing. `increased` is in here because some other
// entry accepts it — that is what makes the stop-list guard fire.
const deck: WordEntry[] = [
  entry(['decreased'], { id: 'minska-verb' }),
  entry(['increased'], { id: 'oka-verb' }),
  entry(['the government'], { id: 'regering-noun' }),
  entry(['number', 'the number'], { id: 'antal-noun' }),
  entry(['likes', 'like (easier)'], { id: 'gillar-verb' }),
  entry(['although I think'], { id: 'fast-jag-tycker-phrase' }),
  entry(['to know a language'], { id: 'kan-ett-sprak-phrase' }),
  entry(['comrade'], { id: 'kamrat-noun' }),
  entry(['fewer'], { id: 'farre-adjective' }),
];

const allAnswers = collectAllAnswers(deck);

describe('checkAnswer — the table from the plan', () => {
  it('strips a leading article: "government" for "the government"', () => {
    expect(checkAnswer('government', entry(['the government']), allAnswers).verdict).toBe('correct');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(checkAnswer('  The Government  ', entry(['the government']), allAnswers).verdict).toBe(
      'correct',
    );
  });

  it('accepts either alternate: "number"', () => {
    expect(checkAnswer('number', entry(['number', 'the number']), allAnswers).verdict).toBe(
      'correct',
    );
  });

  it('strips a parenthetical: "like" for "like (easier)"', () => {
    expect(checkAnswer('like', entry(['likes', 'like (easier)']), allAnswers).verdict).toBe(
      'correct',
    );
  });

  it('calls a one-character typo close', () => {
    const result = checkAnswer('decresed', entry(['decreased']), allAnswers);
    expect(result.verdict).toBe('close');
    expect(result.distance).toBe(1);
    expect(result.reason).toBe('fuzzy');
  });

  it('calls a two-character typo close on a long input', () => {
    const result = checkAnswer('decrised', entry(['decreased']), allAnswers);
    expect(result.verdict).toBe('close');
    expect(result.distance).toBe(2);
  });

  it('calls "increased" wrong, not close — the stop-list guard', () => {
    const result = checkAnswer('increased', entry(['decreased']), allAnswers);
    expect(result.verdict).toBe('wrong');
    expect(result.reason).toBeUndefined();
  });

  it('ignores case in a phrase', () => {
    expect(checkAnswer('although i think', entry(['although I think']), allAnswers).verdict).toBe(
      'correct',
    );
  });

  it('calls a substring of a 3-word answer close', () => {
    const result = checkAnswer('although', entry(['although I think']), allAnswers);
    expect(result.verdict).toBe('close');
    expect(result.reason).toBe('substring');
  });

  it('strips a leading "to"', () => {
    expect(checkAnswer('know a language', entry(['to know a language']), allAnswers).verdict).toBe(
      'correct',
    );
  });

  it('calls empty input wrong without throwing', () => {
    expect(() => checkAnswer('', entry(['comrade']), allAnswers)).not.toThrow();
    expect(checkAnswer('', entry(['comrade']), allAnswers).verdict).toBe('wrong');
    expect(checkAnswer('   ', entry(['comrade']), allAnswers).verdict).toBe('wrong');
  });

  it('strips trailing punctuation and padding', () => {
    expect(checkAnswer('   fewer.  ', entry(['fewer']), allAnswers).verdict).toBe('correct');
  });
});

describe('checkAnswer — reasons and matches', () => {
  it('reports the un-normalized answer it matched', () => {
    const result = checkAnswer('like', entry(['likes', 'like (easier)']), allAnswers);
    expect(result.matched).toBe('like (easier)');
  });

  it('distinguishes an exact match from an alternate match', () => {
    expect(checkAnswer('decreased', entry(['decreased']), allAnswers).reason).toBe('exact');
    expect(checkAnswer('went down', entry(['decreased / went down']), allAnswers).reason).toBe(
      'alternate',
    );
  });

  it('never reaches the fuzzy tier for inputs under four characters', () => {
    expect(checkAnswer('cta', entry(['cat']), allAnswers).verdict).toBe('wrong');
    expect(checkAnswer('dog', entry(['dot']), allAnswers).verdict).toBe('wrong');
  });

  it('allows only one typo in a four-to-seven character input', () => {
    expect(checkAnswer('fewor', entry(['fewer']), allAnswers).verdict).toBe('close');
    expect(checkAnswer('fowor', entry(['fewer']), allAnswers).verdict).toBe('wrong');
  });

  it('matches an answer that contains the typed phrase and vice versa', () => {
    const long = entry(['to know a language']);
    expect(checkAnswer('know a language well', long, allAnswers).reason).toBe('substring');
  });

  it('does not call a short unrelated word close by substring', () => {
    expect(checkAnswer('power', entry(['the government']), allAnswers).verdict).toBe('wrong');
  });

  it('picks the nearest accepted answer when several are within tolerance', () => {
    const result = checkAnswer('decreaced', entry(['decreased', 'decreasing']), allAnswers);
    expect(result.matched).toBe('decreased');
    expect(result.distance).toBe(1);
  });

  it('lets an entry accept a word that is on the stop-list for another entry', () => {
    expect(checkAnswer('increased', entry(['increased']), allAnswers).verdict).toBe('correct');
  });
});

describe('collectAllAnswers', () => {
  it('includes both whole answers and their slash-separated pieces', () => {
    const set = collectAllAnswers([entry(['number / the number'])]);
    expect(set.has('number')).toBe(true);
  });
});

describe('checkAnswer — fuzzing', () => {
  it('never throws on 1,000 random strings', () => {
    const alphabet = ' abcdefghijklmnopqrstuvwxyzÅÄÖåäö.,!?"\'()/-0123456789';
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let i = 0; i < 1000; i++) {
      const length = Math.floor(rand() * 30);
      let input = '';
      for (let j = 0; j < length; j++) {
        input += alphabet[Math.floor(rand() * alphabet.length)];
      }
      expect(() => checkAnswer(input, entry(['decreased']), allAnswers)).not.toThrow();
    }
  });
});
