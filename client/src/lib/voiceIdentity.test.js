import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoiceProfileId,
  canonicalLocalPart,
  describeVoiceIdentity,
  isNtuEmail,
  ownsVoiceName,
  voiceNameForEmail,
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

  assert.equal(smtp.voiceName, upn.voiceName);
  assert.equal(smtp.voiceProfileId, upn.voiceProfileId);
  assert.equal(smtp.voiceName, 'alice-tan');
  assert.equal(smtp.voiceProfileId, 'alice-tan-v1');
});

test('maps the dean to his already-deployed DeanVoice profile from either address form', () => {
  assert.deepEqual(describeVoiceIdentity('josephsung@ntu.edu.sg'), {
    valid: true,
    error: '',
    email: 'josephsung@ntu.edu.sg',
    label: '',
    baseVoiceName: 'DeanVoice',
    voiceName: 'DeanVoice',
    voiceProfileId: 'deanvoice-v1',
  });
  assert.equal(voiceNameForEmail('JosephSung@staff.main.ntu.edu.sg'), 'DeanVoice');
  assert.equal(voiceProfileIdForEmail('josephsung@student.main.ntu.edu.sg'), 'deanvoice-v1');
});

test('canonicalises case, surrounding space, and plus-addressing to one local part', () => {
  assert.equal(canonicalLocalPart('  CS-NATHANAEL.NG@assoc.main.ntu.edu.sg '), 'cs-nathanael-ng');
  assert.equal(canonicalLocalPart('alice+lecture@ntu.edu.sg'), 'alice');
  assert.equal(canonicalLocalPart('alice@ntu.edu.sg'), 'alice');
});

test('derived voice names are safe path segments', () => {
  const { voiceName } = describeVoiceIdentity("o'brien.d_r@ntu.edu.sg");
  assert.equal(voiceName, 'o-brien-d-r');
  assert.match(voiceName, /^[A-Za-z0-9._-]+$/u);
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
    assert.equal(voiceNameForEmail(email), '');
    assert.equal(voiceProfileIdForEmail(email), '');
  }
});

test('buildVoiceProfileId matches the ids already deployed for legacy voices', () => {
  assert.equal(buildVoiceProfileId('DeanVoice'), 'deanvoice-v1');
  assert.equal(buildVoiceProfileId('AlexV1'), 'alexv1-v1');
  assert.equal(buildVoiceProfileId(''), '');
});

test('one lecturer can own several voices, separated by an optional label', () => {
  assert.equal(voiceNameForEmail('josephsung@ntu.edu.sg'), 'DeanVoice');
  assert.equal(voiceNameForEmail('josephsung@ntu.edu.sg', '2'), 'DeanVoice_2');
  assert.equal(voiceNameForEmail('alice.tan@ntu.edu.sg', 'Calm Voice'), 'alice-tan_calm-voice');

  assert.equal(voiceProfileIdForEmail('josephsung@ntu.edu.sg', '2'), 'deanvoice_2-v1');
});

test('the label separator survives into the profile id so two lecturers cannot collide', () => {
  // alice@ntu.edu.sg labelling a voice "tan" must not land on the voice owned
  // by alice.tan@ntu.edu.sg.
  const labelled = describeVoiceIdentity('alice@ntu.edu.sg', 'tan');
  const other = describeVoiceIdentity('alice.tan@ntu.edu.sg');

  assert.equal(labelled.voiceName, 'alice_tan');
  assert.equal(other.voiceName, 'alice-tan');
  assert.notEqual(labelled.voiceProfileId, other.voiceProfileId);
  assert.equal(labelled.voiceProfileId, 'alice_tan-v1');
  assert.equal(other.voiceProfileId, 'alice-tan-v1');
});

test('ownsVoiceName covers every voice an email can produce and nothing else', () => {
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'alice'), true);
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'alice_tan'), true);
  assert.equal(ownsVoiceName('ALICE@staff.main.ntu.edu.sg', 'alice_2'), true);
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice'), true);
  assert.equal(ownsVoiceName('josephsung@ntu.edu.sg', 'DeanVoice_2'), true);

  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'alice-tan'), false, 'belongs to alice.tan@');
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'bob'), false);
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'alice_a_b'), false, 'only one separator is derivable');
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', 'Alice'), false, 'derived names are lowercase');
  assert.equal(ownsVoiceName('alice@gmail.com', 'alice'), false, 'not an NTU address');
  assert.equal(ownsVoiceName('alice@ntu.edu.sg', ''), false);
});

test('rejects a label that cannot be slugged or is too long', () => {
  assert.equal(
    describeVoiceIdentity('alice@ntu.edu.sg', '!!!').error,
    'The label may only contain letters, numbers, and dashes.',
  );
  assert.match(describeVoiceIdentity('alice@ntu.edu.sg', 'x'.repeat(25)).error, /at most 24 characters/u);
  assert.equal(describeVoiceIdentity('alice@ntu.edu.sg', '   ').valid, true, 'blank label is simply no label');
});

test('a labelled name still fits the length budget', () => {
  const longLocalPart = 'a'.repeat(60);
  assert.match(
    describeVoiceIdentity(`${longLocalPart}@ntu.edu.sg`, 'lecture').error,
    /too long/u,
  );
});
