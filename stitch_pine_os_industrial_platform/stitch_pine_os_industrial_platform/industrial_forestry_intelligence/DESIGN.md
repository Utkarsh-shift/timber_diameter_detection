---
name: Industrial Forestry Intelligence
colors:
  surface: '#edfdf3'
  surface-dim: '#ceded4'
  surface-bright: '#edfdf3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#e7f7ee'
  surface-container: '#e2f2e8'
  surface-container-high: '#dcece2'
  surface-container-highest: '#d6e6dd'
  on-surface: '#111e19'
  on-surface-variant: '#414845'
  inverse-surface: '#26332d'
  inverse-on-surface: '#e5f5eb'
  outline: '#717975'
  outline-variant: '#c0c8c4'
  surface-tint: '#3f665a'
  primary: '#002920'
  on-primary: '#ffffff'
  primary-container: '#173f35'
  on-primary-container: '#82aa9d'
  inverse-primary: '#a6cfc1'
  secondary: '#326855'
  on-secondary: '#ffffff'
  secondary-container: '#b5efd7'
  on-secondary-container: '#386e5b'
  tertiary: '#182800'
  on-tertiary: '#ffffff'
  tertiary-container: '#293f00'
  on-tertiary-container: '#8cad56'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c1ecdd'
  primary-fixed-dim: '#a6cfc1'
  on-primary-fixed: '#002019'
  on-primary-fixed-variant: '#274e43'
  secondary-fixed: '#b5efd7'
  secondary-fixed-dim: '#9ad2bb'
  on-secondary-fixed: '#002117'
  on-secondary-fixed-variant: '#17503e'
  tertiary-fixed: '#cbef90'
  tertiary-fixed-dim: '#b0d277'
  on-tertiary-fixed: '#121f00'
  on-tertiary-fixed-variant: '#344e00'
  background: '#edfdf3'
  on-background: '#111e19'
  surface-variant: '#d6e6dd'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.005em
  label-numeric:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: -0.01em
  label-code:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0em
  label-dense:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-caption:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-dense: 0.5rem
  margin: 1.5rem
  margin-mobile: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system is engineered for industrial automation, raw material telemetry, and computer vision diagnostics across pulp and paper manufacturing ecosystems. The design combines the rigorous discipline of an industrial SCADA operating system with the focused typographic restraint and micro-interactions of next-generation developer platforms.

### Brand Narrative & Emotional Response
The interface must convey absolute operational trustworthiness, uncompromising data fidelity, and calculated calm. Operators and supply-chain directors handle high-throughput log scanning, moisture classification, moisture-corrected fiber yield analysis, and automated sorting yards. The UI evokes:
- **Mechanical Precision**: Clean geometric hierarchy, deterministic alignment, dense informational density without clutter.
- **Physical-Digital Parity**: Visual cues grounded in the realities of forestry and heavy manufacturing—deep resin greens, weathered slate neutrals, and high-visibility status telemetry.
- **Cognitive Clarity**: Minimal visual noise; high-contrast indicators that instantly draw eyes to anomalies, conveyor belt jams, and pulp quality deviations.

### Visual Architecture
The style leverages **Industrial Minimalist Operating System** aesthetics:
- Fine, structural 1px hairline dividers and bounding boxes for spatial compartmentalization.
- Highly dense, tabular layouts optimized for real-time video analytics feeds, bounding box overlays, and telemetry curves.
- Monospaced typographic accents for numeric values, mill batch IDs, and coordinate stamps to prevent layout shift during high-frequency streaming updates.

## Colors

The palette is tuned for long operational shifts under varied lighting environments, avoiding eye strain while maintaining critical contrast ratios for high-stakes telemetry.

### Core Swatches
- **Primary Deep Forest (`#173F35`)**: The core anchor of the system. Used for primary interactive actions, high-emphasis active navigation states, primary charts, and dominant UI containers.
- **Secondary Dark Emerald (`#245B49`)**: Used for secondary button structures, active telemetry filters, secondary series trends, and grouped container headers.
- **Tertiary Vital Lime/Sage (`#A4C66C`)**: Used sparingly as a high-precision focal accent—computer vision bounding boxes, confidence score high-water markers, live-status pulses, and optimal operating range overlays.
- **Neutral Moss Slate (`#718078`)**: Provides subtle, legible tertiary content, metadata stamps, axis markers, and de-emphasized structural iconography.

