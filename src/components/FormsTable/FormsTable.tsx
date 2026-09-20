import type { WordForms } from '../../types/word';
import styles from './FormsTable.module.css';

interface Row {
  label: string;
  value: string;
}

function rowsFor(forms: WordForms): Row[] {
  switch (forms.kind) {
    case 'noun':
      return [
        { label: 'Singular', value: forms.indefSg },
        { label: 'Bestämd', value: forms.defSg },
        { label: 'Plural', value: forms.indefPl },
        { label: 'Bestämd plural', value: forms.defPl },
      ];
    case 'verb':
      return [
        { label: 'Infinitiv', value: forms.infinitive },
        { label: 'Presens', value: forms.present },
        { label: 'Preteritum', value: forms.past },
        { label: 'Supinum', value: forms.supine },
        ...(forms.imperative ? [{ label: 'Imperativ', value: forms.imperative }] : []),
      ];
    case 'adjective':
      return [
        { label: 'Grundform', value: forms.base },
        { label: 'Neutrum', value: forms.neuter },
        { label: 'Plural', value: forms.plural },
        ...(forms.comparative ? [{ label: 'Komparativ', value: forms.comparative }] : []),
        ...(forms.superlative ? [{ label: 'Superlativ', value: forms.superlative }] : []),
      ];
    case 'none':
      return [];
  }
}

function chipsFor(forms: WordForms): string[] {
  if (forms.kind === 'noun') return [forms.gender];
  if (forms.kind === 'verb' && forms.group) return [`Grupp ${forms.group}`];
  return [];
}

export function FormsTable({ forms }: { forms: WordForms }) {
  const rows = rowsFor(forms);
  if (rows.length === 0) return null;

  const chips = chipsFor(forms);

  return (
    <div className={styles.wrap}>
      {chips.length > 0 && (
        <div className={styles.chips}>
          {chips.map((chip) => (
            <span key={chip} className={styles.chip} lang="sv">
              {chip}
            </span>
          ))}
        </div>
      )}
      <table className={styles.table}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" lang="sv">
                {row.label}
              </th>
              <td lang="sv">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
