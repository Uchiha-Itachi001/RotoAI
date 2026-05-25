# RotoAI — UI Finetune & Magic Mask Parity Spec

> **Purpose:** This document tells the AI agent exactly how the UI must look and behave to replicate DaVinci Resolve's Magic Mask (Studio v20) experience.  
> **Read alongside:** PRD.md (screens) and IMPLEMENTATION_PLAN.md (code).  
> **Rule:** Every interaction described here maps 1:1 to a Magic Mask behavior. Nothing is invented.

---

## 1. The Core Philosophy (Read This First)

DaVinci Magic Mask's UX principle is: **one rough action → AI does the rest.**

The user never draws a precise outline. They just:
1. Paint a rough stroke OR click a point on the subject
2. Hit Track
3. AI isolates + tracks the full subject across all frames

RotoAI must feel the same. The canvas is never about precision — it's about intent. The AI fills in the rest. If the user has to be careful or accurate, the UX has failed.

---

## 2. Tool Modes — Toolbar (Top of Canvas)

The toolbar sits at the top of the canvas, always visible. It has exactly these tools in this order:

```
[ + Add ]  [ − Subtract ]  [ 🖌 Paint+ ]  [ 🖌 Paint− ]  [ ↩ Undo ]  [ 🗑 Clear All ]  [ ⊘ Invert ]  [ 👁 Overlay ]
```

### 2.1 Add Tool (default active)

- **Icon:** `+` or eyedropper with green tint
- **Cursor:** crosshair with green dot
- **Action:** Single click on any part of subject → SAM 2 generates mask for that object
- **Visual feedback:** Green dot appears where clicked. Mask overlay appears immediately (within ~500ms for preview)
- **Multiple clicks:** Each additional click expands/refines the selection
- **Keyboard shortcut:** `A`

> **Magic Mask equivalent:** The "Add" eyedropper — single click isolates the entire subject. <br>
> Source behavior: *"Use the 'Add' eyedropper tool and simply click on the subject you want to isolate."*

---

### 2.2 Subtract Tool

- **Icon:** `−` or eyedropper with red tint
- **Cursor:** crosshair with red dot
- **Action:** Single click on area to EXCLUDE from mask → SAM 2 updates mask removing that region
- **Visual feedback:** Red dot appears. Mask redraws immediately excluding that area
- **Use case:** Subject is holding a bag — click the bag to exclude it. Background object bleeding into mask — click it to remove
- **Keyboard shortcut:** `S`

> **Magic Mask equivalent:** *"If the mask initially grabs too much, use the 'Subtract' tool to click on areas you want to exclude."*

---

### 2.3 Paint Add Brush

- **Icon:** Paint brush with `+`
- **Cursor:** circle brush cursor (size adjustable)
- **Action:** Paint/drag over missed areas → those pixels added to mask
- **Visual feedback:** Green brush stroke visible while painting. Mask updates on mouse-up
- **Brush size:** Scrollwheel or `[` `]` keys to resize
- **Use case:** Hair edges, fine details, fingers that the click missed
- **Keyboard shortcut:** `B`

> **Magic Mask v2 equivalent:** *"Paint tools for quick manual touch-ups on specific frames."* <br>
> DaVinci v20 added this as a major feature upgrade.

---

### 2.4 Paint Subtract Brush

- **Icon:** Paint brush with `−`
- **Cursor:** circle brush cursor with red tint
- **Action:** Paint over areas to REMOVE from mask
- **Visual feedback:** Red brush stroke while painting. Mask updates on mouse-up
- **Keyboard shortcut:** `X`

> **Magic Mask equivalent:** *"You can paint a subtractive stroke (red) over parts of the image you don't want masked."*

---

### 2.5 Undo

- **Icon:** `↩`
- **Action:** Removes last added point or stroke
- **Scope:** Undoes points/strokes, NOT the mask regeneration (mask auto-updates after undo)
- **Keyboard shortcut:** `Ctrl+Z`

---

### 2.6 Clear All

- **Icon:** `🗑`
- **Action:** Removes all points and strokes, clears mask overlay
- **Confirmation:** Single click — no confirmation dialog (Magic Mask behavior, fast workflow)

---

### 2.7 Invert Mask

- **Icon:** `⊘` or two overlapping circles
- **Action:** Flips the mask — previously masked area becomes unmasked and vice versa
- **Use case:** User wants to affect background instead of subject
- **Visual feedback:** Mask overlay instantly inverts
- **Keyboard shortcut:** `I`

> **Magic Mask equivalent:** *"Invert Mask toggle"* in the toolbar.

---

### 2.8 Overlay Toggle

