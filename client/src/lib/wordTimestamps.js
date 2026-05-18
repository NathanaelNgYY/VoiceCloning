export function findActiveWordIndex(wordTimestamps, currentTime) {
  if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) return -1;

  let lo = 0;
  let hi = wordTimestamps.length - 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { start, end } = wordTimestamps[mid];

    if (currentTime < start) {
      hi = mid - 1;
    } else if (currentTime >= end) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }

  return -1;
}
