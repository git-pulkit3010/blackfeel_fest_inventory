# Design System: High-End Editorial E-Commerce

## 1. Overview & Creative North Star
**The Creative North Star: "The Nocturnal Curator"**

This design system is built to evoke the atmosphere of a private, high-end atelier at midnight. We are moving away from the "template-heavy" world of standard e-commerce. Instead of a rigid grid of boxes, we treat the screen as an editorial spread. 

The goal is **Atmospheric Depth**. By utilizing a sophisticated dark palette and a "No-Line" philosophy, we create an environment where products don't just sit on a page—they are emerged from it. We break the digital "flatness" through intentional asymmetry, overlapping high-fashion imagery, and a typography scale that favors dramatic contrast between monumental serifs and whisper-quiet functional labels.

---

## 2. Colors: Tonal Depth & Metallic Accents
We avoid pure black (#000000) to prevent a "cheap" digital feel. Instead, we use `surface` (#111317), a deep midnight charcoal that provides a more natural, ink-like depth.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders to section off content. Sectioning must be achieved through:
- **Background Shifts:** Moving from `surface` to `surface-container-low` (#1a1c20).
- **Negative Space:** Utilizing the larger tiers of our spacing scale (e.g., `16` or `20`) to create a mental boundary.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of fine material.
- **Base Layer:** `surface` (#111317) for the main page background.
- **Secondary Sectioning:** `surface-container-lowest` (#0c0e12) for deeply recessed areas like footers.
- **Elevated Content:** `surface-container` (#1e2024) or `surface-container-high` (#282a2e) for product cards and modals.

### The "Glass & Gradient" Rule
To add a "soul" to the interface, use Glassmorphism for floating navigation bars or quick-buy overlays. Apply `surface-variant` (#333539) at 60% opacity with a 20px backdrop blur. 
**Signature CTA:** Use a subtle radial gradient for primary buttons, transitioning from `primary` (#e9c176) at the center to `on-primary-container` (#9b7937) at the edges to mimic the sheen of brushed gold.

---

## 3. Typography: Editorial Authority
The typography is a dialogue between heritage (Serif) and modern utility (Sans-Serif).

- **Display & Headlines (Noto Serif):** Used for brand storytelling and product titles. `display-lg` (3.5rem) should be used with tight letter-spacing (-0.02em) to create a bold, authoritative "editorial" look.
- **UI & Navigation (Manrope):** Used for all functional elements. `label-md` (0.75rem) should be set in All Caps with increased letter-spacing (0.1em) to maintain readability and a "minimalist luxury" feel.
- **Body Text:** `body-lg` (1rem) in Manrope. Ensure a line-height of 1.6 to allow the text to breathe against the dark background.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are too "software-like" for this brand. We use **Tonal Layering** to create hierarchy.

- **The Layering Principle:** To lift a product card, do not add a shadow. Instead, place a `surface-container-high` (#282a2e) card on a `surface` (#111317) background. The subtle shift in hex value creates a "soft lift."
- **Ambient Shadows:** Only for top-level floating elements (like a cart drawer). Use a 40px blur, 0px offset, and 6% opacity of `on-primary-fixed` (#261900). This mimics natural light reflecting off gold accents.
- **The Ghost Border Fallback:** If a boundary is required for accessibility, use the `outline-variant` (#45464b) at **15% opacity**. It should be felt, not seen.

---

## 5. Components: Refined Interaction

### Buttons
- **Primary:** Background: `primary` (#e9c176). Text: `on-primary` (#412d00). Shape: `DEFAULT` (0.25rem). The slight rounding feels more bespoke than sharp corners or pills.
- **Secondary (The Ghost):** No background. `Ghost Border` (outline-variant at 20%) with `primary` text.
- **Tertiary:** Text only, using `label-md` style with an underline that appears only on hover.

### Cards & Product Grids
- **Forbid Dividers:** Never use lines between products. Use `spacing-8` (2.75rem) as the minimum gutter.
- **Asymmetric Layouts:** In lookbooks, mix card sizes. Use a `2:1` ratio where one featured image spans two columns, creating an editorial rhythm.

### Input Fields
- **Styling:** Minimalist bottom-border only using `outline` (#909096). Upon focus, the border transitions to `primary` (#e9c176).
- **Labels:** Always use `label-sm` floating above the input to maintain a clean "boutique" aesthetic.

### Additional Signature Components
- **The "Curated" Carousel:** A horizontal scroll list where the center image is slightly larger (`scale: 1.05`) and uses a higher surface tier than the flanking images.
- **The Gold Accent Micro-interaction:** Small icons (wishlist, cart) should subtly transition from `secondary` (#c4c6cc) to `primary` (#e9c176) with a soft glow effect on hover.

---

## 6. Do's and Don'ts

### Do
- **Do** embrace "Wasted Space." Use the `20` and `24` spacing tokens to separate major sections.
- **Do** use high-contrast imagery. Photos should have deep blacks and warm highlights to match the `primary` gold accents.
- **Do** use `tertiary` (#d7c3b0) for secondary text (like "Sold Out" or "Limited Edition") to provide a sophisticated, muted contrast.

### Don't
- **Don't** use pure white (#FFFFFF). Use `on-surface` (#e2e2e8) for all "white" text to reduce eye strain on dark backgrounds.
- **Don't** use standard "Full" rounded corners (9999px) for buttons or cards; it breaks the sophisticated architectural feel. Stick to `DEFAULT` or `sm`.
- **Don't** use "Pop-up" modals that cover the whole screen. Use side-drawers (anchored right) using `surface-container-highest` to keep the user grounded in the shopping experience.