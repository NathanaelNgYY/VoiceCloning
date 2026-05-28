import nodemailer from 'nodemailer';

const INFERENCE_BASE_URL = 'https://doovx82fh9tfs.cloudfront.net';

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

function createTransport() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT) || 587;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendTrainingCompleteEmail(email, expName) {
  const transport = createTransport();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  if (!transport || !from) {
    console.warn('[gpu-worker] EMAIL_USER/EMAIL_PASS not configured — skipping training complete email');
    return;
  }

  const inferenceUrl = INFERENCE_BASE_URL;

  await transport.sendMail({
    from,
    to: email,
    subject: `Your voice model is ready: ${expName}`,
    text: [
      `Training is complete, you may now come back to test it.`,
      '',
      `Voice model: ${expName}`,
      '',
      'Visit your inference studio here:',
      inferenceUrl,
    ].join('\n'),
    html: `<p>Training is complete, you may now come back to test it.</p>`
      + `<p>Voice model: <strong>${escapeHtml(expName)}</strong></p>`
      + `<p>Visit your inference studio here:<br>`
      + `<a href="${inferenceUrl}">${inferenceUrl}</a></p>`,
  });
}
