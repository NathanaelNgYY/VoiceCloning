// Words that are BOTH a real English word AND an acronym. The CMU real-word check
// alone would mis-classify these as emphasis, so they are forced to spell out.
// List ONLY these collisions — pure acronyms (ECG, MRI, COPD, ICU) are detected
// automatically by the not-a-real-word rule and need no entry here.
export const ACRONYM_OVERRIDES = new Set([
  'WHO',   // World Health Organization (vs. the word "who")
  'AIDS',  // acquired immunodeficiency syndrome (vs. the word "aids")
  'US',    // ultrasound / United States (vs. the word "us")
]);