- **Icon:** `👁`
- **Action:** Toggles the colored mask overlay on/off so user can see the original clip clearly
- **Default:** ON
- **Keyboard shortcut:** `O` or `~`

> **Magic Mask equivalent:** *"Toggle Mask Overlay"* button.

---

## 3. Mask Overlay Visual

This is critical — it must look like Magic Mask's red onionskin, adapted to RotoAI's color system.

### 3.1 Default Overlay Style

```
Masked area:     Semi-transparent purple  rgba(108, 99, 255, 0.45)
Unmasked area:   Original video frame     (no tint)
Edge:            Subtle white outline     1px, rgba(255,255,255,0.6)
```

### 3.2 Overlay Modes (toggle in settings panel)

| Mode | Description |
|---|---|
| **Color Overlay** (default) | Subject tinted purple. Background normal. |
| **Highlight** | Subject bright, background darkened 60% |
| **Outline Only** | Just the mask edge, no fill |
| **Black & White** | White = masked, Black = unmasked |

> **Magic Mask equivalent:** *"A red onionskin overlay lets you see what Magic Mask is isolating."* <br>
> RotoAI uses purple instead of red to match the app's design language.

### 3.3 Overlay Updates

- After every click (Add/Subtract) → mask preview regenerates → overlay updates within 500ms
- While painting → overlay updates on mouse-up (not during drag, too expensive)
- During full video propagation → overlay shows current frame being processed

---

## 4. Stroke / Point List Panel (Right Sidebar)

Sits on the right side of the Canvas screen. Shows every prompt the user has added.

```
┌─────────────────────────────┐
│  STROKES & POINTS           │
├─────────────────────────────┤
│  ● Add Point    (120, 340)  │  ← green dot
│  ● Add Point    (200, 180)  │  ← green dot
│  ● Subtract     (90,  420)  │  ← red dot
│  🖌 Paint+  frame 1         │  ← brush stroke entry
├─────────────────────────────┤
│  [Delete Selected]          │
│  [Clear All]                │
└─────────────────────────────┘
```

- Each entry is clickable → highlights the corresponding dot/stroke on canvas
- Each entry has an `×` delete button on hover
- Deleting a point → mask automatically regenerates
- Stroke entries show frame number (relevant after tracking, for per-frame edits)

> **Magic Mask equivalent:** The stroke list panel where individual strokes can be selected and repositioned or deleted.

---

## 5. Mask Finesse Panel (Right Sidebar — below Stroke List)

This is the equivalent of Magic Mask's **Mask Finesse** section. These are post-processing sliders that clean up the mask edges after AI generation. They do NOT re-run SAM 2 — they apply quick image processing on the mask output.

```
┌─────────────────────────────┐
│  MASK FINESSE               │
├─────────────────────────────┤
│  Smoothing        [ 0 ──●── 100 ] │
│  Denoise          [ 0 ──●── 100 ] │
│  Blur Radius      [ 0 ──●── 100 ] │
│  Edge Expand      [-50 ─●─  50  ] │  (Shrink ↔ Grow)
│  Clean Black      [ 0 ──●── 100 ] │
│  Clean White      [ 0 ──●── 100 ] │
│  In/Out Ratio     [-1  ─●─   1  ] │
└─────────────────────────────┘
```

### Slider Behavior

| Slider | What it does | Magic Mask name |
|---|---|---|
| **Smoothing** | Fixes jagged contour lines on mask edge | Smoothing |
| **Denoise** | Reduces mask flickering frame to frame | Denoise |
| **Blur Radius** | Softens hard mask edges (feathering) | Blur Radius |
| **Edge Expand** | Positive = grow mask outward. Negative = shrink | Radius (Grow/Shrink) |
| **Clean Black** | Removes small speckles from background | Clean Black |
| **Clean White** | Fills small holes inside subject area | Clean White |
| **In/Out Ratio** | Shifts blur to inside or outside edge | In/Out Ratio |

> All sliders update mask overlay in real-time (debounced 150ms) — no Apply button needed.

> **Magic Mask equivalent:** *"Smoothing fixes jagged contour lines. Denoise reduces flickering. Blur Radius softens edges. Clean Black removes specks. Clean White fills holes."*

---

## 6. Tracking Controls Panel

Sits below the canvas, center. This is the "Track" section — the equivalent of Magic Mask's forward/reverse tracking buttons.

```
┌──────────────────────────────────────────────────────────────┐
│  ◀◀ Track Backward   |  ◀ Step Back  |  ▶ Step Fwd  |  Track Forward ▶▶  │
└──────────────────────────────────────────────────────────────┘
```

### 6.1 Track Forward (primary action)