### Operational Canvas & Status Colors
- **Canvas Backdrop (`#F5F7F5`)**: High-efficiency, low-glare cool paper tint that grounds the entire screen.
- **Surface Elevation (`#FFFFFF`)**: Pure white base for structural panels, data cards, and telemetry grids.
- **Structural Hairlines (`#E2E8E2`)**: Razor-sharp, low-contrast 1px grid strokes that separate views without visual weight.
- **Primary Readout Text (`#17241F`)**: Deep charcoal with a subtle forest tint, ensuring crisp, ink-like legibility.
- **Warning Amber (`#D69B32`)**: Bark contamination warnings, fiber moisture threshold alerts, and feeder throttle notifications.
- **Alert Red (`#C94C4C`)**: Foreign object detection (metals/stones), conveyor halt interlocks, and defect rejection signals.
- **Telemetry Info Blue (`#2B6CB0`)**: Firmware telemetry, network latency, and camera recalibration status.

## Typography

Typography prioritizes information density and zero-ambiguity optical character recognition across screens.

- **Primary Typeface (`Inter`)**: Deployed for all structural interfaces, narrative titles, dense data grids, and state interactions. Feature tags `cv02`, `cv03`, `cv04` (disambiguated numbers and alternate forms) and `tnum` (tabular numbers) must remain permanently enabled across all table views to prevent cell jitter during numeric streaming.
- **Auxiliary Monospace (`JetBrains Mono`)**: Mandated for coordinate indicators, video frame counters, machine ID hashes, throughput tonnage counters, and JSON inspection panels.
- **Micro-Scale System Labels**: `label-dense` utilizes uppercase transformation with +0.04em letter spacing for industrial metadata headers (e.g., `BATCH: 08-AK`, `YIELD EST.`, `MOISTURE %`).

## Layout & Spacing

The system implements a deterministic 4px base layout rhythm. It prioritizes maximizing operational viewport real estate over whitespace padding.

### Grid & Paneling
- **Desktop (>= 1440px)**: 12-column or 24-column modular split-canvas layout. Left-anchored persistent rail navigation (56px collapsed / 220px expanded), central multi-stream CV feed canvas, and right-docked expandable diagnostic drawer (360px fixed width).
- **Tablet (768px - 1439px)**: Split-screen adaptive mode; side diagnostics collapse into slide-over sheets, telemetry matrices reflow to 2 columns.
- **Mobile (< 768px)**: Single-column linear layout. Video feeds lock to 16:9 aspect ratios with horizontal metric tickers below.

### Density Tiers
- **Comfortable**: `margin` (24px), `space-lg` (16px) inside summary reporting documents and system settings.
- **Dense Telemetry**: `gutter-dense` (8px), `space-sm` (8px), and `space-xs` (4px) inside machine-vision bounding annotation panes, real-time sensor charts, and sorting gate logs.

## Elevation & Depth

To avoid visual fuzziness in industrial control room settings, this system eliminates heavy ambient drop shadows and skeuomorphic gradients in favor of **Crisp Flat Stratification** and **Hairline Outlines**.

### Elevation Scale
- **Level 0 (Base Canvas)**: `#F5F7F5`. The passive background field upon which all work surfaces sit.
- **Level 1 (Card & Module Surfaces)**: `#FFFFFF` bounded by a strict `1px solid #E2E8E2` stroke. Zero shadow blur. Depth is established purely through contour and color differentiation.
- **Level 2 (Interactive Flyouts & Menus)**: `#FFFFFF` bounded by `1px solid #173F3520` accompanied by a micro-shadow: `0 2px 4px rgba(23, 36, 31, 0.04), 0 4px 12px rgba(23, 36, 31, 0.08)`.
- **Level 3 (Modal Dialogs & Critical Alarm Overlays)**: `#FFFFFF` bounded by `1px solid #17241F` with an industrial shadow offset: `0 8px 24px rgba(23, 36, 31, 0.16)`. Accompanied by a 40% opacity dimming backdrop using `#17241F` with a 2px backdrop blur.
- **Overlays & Reticles**: Computer vision visualizer tags and bounding boxes render directly in `#FFFFFF` with semi-translucent 15% `#173F35` fills, outlined by `#A4C66C` (1.5px hard edge) for immediate object isolation.

