import { describe, it, expect, beforeEach } from 'vitest';
import { sendMail, sentMessages, resetSentMessages } from '../src/modules/notifications/email';

beforeEach(() => resetSentMessages());

describe('sendMail (test/log capture mode)', () => {
  it('captures the message and never throws without real SMTP', async () => {
    await sendMail({ to: 'a@b.com', subject: 'Hello', html: '<p>hi</p>', text: 'hi' });
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].to).toBe('a@b.com');
    expect(sentMessages[0].subject).toBe('Hello');
  });
  it('reset clears the capture', async () => {
    await sendMail({ to: 'x@y.com', subject: 'A', html: '<p>a</p>', text: 'a' });
    resetSentMessages();
    expect(sentMessages.length).toBe(0);
  });
});