- **Button:** Large, accent-colored (purple). Primary CTA.
- **Action:** Runs SAM 2 video predictor from current frame to end of clip
- **During tracking:** Button becomes "Stop" button. Progress shown inline.
- **Keyboard shortcut:** `Enter` or `T`

### 6.2 Track Backward

- **Action:** Runs SAM 2 propagation from current frame backwards to frame 0
- **Use case:** User scrubbed to middle of clip, added points there, wants to track back

### 6.3 Step Forward / Step Back

- **Action:** Move one frame at a time
- **Use case:** Check mask quality on a specific frame, add a correction point there
- **Keyboard:** `→` / `←` arrow keys

### 6.4 Frame Scrubber

Below the tracking buttons — a timeline scrubber showing all frames.

```
|━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━|
0                    47/120              120
```

- Drag to scrub to any frame
- Frames with mask corrections shown as small marker dots on scrubber
- Click any frame to jump to it and see/edit mask for that frame

> **Magic Mask equivalent:** *"Track Forward and Reverse buttons. Frame-by-frame tracking controls."*

---

## 7. Quality Setting

Two-option toggle in the top-right of the canvas panel:

```
Quality:  [ Faster ]  [ Better ]
```

- **Faster:** Uses SAM 2.1 Base+ checkpoint. Faster inference, slightly less accurate edges.
- **Better:** Uses SAM 2.1 Large checkpoint. Slower but cleaner edges, better on complex subjects.
- Default: **Faster**
- Changing this setting clears existing mask and requires re-tracking

> **Magic Mask equivalent:** *"Quality: 'Faster' vs 'Better' — balance speed and accuracy."*

---

## 8. Auto-Subject Detection (One-Click Mode)

This is the "too simple" feature — the closest thing to Magic Mask's single-click auto-isolation.

### How it works:

When the user clicks **anywhere** on the canvas in Add mode:
1. SAM 2 runs on that frame with the clicked point
2. SAM 2 auto-detects the full object/person at that location
3. Mask overlay appears covering the entire detected subject
4. User sees the result in <500ms

The user does NOT need to:
- Draw around the subject
- Define a bounding box
- Be precise about where they click — clicking anywhere on a person isolates the whole person

### Multi-subject support:

- Each additional Add click can select a new object
- Each selected object gets its own color overlay tint (up to 4 subjects)
- Each subject listed separately in the Stroke List panel
- Each subject tracked independently

> **Magic Mask equivalent:** *"The dot-clicky-thingy actually works great most the time. Easy to just grab a detail too, like just the hair with one click."*

---

## 9. Per-Frame Correction Workflow

This is how Magic Mask handles imperfect frames mid-clip — and RotoAI must match it.

### Scenario: Mask loses subject at frame 67

1. User scrubs to frame 67 using timeline scrubber
2. Canvas shows frame 67 with bad/missing mask
3. User clicks Add tool → clicks on subject in frame 67
4. SAM 2 re-runs for that frame only, corrects the mask
5. User hits Track Forward to re-propagate from frame 67 onward
6. Correction dot appears on frame 67 in the timeline scrubber

### Rules:
- Frame corrections are additive — adding a point at frame 67 does not erase points at frame 0
- Each frame can have its own set of correction points
- Tracking re-run from any corrected frame forward
- Corrections stored in session state: `{ frame_idx: [{x, y, label}] }`

> **Magic Mask equivalent:** *"If there are areas that aren't quite right, you can go back to the Mask Finesse tools and make adjustments. Track this again after corrections."*

---

## 10. Consistency Slider (Anti-Flicker)

A single dedicated slider in the Mask Finesse panel, separate from Denoise:

```
Consistency  [ 0 ─────●──── 100 ]
```

- **What it does:** Temporally smooths mask between adjacent frames to remove edge jitter/flicker
- **Default:** 30
- **High value:** Mask very stable but may lag on fast movement
- **Low value:** Mask responds quickly but may flicker on edges
- Applied as post-process after SAM 2 propagation (no re-tracking needed)

> **Magic Mask equivalent:** *"Consistency helps smooth out edge jitter over time — crucial for elements like hair."*

---

## 11. Smart Refine Toggle

A checkbox in the Mask Finesse panel:

```
☑ Smart Refine  (improves hair / fur edges)
```

- When ON: Runs MatAnyone on top of SAM 2 mask to extract fine hair/fur detail
- When OFF: Uses raw SAM 2 mask output
- Default: OFF (slower when ON)
- Automatically grayed out if MatAnyone is not installed

> **Magic Mask equivalent:** *"Smart Refine: Improves the detail of edges (hair/fur)."*

---

