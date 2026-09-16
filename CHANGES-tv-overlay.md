# TV Overlay

Added a streamable TV overlay page.

## Routes

- `/tv.html/<region>`
- `/tv/<region>`

## Region examples

- `/tv.html/spotter` — all active alerts, with Global Storm Alerts and Alerts for current map focus.
- `/tv.html/RCR` — uses KRCR station location and local alerts.
- `/tv.html/KRCR` — same station-specific local alerts.
- `/tv.html/IWX` — NWS office alert feed when station resolution fails.
- `/tv.html/%5BFulton%2C%20IN%5D` — county/state style filter.

## Behavior

- Designed for OBS/browser-source or TV display.
- No selection controls.
- Keeps the main HWOS visual style.
- Pans to new alerts as they arrive.
- Opens a large TV alert card for new alerts.
- Alert card closes after one minute or is replaced by the next new alert.
- Spotter mode shows global high-impact storm alerts plus alerts for the current map focus.
