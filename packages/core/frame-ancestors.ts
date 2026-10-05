/**
 * Computes the CSP `frame-ancestors` directive value from the
 * FRAME_ANCESTORS environment variable (space-separated origins).
 *
 * Default is `'none'` (no embedding anywhere). To allow a portfolio site to
 * embed the app in an iframe (JobHunter-style showcase), set e.g.
 * `FRAME_ANCESTORS=https://vinaybuilds.me https://www.vinaybuilds.me`.
 *
 * Fail-closed: anything that is not exactly `'none'`, `'self'`, or an
 * `https://host[:port]` origin — including `http:`, wildcards, `data:`,
 * nonces, or `'none'` mixed with other sources — collapses the whole
 * directive back to `'none'`.
 */
export function frameAncestorsDirective(raw: unknown): string {
  if (typeof raw !== "string") return "'none'";
  const tokens = raw.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) return "'none'";
  const valid = (token: string): boolean =>
    token === "'none'" ||
    token === "'self'" ||
    /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(token);
  if (tokens.some((token) => !valid(token))) return "'none'";
  if (tokens.includes("'none'") && tokens.length > 1) return "'none'";
  return [...new Set(tokens)].join(" ");
}
