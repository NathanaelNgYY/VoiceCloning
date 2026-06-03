import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3_REGION } from '../config.js';

const SES_FROM = process.env.SES_FROM_EMAIL || '';

let sesClient = null;

function getClient() {
  if (!sesClient) {
    sesClient = new SESClient({ region: S3_REGION || 'us-east-1' });
  }
  return sesClient;
}

export async function sendTrainingCompleteEmail(toEmail, expName) {
  if (!toEmail || !SES_FROM) {
    return;
  }

  const command = new SendEmailCommand({
    Source: SES_FROM,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: 'Voice cloning training complete' },
      Body: {
        Text: {
          Data: `Training is complete, you may now come back to test it.\n\nExperiment: ${expName}`,
        },
      },
    },
  });

  try {
    await getClient().send(command);
  } catch (err) {
    console.warn('[gpu-worker] Failed to send training complete email:', err.message);
  }
}
