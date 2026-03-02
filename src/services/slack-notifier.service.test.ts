import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    SLACK_BOT_TOKEN: 'xoxb-test-token',
  },
}));

const mockPostMessage = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: {
      postMessage: mockPostMessage,
      update: mockUpdate,
    },
  })),
}));

import { notify, updateNotification } from './slack-notifier.service.js';

describe('slack-notifier.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('notify', () => {
    it('should send notification successfully', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: 'ts-returned' });

      await notify('C123', 'ts123', 'test message');

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'C123',
        thread_ts: 'ts123',
        text: 'test message',
        blocks: undefined,
      });
    });

    it('should return the ts from the API response', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: 'ts-abc-123' });

      const ts = await notify('C123', 'ts123', 'test message');

      expect(ts).toBe('ts-abc-123');
    });

    it('should return undefined when ts is not in response', async () => {
      mockPostMessage.mockResolvedValue({ ok: true });

      const ts = await notify('C123', 'ts123', 'test message');

      expect(ts).toBeUndefined();
    });

    it('should pass blocks to postMessage when provided', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: 'ts-xyz' });

      const blocks = [
        {
          type: 'section' as const,
          text: { type: 'mrkdwn' as const, text: 'hello' },
        },
      ];

      await notify('C123', 'ts123', 'fallback text', blocks);

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: 'C123',
        thread_ts: 'ts123',
        text: 'fallback text',
        blocks,
      });
    });

    it('should not throw when Slack API fails (non-fatal)', async () => {
      mockPostMessage.mockRejectedValue(new Error('Slack API error'));

      await expect(notify('C123', 'ts123', 'test')).resolves.toBeUndefined();
    });

    it('should swallow network errors silently', async () => {
      mockPostMessage.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(notify('C123', 'ts123', 'test')).resolves.toBeUndefined();
    });

    it('should return undefined on API failure', async () => {
      mockPostMessage.mockRejectedValue(new Error('Slack API error'));

      const ts = await notify('C123', 'ts123', 'test');

      expect(ts).toBeUndefined();
    });
  });

  describe('updateNotification', () => {
    it('should call chat.update with correct parameters', async () => {
      mockUpdate.mockResolvedValue({ ok: true });

      await updateNotification('C123', 'ts-456', 'updated text');

      expect(mockUpdate).toHaveBeenCalledWith({
        channel: 'C123',
        ts: 'ts-456',
        text: 'updated text',
        blocks: undefined,
      });
    });

    it('should pass blocks to chat.update when provided', async () => {
      mockUpdate.mockResolvedValue({ ok: true });

      const blocks = [
        {
          type: 'section' as const,
          text: { type: 'mrkdwn' as const, text: 'updated block' },
        },
      ];

      await updateNotification('C123', 'ts-456', 'updated text', blocks);

      expect(mockUpdate).toHaveBeenCalledWith({
        channel: 'C123',
        ts: 'ts-456',
        text: 'updated text',
        blocks,
      });
    });

    it('should not throw when Slack API fails (non-fatal)', async () => {
      mockUpdate.mockRejectedValue(new Error('Slack API error'));

      await expect(updateNotification('C123', 'ts-456', 'text')).resolves.toBeUndefined();
    });

    it('should swallow network errors silently', async () => {
      mockUpdate.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(updateNotification('C123', 'ts-456', 'text')).resolves.toBeUndefined();
    });
  });
});