## 12. Complete Canvas Screen Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ NAVBAR: RotoAI logo   |   Session name   |   Quality [Faster][Better]  │
├──────────────────────────────────┬─────────────────────────────────────┤
│                                  │  TOOLBAR                            │
│  TOOLBAR                         │  [+Add][-Sub][🖌+][🖌-][↩][🗑][⊘][👁] │
│  [+Add][-Sub][🖌+][🖌-][↩][🗑][⊘][👁]│                                     │
├──────────────────────────────────┤  STROKES & POINTS                   │
│                                  │  ────────────────                   │
│                                  │  ● Add  (120, 340)    ×             │
│                                  │  ● Add  (200, 180)    ×             │
│      VIDEO FRAME                 │  ● Sub  (90,  420)    ×             │
│      (canvas with overlay)       │  ────────────────                   │
│                                  │  [Delete Selected] [Clear All]      │
│                                  │                                     │
│                                  │  MASK FINESSE                       │
│                                  │  ────────────────                   │
│                                  │  Smoothing    [────●────]           │
│                                  │  Denoise      [────●────]           │
│                                  │  Consistency  [────●────]           │
│                                  │  Blur Radius  [────●────]           │
│                                  │  Edge Expand  [──●──────]           │
│                                  │  Clean Black  [────●────]           │
│                                  │  Clean White  [────●────]           │
│                                  │  ☑ Smart Refine (hair/fur)          │
│                                  │                                     │
├──────────────────────────────────┴─────────────────────────────────────┤
│  ◀◀ Track Back  |  ◀ Step  |   Frame: 47 / 120   |  Step ▶  |  Track ▶▶  │
│  |━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━| │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 13. State the AI Agent Must Maintain

```js
// Canvas screen state — complete spec
{
  sessionId: string,
  frameB64: string,              // current displayed frame
  currentFrame: number,          // 0-indexed
  totalFrames: number,
  fps: number,
  originalWidth: number,
  originalHeight: number,

  activeToolMode: "add" | "subtract" | "paintAdd" | "paintSubtract",
  brushSize: number,             // px, for paint tools
  overlayVisible: boolean,
  overlayMode: "color" | "highlight" | "outline" | "bw",
  qualityMode: "faster" | "better",

  // Points per frame — frame corrections
  framePoints: {
    [frameIdx]: [{ x, y, label }]   // label: 1=fg, 0=bg
  },

  // Current frame's mask
  currentMaskB64: string | null,

  // Finesse values
  finesse: {
    smoothing: 0-100,
    denoise: 0-100,
    consistency: 0-100,
    blurRadius: 0-100,
    edgeExpand: -50 to 50,
    cleanBlack: 0-100,
    cleanWhite: 0-100,
    smartRefine: boolean
  }
}
```

---

## 14. Interaction Rules Summary

| User Action | What Happens | Latency Target |
|---|---|---|
| Click (Add tool) | SAM 2 single frame → mask preview | < 500ms |
| Click (Subtract tool) | SAM 2 update → mask redraws | < 500ms |
| Paint stroke | Mask updates on mouse-up | < 300ms |
| Adjust finesse slider | Mask post-process updates | < 150ms (debounced) |
| Toggle overlay | Overlay shows/hides | Instant |
| Invert mask | Mask inverts | Instant |
| Track Forward | SAM 2 video propagation starts | Progress shown |
| Scrub to frame | Frame loads + mask for that frame shown | < 200ms |
| Delete point | Mask regenerates without that point | < 500ms |

---

## 15. What Magic Mask Does That RotoAI Must Also Do

Checklist for the AI agent — every item below must be implemented:

```
[ ] Single click isolates entire subject (not just the clicked pixel)
[ ] Green dots for add points, red dots for subtract points
[ ] Mask overlay appears within 500ms of any click
[ ] Paint brush for adding fine detail areas
[ ] Paint brush for subtracting unwanted areas
[ ] Brush size adjustable by scrollwheel
[ ] Mask overlay toggles on/off
[ ] Mask can be inverted
[ ] Track Forward button propagates across all frames
[ ] Track Backward button propagates to frame 0
[ ] Frame scrubber to navigate to any frame
[ ] Per-frame correction points (different points on different frames)
[ ] Re-track from a corrected frame forward
[ ] Smoothing slider (fixes jagged edges)
[ ] Denoise slider (reduces flicker)
[ ] Blur Radius slider (feathers edges)
[ ] Edge Expand slider (shrink/grow mask)
[ ] Clean Black slider (removes speckles)
[ ] Clean White slider (fills holes)
[ ] Consistency slider (anti-flicker temporal smoothing)
[ ] Smart Refine toggle (MatAnyone for hair)
[ ] Quality toggle: Faster vs Better
[ ] Stroke list panel showing all points with delete
[ ] Undo last point/stroke
[ ] Clear all points
[ ] Multiple subjects selectable (different color tints per subject)
```
