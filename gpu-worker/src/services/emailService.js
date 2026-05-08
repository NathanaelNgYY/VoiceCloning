import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SES_FROM_EMAIL, S3_REGION } from '../config.js';

const INFERENCE_BASE_URL = 'https://doovx82fh9tfs.cloudfront.net';

export async function sendTrainingCompleteEmail(email, expName, { sesClient, fromEmail } = {}) {
  const sender = fromEmail !== undefined ? fromEmail : SES_FROM_EMAIL;

  if (!sender) {
    console.warn('[gpu-worker] SES_FROM_EMAIL not configured — skipping training complete email');
    return;
  }

  const inferenceUrl = `${INFERENCE_BASE_URL}?voice=${encodeURIComponent(expName)}`;
  const client = sesClient || new SESClient({ region: S3_REGION || 'ap-southeast-1' });

  const plainText = [
    `Training is complete for voice "${expName}".`,
    '',
    'Visit your inference studio here:',
    inferenceUrl,
    '',
  ].join('\n');

  const html = `<p>Training is complete for voice <strong>${expName}</strong>.</p>`
    + `<p>Visit your inference studio here:<br>`
    + `<a href="${inferenceUrl}">${inferenceUrl}</a></p>`;

  await client.send(new SendEmailCommand({
    Source: sender,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Your voice model is ready: ${expName}` },
      Body: {
        Text: { Data: plainText },
        Html: { Data: html },
      },
    },
  }));
}
