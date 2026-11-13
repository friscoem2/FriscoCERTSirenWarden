# Login help update

The sign in page now includes:

* **Find Username** beside the username label. The expandable email form checks `EmailAddress` against `Username` in the `CERT Members` tab (GID `1506659451`). A single result fills the username field. If one email has multiple usernames, all matching usernames are shown so the volunteer can choose.
* A clickable `sworden@friscotexas.gov` support address when no username is found or the lookup service is unavailable.
* A failed credential counter stored in browser local storage separately for each username. It survives refreshes and resets after successful login. Only rejected credentials (HTTP 401) increase it. Service errors and missing profile access do not increase it. At 10 attempts, volunteers are directed to password reset. The counter is informational and does not impose an account lockout; attempts beyond 10 are still counted. Clearing browser storage or using a different browser starts a separate count. Passwords are never stored.
* **Better Impact password reset** and **New to CERT?** links using the supplied URLs, opening in a separate tab.
* **Username lookup throttle:** up to three valid email submissions per 15 minutes. Matching and unmatched searches both use the allowance. Excess requests receive HTTP 429, a wait message, and the support email. The limit is checked before reading the member directory. Login and password reset remain available.

The new `/api/find-username` endpoint uses the existing server side `GOOGLE_SHEET_ID` and `GOOGLE_SHEETS_API_KEY` configuration. `GOOGLE_SHEET_ID` should continue to identify `1ubqBVVwvNh4hQMifJypJxWDWg8-IixIQWsSpJy_-d5k`. No new environment variables are required. The endpoint returns only the matched usernames and does not return member profiles or the directory to the browser.

The archive contains the complete updated project. Deploy it using the existing Vercel workflow and retain the existing production environment variables. No deployment was performed in this task.

## Lookup throttle

This is a lightweight deterrent with no new dependencies or services. It uses the existing `SESSION_SECRET` to sign a secure HttpOnly browser cookie, plus a bounded server memory counter per IP. Refreshing the page does not reset the browser counter. Within one running server instance, deleting cookies or changing the searched email does not reset the IP counter. The allowance resets 15 minutes after the first counted request; blocked retries do not extend it. Valid submissions that encounter a service failure also use the allowance.

The browser cookie carries its count between Vercel server instances, but IP memory is not shared and is lost on restart. Clearing or replaying cookies while reaching a new instance can bypass this basic protection. This does not identify a physical device or guarantee an installation wide limit. People sharing a public IP share the allowance on a running instance. For strict protection against deliberate enumeration, use Vercel Firewall rate limiting on `/api/find-username` (key: IP, limit: 3, period: 15 minutes) or a shared counter. That hosting setting has not been enabled in this task. See [Vercel rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

## Validation

Run `npm test` (or `node --test`). The tests cover member mapping, request validation, lookup results, service errors, counters, persistence, successful login, blocked browser storage, safe text rendering, duplicate submissions, IP and cookie throttling, cookie tampering, expiry, forwarding header trust, bounded memory, and the HTTP 429 message.

Browser checks used a local test server with fictional member data and simulated invalid credentials. They verified lookup success, no match support, persistence after refresh, the tenth attempt reminder, and the small phone layout. The live spreadsheet tab and headers were confirmed separately. Production credentials and live Better Impact authentication were not exercised.
