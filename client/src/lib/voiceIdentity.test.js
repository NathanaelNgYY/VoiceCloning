import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoiceProfileId,
  canonicalLocalPart,
  describeVoiceIdentity,
  isNtuEmail,
  nextVoiceName,
  ownsVoiceName,
  voiceProfileIdForEmail,
} from './voiceIdentity.js';

test('accepts the NTU domain and every NTU subdomain in use', () => {
  for (const email of [
    'lecturer@ntu.edu.sg',
    'lecturer@staff.main.ntu.edu.sg',
    'student001@student.main.ntu.edu.sg',
    'intern@assoc.main.ntu.edu.sg',
    'someone@e.ntu.edu.sg',
  ]) {
    assert.equal(isNtuEmail(email), true, `${email} should be an NTU address`);
  }
});

test('rejects non-NTU domains and domains that merely contain the NTU one', () => {
  for (const email of [
    'lecturer@gmail.com',
    'lecturer@notntu.edu.sg',
    'lecturer@ntu.edu.sg.attacker.com',
    'lecturer@ntu.edu',
  ]) {
    assert.equal(isNtuEmail(email), false, `${email} should not be an NTU address`);
  }
});

test('resolves the SMTP and Entra UPN forms of one mailbox to the same voice', () => {
  const smtp = describeVoiceIdentity('alice.tan@ntu.edu.sg');
  const upn = describeVoiceIdentity('ALICE.TAN@staff.main.ntu.edu.sg');

  assert.equal(smtp.baseVoiceName, upn.baseVoiceName);
  assert.equal(smtp.voiceProfileId, upn.voiceProfileId);
  assert.equal(smtp.baseVoiceName, 'alice-tan');
  assert.equal(smtp.voiceProfileId, 'alice-tan-v1');
});

test('maps the dean to his already-deployed DeanVoice profile from either address form', () => {
  assert.deepEqual(describeVoiceIdentity('josephsung@ntu.edu.sg'), {
    valid: true,
    error: '',
    email: 'josephsung@ntu.edu.sg',
    baseVoiceName: 'DeanVoice',
    voiceProfileId: 'deanvoice-v1',
  });
  assert.equal(describeVoiceIdentity('JosephSung@staff.main.ntu.edu.sg').baseVoiceName, 'DeanVoice');
  assert.equal(voiceProfileIdForEmail('josephsung@student.main.ntu.edu.sg'), 'deanvoice-v1');
});

test('canonicalises case, surrounding space, and plus-addressing to one local part', () => {
  assert.equal(canonicalLocalPart('  CS-NATHANAEL.NG@assoc.main.ntu.edu.sg '), 'cs-nathanael-ng');
  assert.equal(canonicalLocalPart('alice+lecture@ntu.edu.sg'), 'alice');
  assert.equal(canonicalLocalPart('alice@ntu.edu.sg'), 'alice');
});

test('derived voice names are safe path segments', () => {
  const { baseVoiceName } = describeVoiceIdentity("o'brien.d_r@ntu.edu.sg");
  assert.equal(baseVoiceName, 'o-brien-d-r');
  assert.match(baseVoiceName, /^[A-Za-z0-9._-]+$/u);
});

test('explains why an unusable address was rejected instead of returning a bare failure', () => {
  assert.equal(describeVoiceIdentity('').error, 'Enter your NTU email address.');
  assert.equal(describeVoiceIdentity('not-an-email').error, 'Enter a valid email address.');
  assert.equal(
    describeVoiceIdentity('lecturer@gmail.com').error,
    'Use your NTU email address (an @ntu.edu.sg address).',
  );
  assert.match(describeVoiceIdentity(`${'a'.repeat(65)}@ntu.edu.sg`).error, /too long/u);
  assert.equal(describeVoiceIdentity('+++@ntu.edu.sg').valid, false);
});

test('an invalid address yields no voice name, so callers cannot train under a blank one', () => {
  for (const email of ['', 'nope', 'lecturer@gmail.com', '+++@ntu.edu.sg']) {
    assert.equal(describeVoiceIdentity(email).baseVoiceName, '');
    assert.equal(voiceProfileIdForEmail(email), '');
    assert.equal(nextVoiceName(email, []), '');
  }
});

test('buildVoiceProfileId matches the ids already deployed for legacy voices', () => {
  assert.equal(buildVoiceProfileId('DeanVoice'), 'deanvoice-v1');
  assert.equal(buildVoiceProfileId('AlexV1'), 'alexv1-v1');
  assert.equal(buildVoiceProfileId(''), '');
});

test('every run makes a new voice: the base name first, then the lowest free number', () => {
  assert.equal(nextVoiceName('josephsung@ntu.edu.sg', []), 'DeanVoice');
  assert.equal(nextVoiceName('josephsung@ntu.edu.sg', ['DeanVoice']), 'DeanVoice_2');
  assert.equal(nextVoiceName('josephsung@ntu.edu.sg', ['DeanVoice', 'DeanVoice_2']), 'DeanVoice_3');
  assert.equal(nextVoiceName('alice.tan@ntu.edu.sg', ['alice-tan']), 'alice-tan_2');
});

test('nextVoiceName fills a gap left by a deleted copy rather than always appending', () => {
  assert.equal(
    nextVoiceName('josephsung@ntu.edu.sg', ['DeanVoice', 'DeanVoice_3', 'DeanVoice_4']),
    'DeanVoice_2',
  );
});

test('nextVoiceName ignores other lecturers voices when picking a number', () => {
  const taken = ['DeanVoice', 'alice-tan', 'alice-tan_2', 'Obama'];
  assert.equal(nextVoiceName('josephsung@ntu.edu.sg', taken), 'DeanVoice_2');
  assert.equal(nextVoiceName('alice.tan@ntu.edu.sg', taken), 'alice-tan_3');
});

test('ownsVoiceName covers the base name and numbered copies, and nothing else', () => {
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice'), true);
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_2'), true);
  assert.equal(ownsVoiceName('JOSEPHSUNG@staff.main.ntu.edu.sg', 'DeanVoice_37'), true);

  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_1'), false, 'the first copy is unnumbered');
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_0'), false);
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_02'), false, 'no leading zeros');
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_x'), false);
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_2_3'), false);
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_1000'), false, 'past the copy ceiling');
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'Obama'), false);
  assert.equal(ownsVoiceName('lecturer@gmail.com', 'lecturer'), false, 'not an NTU address');
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', ''), false);
});

test('a numbered copy can never reach a name another lecturer owns', () => {
  // alice2@ntu.edu.sg owns alice2; alice@ntu.edu.sg's copies are alice_2, alice_3…
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'alice2'), false);
  assert.equal(ownsVoiceName('alice2@ntu.edu.sg', 'alice2'), true);
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'alice-2'), false, 'belongs to alice.2@');

  // …and the separator survives into storage, so their ids stay distinct.
  assert.notEqual(buildVoiceProfileId('alice_2'), buildVoiceProfileId('alice-2'));
  assert.equal(buildVoiceProfileId('alice_2'), 'alice_2-v1');
});
