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
http://localhost:5000
```

Default port is now `5000`.


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

- Default port changed to `5000`.


## UI v5.1 changes

- Removed the High Contrast theme.
- Removed the separate basemap category.
- The Theme selector now contains only the OpenStreetMap-based map themes: OpenStreetMap Standard, OpenStreetMap Humanitarian, and OpenTopoMap.
- Locked the admin console behind server-side authentication. Admin credentials are never placed in browser JavaScript, HTML, or localStorage.


The protected routes are:

```text
/admin
/admin.html
/admin.js
/api/admin/*
```

Unauthenticated users are redirected to `/admin/login`.
