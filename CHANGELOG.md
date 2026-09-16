# Changelog

## 1.0.2

- Replace the cropped animation preview with a full-card GIF showing the header, mower animation, battery, metrics and controls.
- Includes the parked-while-charging detection fix from 1.0.1.

## 1.0.1

- Show the charging animation and badge when a docked mower reports positive remaining charging time, even if its activity stays `parked`.
- Return to the parked display when remaining charging time reaches zero. Mowing, returning, paused, error and unavailable states retain their priority.

## 1.0.0

First standalone HACS release, based on the local v13 card.

- Animated status with garage and docked images, charging, mowing, spot cutting, returning, paused and error overlays.
- Spot Cut and permanent parking controls on Overview.
- Inline switches, selectors and validated numeric settings.
- Station mowing share, starting-point settings, onboard schedule and grouped diagnostics.
- Stable controls during telemetry updates and reduced-motion support.
- Flat HACS asset distribution with release-versioned asset URLs and no external runtime CDN.
- Domain-specific spot-cut sensor discovery and entity overrides.
