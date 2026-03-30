
# STOKIO FX — Lighting & Pixel-Mapping Console

## Overview
A world-class lighting console web app with a Control4-inspired dark premium UI, featuring stage mapping, media playback, fixture controls, and node-based logic — all built as a fully interactive UI prototype structured for future real WLED/DMX connectivity.

## Design System
- **Background**: Deep black (#050505) with subtle dark gradients
- **Glassmorphism**: Semi-transparent overlays with backdrop-blur for panels and modals
- **Accent Colors**: Signal Green (#00FF66) for status/active states, Cyan (#00E5FF) for STOKIO branding, Hot Pink (#FF2D78) for FX branding
- **Controls**: Large glossy circular elements with radial gradients and glow effects
- **Typography**: Clean sans-serif (Inter/Geist), thin weights for labels, bold for headers
- **Animations**: Framer Motion for all transitions, smooth spring physics
- **Touch-friendly**: Large hit targets, responsive to both mouse and touch

## Layout Architecture
1. **Left Sidebar** — Icon-based nav with tooltip labels: Stage Builder, Media Server, Text Overlays, Fixture Controls, Node Logic, Devices, Show Runner
2. **Central Main View** — Context-aware panel that swaps based on sidebar selection
3. **Bottom Context Bar** — Persistent: Master Dimmer fader, Blackout button, audio waveform visualizer (canvas-drawn), "Now Playing" media status

## Module 1: Stage Builder (Canvas-based)
- WebGL/Canvas 16:9 workspace with zoom and pan
- Drag WLED device nodes from a side library onto canvas
- Each node: drag to position, handles to resize, rotation control
- Nodes act as viewports sampling the background texture layer
- Live preview of sampled content within each node (mock with CSS patterns/gradients initially)
- Grid snap, alignment guides, coordinate readout

## Module 2: Media Server & Playlist
- Upload area for video/GIF/image files (stored client-side via IndexedDB for prototype)
- Playlist list with drag-and-drop reordering
- Per-item crossfade time slider
- Play/pause/skip controls with progress bar
- Active media renders to the Stage Builder's hidden background layer

## Module 3: Text & Icon Overlays
- Text input with live preview
- Font selector dropdown (Google Fonts subset)
- Emoji/smiley picker panel
- Generated text-strip becomes a draggable layer on the 16:9 canvas
- Color, size, scroll speed controls

## Module 4: Fixture Controls
- **RGBW Color Wheel**: Dual-ring glossy circular picker with inner white ring, outer color ring, glow feedback
- **XY Pad**: Touch-responsive pan/tilt pad with crosshair, home and center buttons
- **Dimmer Sliders**: Vertical glossy faders per channel
- Fixture list with mock devices

## Module 5: Node-Based Logic Editor
- Visual node editor with draggable nodes on a canvas
- **Input nodes**: DMX Channel (ArtNet/sACN), USB-DMX, Audio Peak, WLED Mic
- **Action nodes**: Trigger Scene, Play/Pause, Master Dimmer, Set WLED Segment Color
- SVG cable connections drawn between node ports
- Add/remove nodes from a library panel

## Module 6: Devices Panel
- List/grid of discovered WLED devices (mock data)
- Device cards showing IP, name, LED count, status indicator (green glow)
- Add device manually dialog

## Module 7: Show Runner
- Scene/cue list with play, pause, next controls
- Timeline-style cue sequencer (simplified)
- Go button with large touch target

## Assets
- Copy color logo to src/assets for use in sidebar header
- Use Lucide icons for navigation

## Tech Approach
- Framer Motion for all animations and transitions
- HTML Canvas API for Stage Builder workspace and audio waveform
- React state + context for cross-module communication
- Service layer stubs for WLED API, ArtNet, sACN (mock implementations ready for real swap)
- IndexedDB for media file storage in prototype mode
