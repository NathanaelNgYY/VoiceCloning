// Canonical mapping from an NTU email address to the voices that email owns.
// A lecturer may own several voices — a plain one, a calmer one, a second take
// — so the email fixes the base name and an optional label separates them:
// alice-tan, alice-tan_calm, alice-tan_2. Ownership itself is recorded on the
// saved profile rather than inferred from the name, because a name can only
// ever answer "which voice", never "how many".
//
// NTU hands out two addresses for the same mailbox — the SMTP form
// (josephsung@ntu.edu.sg) and the Entra UPN (JOSEPHSUNG@staff.main.ntu.edu.sg).
// Both name one person, so only the local part decides the voice name; the
// domain is validated and then discarded.
//
// This file is duplicated byte-for-byte into the client bundle, the Lambda
// router, and the GPU training worker, which are packaged separately and share
// no module. voiceIdentityParity.test.js fails if the copies drift — copy the
// changed file over the others rather than reconciling them by hand.

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const NTU_DOMAIN_RE = /^(?:[a-z0-9-]+\.)*ntu\.edu\.sg$/u;

// GPT-SoVITS writes the experiment name into weight filenames and S3 keys, so
// it stays well under any path limit.
export const MAX_VOICE_NAME_LENGTH = 64;
export const MAX_VOICE_LABEL_LENGTH = 24;

// Base names and labels are both dash-slugs, so an underscore appears in a
// derived name exactly once: as this separator. That is what makes ownership
// decidable — alice@ntu.edu.sg owns alice and alice_tan, but never alice-tan,
// which belongs to alice.tan@ntu.edu.sg.
const LABEL_SEPARATOR = '_';

// Voices trained before names were derived from email. Their weights already
// sit on S3 under these experiment names and the lecture and GI sites pin the
// resulting profile ids, so the owner is attached to the existing name instead
// of renaming deployed artifacts. Keyed by canonical local part; the names must
// not contain LABEL_SEPARATOR or ownership becomes ambiguous.
const LEGACY_VOICE_OWNERS = new Map([
  ['josephsung', 'DeanVoice'],
]);

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function splitEmail(email) {
  const normalized = normalizeEmail(email);
  if (!EMAIL_SHAPE_RE.test(normalized)) return null;
  const at = normalized.lastIndexOf('@');
  return { localPart: normalized.slice(0, at), domain: normalized.slice(at + 1) };
}

export function isNtuEmail(email) {
  const parts = splitEmail(email);
  return Boolean(parts && NTU_DOMAIN_RE.test(parts.domain));
}

// Plus-addressing is an alias for the same mailbox, so it is stripped before
// slugging — user+lecture@ntu.edu.sg and user@ntu.edu.sg are one lecturer.
export function canonicalLocalPart(email) {
  const parts = splitEmail(email);
  if (!parts) return '';
  return parts.localPart.split('+')[0]
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

// Labels are slugged the same way local parts are, so every derived name is a
// safe path segment whichever half it came from.
export function canonicalLabel(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

// Each half is slugged separately so the separator survives into the id: were
// it flattened to a dash, alice_tan and alice-tan — two lecturers' voices —
// would both become alice-tan-v1 and overwrite each other in storage.
export function buildVoiceProfileId(voiceName) {
  const slug = String(voiceName || '')
    .split(LABEL_SEPARATOR)
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, ''))
    .filter(Boolean)
    .join(LABEL_SEPARATOR);
  return slug ? `${slug}-v1` : '';
}

// Returns the full identity plus the reason it is unusable, so callers can show
// one message instead of re-deriving the rule.
export function describeVoiceIdentity(email, label = '') {
  const normalizedEmail = normalizeEmail(email);
  const normalizedLabel = canonicalLabel(label);
  const invalid = (error) => ({
    valid: false,
    error,
    email: normalizedEmail,
    label: normalizedLabel,
    baseVoiceName: '',
    voiceName: '',
    voiceProfileId: '',
  });

  if (!normalizedEmail) {
    return invalid('Enter your NTU email address.');
  }
  if (!EMAIL_SHAPE_RE.test(normalizedEmail)) {
    return invalid('Enter a valid email address.');
  }
  if (!isNtuEmail(normalizedEmail)) {
    return invalid('Use your NTU email address (an @ntu.edu.sg address).');
  }

  const localPart = canonicalLocalPart(normalizedEmail);
  if (!localPart) {
    return invalid('This email address cannot be used to name a voice.');
  }
  if (localPart.length > MAX_VOICE_NAME_LENGTH) {
    return invalid(`This email address is too long to name a voice (max ${MAX_VOICE_NAME_LENGTH} characters).`);
  }

  if (String(label || '').trim() && !normalizedLabel) {
    return invalid('The label may only contain letters, numbers, and dashes.');
  }
  if (normalizedLabel.length > MAX_VOICE_LABEL_LENGTH) {
    return invalid(`The label may be at most ${MAX_VOICE_LABEL_LENGTH} characters.`);
  }

  const baseVoiceName = LEGACY_VOICE_OWNERS.get(localPart) || localPart;
  const voiceName = normalizedLabel
    ? `${baseVoiceName}${LABEL_SEPARATOR}${normalizedLabel}`
    : baseVoiceName;
  if (voiceName.length > MAX_VOICE_NAME_LENGTH) {
    return invalid(`That name is too long (max ${MAX_VOICE_NAME_LENGTH} characters). Use a shorter label.`);
  }

  return {
    valid: true,
    error: '',
    email: normalizedEmail,
    label: normalizedLabel,
    baseVoiceName,
    voiceName,
    voiceProfileId: buildVoiceProfileId(voiceName),
  };
}

export function voiceNameForEmail(email, label = '') {
  return describeVoiceIdentity(email, label).voiceName;
}

export function voiceProfileIdForEmail(email, label = '') {
  return describeVoiceIdentity(email, label).voiceProfileId;
}

// True when `voiceName` is one of the voices `email` owns — the base name, or
// the base name plus a label. Lets a training run be authorised against a name
// without enumerating every voice that email has already trained.
export function ownsVoiceName(email, voiceName) {
  const candidate = String(voiceName || '').trim();
  if (!candidate) return false;
  const [base, label = '', ...extra] = candidate.split(LABEL_SEPARATOR);
  if (extra.length > 0) return false;
  return describeVoiceIdentity(email, label).voiceName === candidate;
}
