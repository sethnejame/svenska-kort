import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransferPanel } from './TransferPanel';
import * as transferService from '../../services/transfer';
import * as deviceToken from '../../services/deviceToken';
import * as outbox from '../../services/outbox';

vi.mock('../../services/transfer');
vi.mock('../../services/outbox');

let reload: ReturnType<typeof vi.fn>;

describe('TransferPanel', () => {
  beforeEach(() => {
    vi.spyOn(outbox, 'size').mockReturnValue(0);
    vi.spyOn(deviceToken, 'setToken').mockImplementation(() => undefined);
    reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the code, counts down, and offers a copy button', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    vi.spyOn(transferService, 'createTransferCode').mockResolvedValue({
      code: 'ABCD-EFGH',
      expiresAt: '2026-09-22T12:10:00.000Z',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(<TransferPanel />);
    await user.click(screen.getByRole('button', { name: 'Skapa kod' }));

    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(screen.getByText('Går ut om 10:00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kopiera kod' }));
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH');
    expect(await screen.findByRole('button', { name: 'Kopierat!' })).toBeInTheDocument();
  });

  it('counts down and replaces itself once the code expires', async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    vi.spyOn(transferService, 'createTransferCode').mockResolvedValue({
      code: 'ABCD-EFGH',
      expiresAt: '2026-09-22T12:00:02.000Z',
    });

    render(<TransferPanel />);
    await user.click(screen.getByRole('button', { name: 'Skapa kod' }));
    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2500);

    expect(screen.getByText('Koden har gått ut.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skapa ny kod' })).toBeInTheDocument();
  });

  it('shows a retry on a failed create', async () => {
    const user = userEvent.setup();
    vi.spyOn(transferService, 'createTransferCode').mockRejectedValue(new Error('Nätverksfel.'));

    render(<TransferPanel />);
    await user.click(screen.getByRole('button', { name: 'Skapa kod' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nätverksfel.');
    expect(screen.getByRole('button', { name: 'Försök igen' })).toBeInTheDocument();
  });

  it('claims directly when there is nothing unsynced', async () => {
    const user = userEvent.setup();
    vi.spyOn(outbox, 'size').mockReturnValue(0);
    vi.spyOn(transferService, 'claimTransferCode').mockResolvedValue('new-token');

    render(<TransferPanel />);
    await user.type(screen.getByLabelText('Kod'), 'abcd-efgh');
    await user.click(screen.getByRole('button', { name: 'Använd kod' }));

    await waitFor(() => {
      expect(vi.mocked(transferService.claimTransferCode)).toHaveBeenCalledWith('abcd-efgh');
    });
    expect(vi.mocked(deviceToken.setToken)).toHaveBeenCalledWith('new-token');
    expect(reload).toHaveBeenCalled();
  });

  it('confirms before overwriting unsynced sessions, and never claims on cancel', async () => {
    const user = userEvent.setup();
    vi.spyOn(outbox, 'size').mockReturnValue(3);
    vi.spyOn(transferService, 'claimTransferCode').mockResolvedValue('new-token');

    render(<TransferPanel />);
    await user.type(screen.getByLabelText('Kod'), 'ABCD-EFGH');
    await user.click(screen.getByRole('button', { name: 'Använd kod' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Den här enheten har 3 omgångar som inte är synkade. De skrivs över.',
    );
    expect(vi.mocked(transferService.claimTransferCode)).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Avbryt' }));
    expect(screen.getByLabelText('Kod')).toBeInTheDocument();
    expect(vi.mocked(transferService.claimTransferCode)).not.toHaveBeenCalled();
  });

  it('claims after the confirm is accepted', async () => {
    const user = userEvent.setup();
    vi.spyOn(outbox, 'size').mockReturnValue(1);
    vi.spyOn(transferService, 'claimTransferCode').mockResolvedValue('new-token');

    render(<TransferPanel />);
    await user.type(screen.getByLabelText('Kod'), 'ABCD-EFGH');
    await user.click(screen.getByRole('button', { name: 'Använd kod' }));
    await user.click(screen.getByRole('button', { name: 'Fortsätt' }));

    await waitFor(() => {
      expect(vi.mocked(transferService.claimTransferCode)).toHaveBeenCalledWith('ABCD-EFGH');
    });
    expect(reload).toHaveBeenCalled();
  });

  it('shows the same generic error a wrong, expired or used code would give', async () => {
    const user = userEvent.setup();
    vi.spyOn(transferService, 'claimTransferCode').mockRejectedValue(
      new Error('Koden är ogiltig eller har gått ut.'),
    );

    render(<TransferPanel />);
    await user.type(screen.getByLabelText('Kod'), 'ZZZZ-ZZZZ');
    await user.click(screen.getByRole('button', { name: 'Använd kod' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Koden är ogiltig eller har gått ut.',
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears a claim error as soon as the learner edits the code again', async () => {
    const user = userEvent.setup();
    vi.spyOn(transferService, 'claimTransferCode').mockRejectedValue(new Error('Fel.'));

    render(<TransferPanel />);
    await user.type(screen.getByLabelText('Kod'), 'ZZZZ');
    await user.click(screen.getByRole('button', { name: 'Använd kod' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Kod'), 'X');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does nothing on an empty submit', async () => {
    const user = userEvent.setup();
    vi.spyOn(transferService, 'claimTransferCode');

    render(<TransferPanel />);
    await user.click(screen.getByRole('button', { name: 'Använd kod' }));

    expect(vi.mocked(transferService.claimTransferCode)).not.toHaveBeenCalled();
  });
});
