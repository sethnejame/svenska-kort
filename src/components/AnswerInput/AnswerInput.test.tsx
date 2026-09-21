import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnswerInput } from './AnswerInput';

const noop = () => {};

describe('AnswerInput', () => {
  it('carries the mobile keyboard attributes that keep autocorrect out of the way', () => {
    render(<AnswerInput value="" onChange={noop} onSubmit={noop} />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('enterkeyhint', 'go');
    expect(input).toHaveAttribute('inputmode', 'text');
  });

  it('asks for the language it is actually grading', () => {
    const { unmount } = render(<AnswerInput value="" onChange={noop} onSubmit={noop} />);
    expect(screen.getByLabelText('Svara på engelska')).toHaveAttribute('lang', 'en');
    unmount();

    render(<AnswerInput value="" onChange={noop} onSubmit={noop} reverse />);
    expect(screen.getByLabelText('Svara på svenska')).toHaveAttribute('lang', 'sv');
  });

  it('reports every keystroke to onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AnswerInput value="" onChange={onChange} onSubmit={noop} />);

    await user.type(screen.getByRole('textbox'), 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('submits on Enter and leaves focus in the input', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AnswerInput value="power" onChange={noop} onSubmit={onSubmit} />);

    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(input).toHaveFocus();
  });

  it('can be disabled', () => {
    render(<AnswerInput value="" onChange={noop} onSubmit={noop} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('shows no verdict icon and announces nothing while idle', () => {
    const { container } = render(<AnswerInput value="po" onChange={noop} onSubmit={noop} />);

    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('', { selector: '[aria-live="polite"]' })).toBeEmptyDOMElement();
  });

  it.each([
    ['correct' as const, /Rätt!/],
    ['close' as const, /Nästan/],
    ['wrong' as const, /Inte riktigt/],
  ])('changes both the border class and the icon for %s', (verdict, announced) => {
    const { container } = render(
      <AnswerInput
        value="decresed"
        onChange={noop}
        onSubmit={noop}
        verdict={verdict}
        answer="decreased"
        submitted="decresed"
      />,
    );

    const field = container.querySelector('svg')?.closest('div');
    expect(field?.className).toMatch(new RegExp(verdict));
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(screen.getByText(announced)).toBeInTheDocument();
  });

  it('marks exactly the differing characters on close', () => {
    render(
      <AnswerInput
        value=""
        onChange={noop}
        onSubmit={noop}
        verdict="close"
        answer="decreased"
        submitted="decresed"
      />,
    );

    const marks = screen.getAllByRole('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('a');
    expect(screen.getByText('Du skrev').parentElement).toHaveTextContent('decresed');
    expect(screen.getByText('Svaret').parentElement).toHaveTextContent('decreased');
  });

  it('shows no diff for correct or wrong', () => {
    const { rerender } = render(
      <AnswerInput value="" onChange={noop} onSubmit={noop} verdict="correct" answer="power" />,
    );
    expect(screen.queryByText('Du skrev')).not.toBeInTheDocument();

    rerender(
      <AnswerInput value="" onChange={noop} onSubmit={noop} verdict="wrong" answer="power" />,
    );
    expect(screen.queryByText('Du skrev')).not.toBeInTheDocument();
  });

  it('hides the mic entirely when the browser cannot listen', () => {
    render(<AnswerInput value="" onChange={noop} onSubmit={noop} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('presses the mic while listening and calls back on tap', async () => {
    const onDictate = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AnswerInput value="" onChange={noop} onSubmit={noop} onDictate={onDictate} />,
    );

    const mic = screen.getByRole('button', { name: 'Svara med rösten' });
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    await user.click(mic);
    expect(onDictate).toHaveBeenCalledTimes(1);

    rerender(
      <AnswerInput value="" onChange={noop} onSubmit={noop} onDictate={onDictate} listening />,
    );
    const listening = screen.getByRole('button', { name: 'Lyssnar — tryck för att sluta' });
    expect(listening).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not submit the form when the mic is tapped', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AnswerInput value="" onChange={noop} onSubmit={onSubmit} onDictate={noop} />);

    await user.click(screen.getByRole('button', { name: 'Svara med rösten' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables the mic with the field', () => {
    render(<AnswerInput value="" onChange={noop} onSubmit={noop} onDictate={noop} disabled />);
    expect(screen.getByRole('button', { name: 'Svara med rösten' })).toBeDisabled();
  });

  it('names the answer in the wrong announcement so the learner still learns it', () => {
    render(
      <AnswerInput value="" onChange={noop} onSubmit={noop} verdict="wrong" answer="decreased" />,
    );
    expect(screen.getByText(/Inte riktigt/)).toHaveTextContent('svaret är decreased');
  });
});
