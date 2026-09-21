/**
 * Party codes are six characters from a Crockford-style alphabet: no 0/O, no
 * 1/I/L, no U. A rider reading a code aloud over an intercom at 80 km/h should
 * not be able to mistype it.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export const CODE_LENGTH = 6;

export function generateRideCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Normalises typed input to the code alphabet.
 *
 * Every visually confusable character (0/O, 1/I/L, U/V) is already absent from
 * the alphabet, so there is no safe fold: quietly mapping a stray "0" onto some
 * other letter would resolve a typo to a different real party. Unknown
 * characters are dropped instead, leaving a short code that fails validation
 * and surfaces as an error the rider can act on.
 */
export function normalizeRideCode(input: string): string {
  return [...input.toUpperCase()]
    .filter((char) => ALPHABET.includes(char))
    .join("")
    .slice(0, CODE_LENGTH);
}

export function isValidRideCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((char) => ALPHABET.includes(char));
}

/**
 * The deep link a QR code encodes, e.g. `cruzo://join?code=7KP2QX`.
 *
 * The code travels as a query parameter so a single `app/join.tsx` route
 * serves both the scanner and the link, with no nested route segment.
 */
export function rideCodeToLink(code: string): string {
  return `cruzo://join?code=${code}`;
}

/**
 * Extracts a code from a scanned QR payload.
 *
 * Accepts a Cruzo link in either the query or the path form, or a bare code so
 * that a code pasted as plain text into a chat still scans.
 *
 * The candidate is validated whole rather than filtered through
 * `normalizeRideCode`: stripping unknown characters from arbitrary text would
 * turn any QR code into a plausible-looking ride code — `https://example.com`
 * would reduce to `HTTPSE` and send the rider to a party that does not exist.
 */
export function parseScannedPayload(raw: string): string | null {
  const trimmed = raw.trim();
  let candidate = trimmed;

  const queryMatch = trimmed.match(/[?&]code=([A-Za-z0-9]+)/);
  if (queryMatch) {
    candidate = queryMatch[1];
  } else {
    const marker = "join/";
    const at = trimmed.lastIndexOf(marker);
    if (at !== -1) candidate = trimmed.slice(at + marker.length);
  }

  const upper = candidate.toUpperCase();
  return isValidRideCode(upper) ? upper : null;
}
