import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormsTable } from './FormsTable';

describe('FormsTable', () => {
  it('renders four noun rows and the gender chip', () => {
    render(
      <FormsTable
        forms={{
          kind: 'noun',
          gender: 'en',
          indefSg: 'en regering',
          defSg: 'regeringen',
          indefPl: 'regeringar',
          defPl: 'regeringarna',
        }}
      />,
    );

    expect(screen.getByText('en')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Singular/ })).toHaveTextContent('en regering');
    expect(screen.getByRole('row', { name: /Bestämd plural/ })).toHaveTextContent('regeringarna');
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('renders the verb paradigm with imperative and group chip', () => {
    render(
      <FormsTable
        forms={{
          kind: 'verb',
          infinitive: 'begrava',
          present: 'begraver',
          past: 'begravde',
          supine: 'begravt',
          imperative: 'begrav',
          group: 2,
        }}
      />,
    );

    expect(screen.getByText('Grupp 2')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('row', { name: /Supinum/ })).toHaveTextContent('begravt');
  });

  it('omits the imperative row and group chip when absent', () => {
    render(
      <FormsTable
        forms={{ kind: 'verb', infinitive: 'minska', present: 'minskar', past: 'minskade', supine: 'minskat' }}
      />,
    );

    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByText(/Grupp/)).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Imperativ/ })).not.toBeInTheDocument();
  });

  it('renders adjective forms with optional degrees', () => {
    render(
      <FormsTable
        forms={{
          kind: 'adjective',
          base: 'utbildad',
          neuter: 'utbildat',
          plural: 'utbildade',
          comparative: 'mer utbildad',
        }}
      />,
    );

    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('row', { name: /Komparativ/ })).toHaveTextContent('mer utbildad');
    expect(screen.queryByRole('row', { name: /Superlativ/ })).not.toBeInTheDocument();
  });

  it('renders nothing at all for forms.kind none', () => {
    const { container } = render(<FormsTable forms={{ kind: 'none' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks every Swedish value as Swedish for screen readers', () => {
    render(<FormsTable forms={{ kind: 'adjective', base: 'stor', neuter: 'stort', plural: 'stora' }} />);
    const cell = screen.getByText('stort');
    expect(cell).toHaveAttribute('lang', 'sv');
  });
});