## Shapes

The design system employs **Soft Linear Geometry (`roundedness: 1`)**. 

- Standard inputs, buttons, chips, and data-table rows use a tight `4px` (`0.25rem`) radius.
- Cards, modal panels, and telemetry containers utilize an `8px` (`0.5rem`) outer radius.
- Computer vision detection tags, live status dots, and pill status counters utilize small micro-radii or standard pill caps (`9999px`) only when indicating binary on/off operational states.
- Internal bounding corners inside machine vision viewfinders remain sharp (`0px`) with accented corner ticks to reinforce camera calibration optics.

## Components

### Buttons
- **Primary Action**: Background `#173F35`, text `#FFFFFF`, 1px solid `#173F35`. On hover, transitions to `#245B49`. On active/pressed, `#0F2A23`. Padding: `6px 12px` for dense, `8px 16px` for standard.
- **Secondary Action**: Background `#FFFFFF`, text `#173F35`, 1px solid `#E2E8E2`. On hover: border `#245B49`, background `#F5F7F5`.
- **Destructive/Emergency**: Background `#FFFFFF`, text `#C94C4C`, 1px solid `#C94C4C33`. On hover: background `#C94C4C`, text `#FFFFFF`.
- **Monospace Tool Action**: Used in camera controls. Square aspect (`32x32px`), `#FFFFFF` surface, border `#E2E8E2`, icon `#173F35`.

### Chips & Industrial Badges
- **Status Indicator Badges**: Composed of a 6px status dot alongside dense monospace metadata.
  - *Nominal/Active*: Dot `#A4C66C` (with subtle pulsing outline), background `#A4C66C15`, text `#245B49`, border `#A4C66C40`.
  - *Warning*: Dot `#D69B32`, background `#D69B3215`, text `#8A5F14`, border `#D69B3240`.
  - *Critical*: Dot `#C94C4C`, background `#C94C4C15`, text `#8A1E1E`, border `#C94C4C40`.
- **Classification Chips**: Background `#F5F7F5`, text `#17241F`, border `#E2E8E2`, uppercase `10px` mono text (e.g., `PINUS TAEDA`, `SPRUCE MIX`, `GRADE-A`).

### Inputs & Selectors
- Background `#FFFFFF`, height `32px` (dense) or `38px` (default), border `1px solid #E2E8E2`, corner radius `4px`.
- Active focus state: border `1px solid #173F35`, box-shadow `0 0 0 1px #173F35`.
- Monospace unit labels (e.g., `kg/m³`, `% moist`, `m/min`) locked to the right margin in `#718078`.

### Checkboxes & Switches
- Checkbox: 16x16px square, 2px radius. Unchecked: 1px border `#E2E8E2`, checked: background `#173F35` with white checkmark.
- Industrial Toggle: 18px height x 32px width track. Neutral `#E2E8E2`, active `#173F35`. Thumb is pure white `#FFFFFF` with 2px inset.

### Tabular Telemetry & Lists
- Table headers: Height `28px`, background `#F5F7F5`, border-bottom `1px solid #E2E8E2`, text `label-dense` in `#718078`.
- Table rows: Height `36px`, border-bottom `1px solid #F0F3F0`. Hover state triggers background `#F5F7F5`.
- Monospaced numeric alignment locked to right edges. Text fields locked left. Status badges centered.

### Computer Vision (CV) HUD Overlay Components
- **Bounding Box Reticle**: 1.5px border `#A4C66C` with 4px extended corner ticks. Semi-transparent `#A4C66C0A` fill.
- **Detection Overlay Flag**: Positioned top-left of the bounding box. `#173F35` solid background, `#FFFFFF` text, `label-code` typography, displaying `CLASS: LOG_DEFECT` and `CONF: 98.4%`.
- **Live Stream Ticker**: Docked at the top right of video canvases. Micro `#C94C4C` dot + `REC [30 FPS] 4K RAW CH-04`.