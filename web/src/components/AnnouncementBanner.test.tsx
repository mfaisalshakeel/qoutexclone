import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementBanner } from './AnnouncementBanner';
import { api } from '../lib/api';
import type { Announcement } from '../lib/types';

vi.mock('../lib/api', () => ({ api: { get: vi.fn() } }));

const announcement = (over: Partial<Announcement> = {}): Announcement => ({
  id: 'a1',
  message: 'Scheduled maintenance Sunday.',
  style: 'info',
  linkLabel: null,
  linkUrl: null,
  active: true,
  startsAt: null,
  endsAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('AnnouncementBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing while there is nothing active', async () => {
    vi.mocked(api.get).mockResolvedValue({ announcements: [] });
    const { container } = render(<AnnouncementBanner />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/content/announcements'));
    expect(container.firstChild).toBeNull();
  });

  it('shows an active announcement with its link', async () => {
    vi.mocked(api.get).mockResolvedValue({
      announcements: [announcement({ linkUrl: 'https://example.com', linkLabel: 'Details' })],
    });
    render(<AnnouncementBanner />);
    expect(await screen.findByText('Scheduled maintenance Sunday.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Details' })).toHaveProperty(
      'href',
      'https://example.com/',
    );
  });

  it('dismisses a banner and remembers it across a remount', async () => {
    vi.mocked(api.get).mockResolvedValue({ announcements: [announcement()] });
    const { unmount } = render(<AnnouncementBanner />);
    const dismissButton = await screen.findByLabelText('Dismiss this announcement');
    fireEvent.click(dismissButton);
    await waitFor(() => expect(screen.queryByText('Scheduled maintenance Sunday.')).toBeNull());
    unmount();

    render(<AnnouncementBanner />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Scheduled maintenance Sunday.')).toBeNull();
  });
});
