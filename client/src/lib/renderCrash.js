/**
 * Turns whatever React handed the error boundary into something safe to show.
 *
 * A boundary that throws while rendering its own fallback re-throws past itself
 * and blanks the page anyway — the exact failure it exists to prevent — so
 * nothing here may assume it was given an Error. React passes through whatever
 * was thrown, and `throw "..."`, `throw null`, and a rejected non-Error all
 * reach this function.
 */
export function describeRenderCrash(error) {
  if (error instanceof Error) {
    const name = error.name || "Error";
    const message = String(error.message || "").trim();
    return message ? `${name}: ${message}` : name;
  }

  if (typeof error === "string" && error.trim()) return error.trim();

  // Objects are the trap: String({}) is "[object Object]", which tells a reader
  // nothing and looks like a second bug. Restricted to objects on purpose —
  // JSON.stringify("") is the string `""`, which would turn an empty throw into
  // punctuation rather than an explanation.
  if (typeof error === "object" && error !== null) {
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}" && serialized !== "null") {
        return serialized;
      }
    } catch {
      // Circular, or a getter that throws. Fall through to the generic label.
    }
  }

  return "Unknown error";
}
