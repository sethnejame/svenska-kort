import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { INITIAL_DECK_STATE, useDeckStore } from '../store/useDeckStore';
import { INITIAL_GAME_STATE, useGameStore } from '../store/useGameStore';
import { entriesForDeck } from '../data/decks';
import { Add } from './Add';

const SAMPLE = `förberedd - prepared
antal / antalet - number / the number
gillar - likes, like        # note: easier than "tycker om"
minskade - decreased        @verb minska/minskar/minskade/minskat
"fast jag tycker" - although I think`;

function renderAdd() {
  const router = createMemoryRouter(
    [
      { path: '/add', element: <Add /> },
      { path: '/decks', element: <div>leklista</div> },
    ],
    { initialEntries: ['/add'] },
  );
  return render(<RouterProvider router={router} />);
}

/**
 * `user.type` costs a keystroke per character, which a 200-line paste cannot
 * afford, and a paste is one change event anyway.
 */
function paste(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: /Ett ord per rad/ }), {
    target: { value: text },
  });
}

async function fillMinimum(user: ReturnType<typeof userEvent.setup>, swedish: string) {
  await user.type(screen.getByLabelText('Svenska'), swedish);
  await user.type(screen.getByLabelText('Engelska'), 'thing');
}

describe('Add', () => {
  beforeEach(() => {
    useDeckStore.setState({ ...INITIAL_DECK_STATE });
    useGameStore.setState({ ...INITIAL_GAME_STATE });
  });

  it('opens on the single-word tab', () => {
    renderAdd();
    expect(screen.getByRole('tab', { name: 'Ett ord' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Svenska')).toBeInTheDocument();
  });

  it('shows an empty paste box on the bulk tab', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole('tab', { name: 'Klistra in lista' }));
    expect(screen.getByRole('textbox', { name: /Ett ord per rad/ })).toHaveValue('');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('saves a word and reports it', async () => {
    const user = userEvent.setup();
    renderAdd();

    await fillMinimum(user, 'kylskåp');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    const entries = useDeckStore.getState().userEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'kylskap-noun', swedish: 'kylskåp', english: ['thing'] });
    expect(screen.getByRole('status')).toHaveTextContent('kylskåp är sparat.');
  });

  it('puts the saved word in the alla deck for the next session', async () => {
    const user = userEvent.setup();
    renderAdd();

    await fillMinimum(user, 'kylskåp');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    const ids = entriesForDeck('alla', useDeckStore.getState().userEntries).map((e) => e.id);
    expect(ids).toContain('kylskap-noun');
  });

  it('blocks a save with no english and says so on the field', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByLabelText('Svenska'), 'kylskåp');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    expect(screen.getByRole('alert')).toHaveTextContent('minst en engelsk översättning');
    expect(screen.getByLabelText('Engelska')).toHaveAttribute('aria-invalid', 'true');
    expect(useDeckStore.getState().userEntries).toEqual([]);
  });

  it('blocks a save with no swedish', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByLabelText('Engelska'), 'fridge');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Skriv ordet på svenska.');
    expect(useDeckStore.getState().userEntries).toEqual([]);
  });

  it('keeps english answers as removable chips', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByLabelText('Engelska'), 'fridge{Enter}');
    await user.type(screen.getByLabelText('Engelska'), 'icebox{Enter}');

    const chip = screen.getByRole('button', { name: /^fridge/ });
    await user.click(chip);

    await user.type(screen.getByLabelText('Svenska'), 'kylskåp');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    expect(useDeckStore.getState().userEntries[0]?.english).toEqual(['icebox']);
  });

  it('fills a regular verb paradigm and marks it as a suggestion', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.selectOptions(screen.getByLabelText('Ordklass'), 'verb');
    await user.type(screen.getByLabelText('Svenska'), 'tala');

    expect(screen.getByLabelText('Presens')).toHaveValue('talar');
    expect(screen.getByLabelText('Preteritum')).toHaveValue('talade');
    expect(screen.getByLabelText('Supinum')).toHaveValue('talat');
    expect(screen.getByText('Förslag')).toBeInTheDocument();
  });

  it('offers nothing for a strong verb and leaves the fields to the learner', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.selectOptions(screen.getByLabelText('Ordklass'), 'verb');
    await user.type(screen.getByLabelText('Svenska'), 'dricka');

    expect(screen.getByLabelText('Presens')).toHaveValue('');
    expect(screen.queryByText('Förslag')).not.toBeInTheDocument();
  });

  it('drops the chip as soon as a form field is edited', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.selectOptions(screen.getByLabelText('Ordklass'), 'verb');
    await user.type(screen.getByLabelText('Svenska'), 'tala');
    expect(screen.getByText('Förslag')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Preteritum'), 'x');
    expect(screen.queryByText('Förslag')).not.toBeInTheDocument();
  });

  it('hides the chip on request without throwing the values away', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.selectOptions(screen.getByLabelText('Ordklass'), 'verb');
    await user.type(screen.getByLabelText('Svenska'), 'tala');
    await user.click(screen.getByRole('button', { name: 'Dölj' }));

    expect(screen.queryByText('Förslag')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Presens')).toHaveValue('talar');
  });

  it('suggests the noun pattern the chosen gender implies', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByLabelText('Svenska'), 'hus');
    expect(screen.getByLabelText('Bestämd singular')).toHaveValue('husen');

    await user.selectOptions(screen.getByLabelText('Genus'), 'ett');
    expect(screen.getByLabelText('Bestämd singular')).toHaveValue('huset');
    expect(screen.getByLabelText('Obestämd plural')).toHaveValue('hus');
  });

  it('does not carry stale forms across a change of part of speech', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.selectOptions(screen.getByLabelText('Ordklass'), 'verb');
    await user.type(screen.getByLabelText('Svenska'), 'tala');
    expect(screen.getByLabelText('Presens')).toHaveValue('talar');

    await user.selectOptions(screen.getByLabelText('Ordklass'), 'adverb');
    await user.type(screen.getByLabelText('Engelska'), 'to speak');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    const entry = useDeckStore.getState().userEntries[0];
    expect(entry?.pos).toBe('adverb');
    expect(entry?.forms).toBeUndefined();
  });

  it('pairs a phrase with empty forms so the schema accepts it', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.selectOptions(screen.getByLabelText('Ordklass'), 'phrase');
    await fillMinimum(user, 'så där ja');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    expect(useDeckStore.getState().userEntries[0]).toMatchObject({
      id: 'sa-dar-ja-phrase',
      forms: { kind: 'none' },
    });
  });

  it('suffixes an id already taken by a builtin rather than shadowing it', async () => {
    const user = userEvent.setup();
    const existing = entriesForDeck('alla')[0];
    expect(existing).toBeDefined();
    if (!existing) return;

    renderAdd();

    await user.selectOptions(screen.getByLabelText('Ordklass'), existing.pos);
    await fillMinimum(user, existing.lemma ?? existing.swedish);
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    const saved = useDeckStore.getState().userEntries[0];
    expect(saved?.id).not.toBe(existing.id);
    expect(saved?.id).toMatch(/-2$/);
  });

  it('empties the form after a save so the next word starts clean', async () => {
    const user = userEvent.setup();
    renderAdd();

    await fillMinimum(user, 'kylskåp');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    expect(screen.getByLabelText('Svenska')).toHaveValue('');
    expect(screen.getByLabelText('Engelska')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /^thing/ })).not.toBeInTheDocument();
  });

  it('previews every pasted line, sound or not, and imports only the sound ones', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole('tab', { name: 'Klistra in lista' }));
    paste(`${SAMPLE}\nförmål objects`);

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);
    expect(screen.getByText('5 klara, 1 behöver ses över')).toBeInTheDocument();
    expect(screen.getByText("no ' - ' separator found")).toBeInTheDocument();

    // Nothing is written until the learner asks for it.
    expect(useDeckStore.getState().userEntries).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Importera 5 ord' }));

    const saved = useDeckStore.getState().userEntries;
    expect(saved).toHaveLength(5);
    expect(saved.map((entry) => entry.swedish)).toEqual([
      'förberedd',
      'antal / antalet',
      'gillar',
      'minskade',
      'fast jag tycker',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('5 ord sparade.');
  });

  it('empties the paste box once the import is done', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole('tab', { name: 'Klistra in lista' }));
    paste('hus - house');
    await user.click(screen.getByRole('button', { name: 'Importera 1 ord' }));

    expect(screen.getByRole('textbox', { name: /Ett ord per rad/ })).toHaveValue('');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('opens a pasted row in the single-word form and takes it out of the paste', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole('tab', { name: 'Klistra in lista' }));
    paste('hus - house\nminskade - decreased @verb minska/minskar/minskade/minskat');

    await user.click(screen.getByRole('button', { name: 'Ändra rad 2' }));

    expect(screen.getByRole('tab', { name: 'Ett ord' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Svenska')).toHaveValue('minskade');
    expect(screen.getByLabelText('Preteritum')).toHaveValue('minskade');
    expect(screen.getByRole('button', { name: /^decreased/ })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Klistra in lista' }));
    expect(screen.getByRole('textbox', { name: /Ett ord per rad/ })).toHaveValue('hus - house');
  });

  it('renders a two hundred line paste', async () => {
    const user = userEvent.setup();
    renderAdd();

    const lines = Array.from({ length: 200 }, (_, i) => `ord${i} - word${i}`).join('\n');
    await user.click(screen.getByRole('tab', { name: 'Klistra in lista' }));
    paste(lines);

    expect(screen.getByText('200 klara, 0 behöver ses över')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(201);
  });

  it('gives each repeated line its own id', async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole('tab', { name: 'Klistra in lista' }));
    paste('hus - house\nhus - building');
    await user.click(screen.getByRole('button', { name: 'Importera 2 ord' }));

    const ids = useDeckStore.getState().userEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('carries the optional fields through', async () => {
    const user = userEvent.setup();
    renderAdd();

    await fillMinimum(user, 'kylskåpen');
    await user.type(screen.getByLabelText('Grundform (om ordet är böjt)'), 'kylskåp');
    await user.type(screen.getByLabelText('Exempel på svenska'), 'Kylskåpen är tomma.');
    await user.type(screen.getByLabelText('Exempel på engelska'), 'The fridges are empty.');
    await user.type(screen.getByLabelText('Anteckning'), 'Plural bestämd form.');
    await user.type(screen.getByLabelText('Etiketter'), 'news{Enter}');
    await user.selectOptions(screen.getByLabelText('Nivå'), '2');
    await user.click(screen.getByRole('button', { name: 'Spara ordet' }));

    expect(useDeckStore.getState().userEntries[0]).toMatchObject({
      id: 'kylskap-noun',
      swedish: 'kylskåpen',
      lemma: 'kylskåp',
      example: { sv: 'Kylskåpen är tomma.', en: 'The fridges are empty.' },
      note: 'Plural bestämd form.',
      tags: ['news'],
      level: 2,
    });
  });
});
