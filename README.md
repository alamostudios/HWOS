# Hazardous Weather Observation System

Public-access weather intelligence starter app for **Fulton County Disaster Response** using free/open weather data.

This version intentionally moves away from the earlier developer-dashboard look and toward a cleaner public-service interface inspired by radar.weather.gov, NWS products, and emergency-management sites.

## Run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost
```

Default port is now `80`. On Windows, run the terminal as Administrator if binding to port 80 is denied. To override it temporarily:

```cmd
set PORT=3001 && npm run dev
```

## Included features

- Node.js + Express backend
- Leaflet frontend
- OpenStreetMap-compatible basemap selector
- Default location: Fulton County, Indiana
- Location selector using OpenStreetMap Nominatim
- Bold selected county/town outline when OSM polygon data is available
- NOAA/NWS time-enabled radar reflectivity overlay
- NWS forecasts from `api.weather.gov`
- NWS alerts, watches, warnings, advisories, and statements
- NWS observation station lookup and latest conditions
- Right-side tabbed public information panel
- Current / Alerts / Forecast / Observations tabs
- NWS-style reflectivity legend in the lower-left corner
- Storm hazard filters: Tornado, Severe Thunderstorm, Flash Flood, Special Weather
- Regular hazard filters: Warnings, Watches, Advisories, Statements
- Alert pop-up notifications
- Browser-generated alert sound effects
- Settings drawer with theme, basemap, radar opacity, units label, and sound controls

## API routes

```text
GET /api/forecast?lat=41.0456&lon=-86.2622
GET /api/alerts?lat=41.0456&lon=-86.2622
GET /api/stations?lat=41.0456&lon=-86.2622
GET /api/observations/latest?station=KRCR
GET /api/geocode?q=Fulton%20County%2C%20Indiana
GET /api/radar/config
GET /api/radar/frames
GET /api/satellite/config
```

## Production notes

1. Default User-Agent values are `weather.alamostudios.net` and `octokid13@gmail.com`. Override with `APP_URL` and `CONTACT_EMAIL` if needed.
2. Do not use free public OSM tile servers for heavy public traffic. Use a compliant provider or self-host tiles.
3. Replace in-memory cache with Redis or another shared cache when deployed.
4. The included radar loop uses the time-enabled NOAA/NWS ImageServer and requests explicit `exportImage` frames. For advanced radar products, build a NEXRAD/MRMS ingest and tile pipeline.

## Next radar upgrade path

```text
NOAA NEXRAD Level II / MRMS
  -> ingest worker
  -> decode/render reflectivity and velocity
  -> Web Mercator XYZ tiles
  -> /tiles/radar/:time/:z/:x/:y.png
  -> Leaflet radar loop
```

## Satellite/lightning upgrade path

```text
GOES-16/18 ABI NetCDF
  -> convert scene to GeoTIFF/COG
  -> reproject to EPSG:3857
  -> generate tiles
  -> Leaflet overlay

GOES GLM
  -> parse flashes/groups/events
  -> filter by bbox/time
  -> GeoJSON points
  -> Leaflet lightning layer
```

## Logo placement

The header now expects an optional static file at:

```text
public/logo.png
```

Drop your agency/county logo at that path and restart/refresh the app. If `logo.png` is missing, the header shows a dashed logo placeholder instead of text branding.

## Branding files

Replace these files with your own artwork when ready:

- `public/logo.png` — main agency/logo slot in the top bar. A transparent placeholder is included.
- `public/tablogo.png` — browser tab icon/favicon. A transparent placeholder is included.

## UI v3 changes

- Single safety-green accent: `#CCFF00`.
- White public-service top bar.
- Removed logo outline and placeholder text.
- Added radar-style playback controls: previous, play/pause, next, refresh.
- Weather auto-refresh no longer recenters or zooms the map.
- Radar layer is explicitly redrawn after pan/zoom to reduce overlay lag.

## UI v4 changes

- Default port changed to `80`.
- Default contact/app identity set to `octokid13@gmail.com` and `weather.alamostudios.net`.
- Radar playback now pulls NOAA/NWS time-enabled ImageServer frames through `/api/radar/frames`.
- Playback uses explicit frame timestamps instead of cycling the latest-only radar service.

## Admin test console

Open `/admin` on the same host to broadcast simulated local alerts to all currently open HWOS clients. The admin page can send preset alert types, custom messages, and preview/select alert sounds. These are browser/SSE test messages only; they do not create official NWS alerts.

## UI v5.1 changes

- Removed the High Contrast theme.
- Removed the separate basemap category.
- The Theme selector now contains only the OpenStreetMap-based map themes: OpenStreetMap Standard, OpenStreetMap Humanitarian, and OpenTopoMap.
- Locked the admin console behind server-side authentication. Admin credentials are never placed in browser JavaScript, HTML, or localStorage.

## Admin login setup

Set these environment variables on the server before starting the app:

```bash
ADMIN_USER=admin
ADMIN_PASSWORD_HASH=<generated-hash>
SESSION_SECRET=<long-random-secret>
npm start
```

Generate `ADMIN_PASSWORD_HASH` locally with:

```bash
npm run hash-password -- your-password-here
```

For quick local testing only, you can use `ADMIN_PASSWORD=your-password-here` instead of `ADMIN_PASSWORD_HASH`. Production should use `ADMIN_PASSWORD_HASH` plus a stable `SESSION_SECRET` so users stay logged in across server restarts.

The protected routes are:

```text
/admin
/admin.html
/admin.js
/api/admin/*
```

Unauthenticated users are redirected to `/admin/login`.

## Fish Audio TTS setup

The alert reader now uses Fish Audio through the Node server, not from browser JavaScript. This keeps the API key private.

Set these environment variables before starting the app:

```bash
FISH_AUDIO_API_KEY=your_fish_audio_api_key
FISH_AUDIO_REFERENCE_ID=ethan_voice_reference_id
FISH_AUDIO_VOICE_NAME=Ethan
FISH_AUDIO_MODEL=s2-pro
```

`FISH_AUDIO_REFERENCE_ID` must be the Fish Audio voice model/reference ID for Ethan. The public UI only shows "Fish Audio — Ethan" and never exposes the key or reference ID. If Fish Audio is not configured or the request fails, the app falls back to the existing Echo/browser TTS options.


## Discord Webhook Alerts

Open Settings in the FCDR page and configure Discord Webhook Alerts. Paste a Discord channel webhook URL, choose Selected Location, Filter, or Spotter Mode, select the alert categories, then save.

Supported filter examples:

- `KRCR`
- `RCR`
- `KIND`
- `[Fulton, IN]`
- `spotter`

Webhook posting is deduped server-side and only posts newly issued alerts after configuration. Administrative messages always post when webhook forwarding is enabled.


## Alert Images / Multi-Alert Popup

Preset event images are served from `public/assets/weather-alerts/`. ntfy and Discord webhook notifications use those images, and map popups now show a clean alert summary with a full NWS API link. Multiple alerts at the same clicked location open an alert picker first.


## Layout framework
This build uses Bootstrap 5.3 from the official jsDelivr CDN for baseline component spacing, button rhythm, form normalization, and responsive behavior. HWOS-specific CSS remains in `public/style.css`, `public/admin.css`, and `public/tv.css` only for product colors, map overlay placement, and weather-specific modules.
