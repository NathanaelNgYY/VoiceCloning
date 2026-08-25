import test from 'node:test';
import assert from 'node:assert/strict';

test('sendTrainingCompleteEmail sends the configured SMTP message', async () => {
  const calls = [];
  const transport = {
    sendMail: async (message) => {
      calls.push(message);
    },
  };

  const { sendTrainingCompleteEmail } = await import('./emailService.js');

  await sendTrainingCompleteEmail('user@example.com', 'my_voice', {
    transport,
    fromEmail: 'sender@example.com',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, 'sender@example.com');
  assert.equal(calls[0].to, 'user@example.com');
  assert.ok(calls[0].subject.includes('my_voice'), 'subject should contain expName');
  assert.ok(calls[0].text.includes('my_voice'), 'text body should contain expName');
  assert.ok(calls[0].html.includes('my_voice'), 'html body should contain expName');
});

test('sendTrainingCompleteEmail skips silently when fromEmail is not provided', async () => {
  const calls = [];
  const transport = {
    sendMail: async (message) => {
      calls.push(message);
    },
  };

  const { sendTrainingCompleteEmail } = await import('./emailService.js');

  await sendTrainingCompleteEmail('user@example.com', 'my_voice', {
    transport,
    fromEmail: '',
  });

  assert.equal(calls.length, 0);
});
