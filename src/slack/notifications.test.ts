import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

import { addReaction, sendThreadMessage, updateMessage } from './notifications.js';

function createMockApp() {
  return {
    client: {
      reactions: { add: vi.fn().mockResolvedValue({ ok: true }) },
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '9999.0001' }),
        update: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
  } as unknown as Parameters<typeof addReaction>[0];
}

describe('notifications', () => {
  describe('addReaction', () => {
    it('should call reactions.add with correct params', async () => {
      const app = createMockApp();
      await addReaction(app, 'C123', '1234.5678', 'eyes');

      expect(app.client.reactions.add).toHaveBeenCalledWith({
        channel: 'C123',
        timestamp: '1234.5678',
        name: 'eyes',
      });
    });

    it('should not throw on API error', async () => {
      const app = createMockApp();
      app.client.reactions.add.mockRejectedValue(new Error('already_reacted'));

      await expect(addReaction(app, 'C123', '1234.5678', 'eyes')).resolves.toBeUndefined();
    });
  });

  describe('sendThreadMessage', () => {
    it('should call chat.postMessage with correct params (no blocks)', async () => {
      const app = createMockApp();
      await sendThreadMessage(app, 'C123', '1234.5678', 'Hello!');

      expect(app.client.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        thread_ts: '1234.5678',
        text: 'Hello!',
        blocks: undefined,
      });
    });

    it('should call chat.postMessage with blocks when provided', async () => {
      const app = createMockApp();
      const blocks = [
        { type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'block text' } },
      ];
      await sendThreadMessage(app, 'C123', '1234.5678', 'Hello!', blocks);

      expect(app.client.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        thread_ts: '1234.5678',
        text: 'Hello!',
        blocks,
      });
    });

    it('should return the message timestamp from the API response', async () => {
      const app = createMockApp();
      const ts = await sendThreadMessage(app, 'C123', '1234.5678', 'Hello!');

      expect(ts).toBe('9999.0001');
    });
  });

  describe('updateMessage', () => {
    it('should call chat.update with correct params (no blocks)', async () => {
      const app = createMockApp();
      await updateMessage(app, 'C123', '1234.5678', 'Updated text');

      expect(app.client.chat.update).toHaveBeenCalledWith({
        channel: 'C123',
        ts: '1234.5678',
        text: 'Updated text',
        blocks: undefined,
      });
    });

    it('should call chat.update with blocks when provided', async () => {
      const app = createMockApp();
      const blocks = [
        { type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'updated block' } },
      ];
      await updateMessage(app, 'C123', '1234.5678', 'Updated text', blocks);

      expect(app.client.chat.update).toHaveBeenCalledWith({
        channel: 'C123',
        ts: '1234.5678',
        text: 'Updated text',
        blocks,
      });
    });
  });
});
