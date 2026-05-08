import test from 'node:test';
import assert from 'node:assert/strict';

test('sendTrainingCompleteEmail sends correct subject and body to SES', async () => {
  const calls = [];
  const mockClient = {
    send: async (command) => {
      calls.push(command.input);
    },
  };

  const { sendTrainingCompleteEmail } = await import('./emailService.js');

  await sendTrainingCompleteEmail('user@example.com', 'my_voice', {
    sesClient: mockClient,
    fromEmail: 'sender@example.com',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].Source, 'sender@example.com');
  assert.deepEqual(calls[0].Destination.ToAddresses, ['user@example.com']);
  assert.ok(calls[0].Message.Subject.Data.includes('my_voice'), 'subject should contain expName');
  assert.ok(calls[0].Message.Body.Text.Data.includes('doovx82fh9tfs.cloudfront.net'), 'text body should contain inference URL');
  assert.ok(calls[0].Message.Body.Text.Data.includes('my_voice'), 'text body should contain expName');
  assert.ok(calls[0].Message.Body.Html.Data.includes('doovx82fh9tfs.cloudfront.net'), 'html body should contain inference URL');
  assert.ok(calls[0].Message.Body.Html.Data.includes('my_voice'), 'html body should contain expName');
  assert.ok(
    calls[0].Message.Body.Text.Data.includes('voice=my_voice'),
    'text body should include voice query param'
  );
});

test('sendTrainingCompleteEmail skips silently when fromEmail is not provided', async () => {
  const calls = [];
  const mockClient = {
    send: async (command) => {
      calls.push(command);
    },
  };

  const { sendTrainingCompleteEmail } = await import('./emailService.js');

  await sendTrainingCompleteEmail('user@example.com', 'my_voice', {
    sesClient: mockClient,
    fromEmail: '',
  });

  assert.equal(calls.length, 0);
});
