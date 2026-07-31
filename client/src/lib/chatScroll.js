// How close to the bottom of the transcript still counts as "following along".
// Wide enough to survive a reply growing by a line between two scroll events,
// narrow enough that a student who scrolled up to re-read is left alone.
export const STICK_TO_BOTTOM_THRESHOLD_PX = 64;

/**
 * Whether a scroll viewport is parked at (or near) its bottom.
 *
 * @param {{ scrollTop: number, scrollHeight: number, clientHeight: number }} viewport
 * @param {number} threshold
 * @returns {boolean}
 */
export function isNearBottom(viewport, threshold = STICK_TO_BOTTOM_THRESHOLD_PX) {
  if (!viewport) return false;

  const { scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = viewport;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  return distanceFromBottom <= threshold;
}

/**
 * A key that changes whenever the transcript has visibly grown — a new message,
 * a status change, or more text streaming into the reply that is still arriving.
 * Used as the effect dependency that re-pins the viewport to the bottom.
 *
 * @param {Array<{ id?: string, text?: string }>} messages
 * @param {string} status
 * @returns {string}
 */
export function chatGrowthKey(messages, status = '') {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];

  return [list.length, status, last?.id ?? '', (last?.text ?? '').length].join(':');
}
