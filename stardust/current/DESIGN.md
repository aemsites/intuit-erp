<!-- stardust:provenance tool="stardust:extract" origin="https://of1--intuit-erp--aemsites.aem.page" extractedAt="2026-10-13T14:23:45Z" pages="3" -->

---
name: Intuit Enterprise Suite
description: Enterprise-grade ERP finance platform by Intuit
colors:
  primary: "#0077c5"
  primary-hover: "#055393"
  brand-blue: "#236CFF"
  text: "#21262a"
  heading: "#11181c"
  muted: "#6b6c72"
  background: "#ffffff"
  surface: "#f7f8f3"
  surface-alt: "#f0f4f6"
  surface-hero: "#eff4f9"
  dark-section: "#0d2035"
typography:
  display:
    fontFamily: '"AvenirNext forINTUIT", avenir-fallback, arial, sans-serif'
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.15
  headline:
    fontFamily: '"AvenirNext forINTUIT", avenir-fallback, arial, sans-serif'
    fontSize: "38px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: '"AvenirNext forINTUIT", avenir-fallback, arial, sans-serif'
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: '"AvenirNext forINTUIT", avenir-fallback, arial, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"AvenirNext forINTUIT", avenir-fallback, arial, sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  circle: "50%"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.background}"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
  card:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Intuit Enterprise Suite

## Overview

The Intuit Enterprise Suite visual system balances enterprise credibility with Intuit's approachable, consumer-friendly heritage. The design language is clean, professional, and information-dense without feeling overwhelming. White space is used generously to let content breathe, and a restrained color palette keeps the focus on clarity and trust.

The single typeface family (AvenirNext forINTUIT) across headings and body creates a unified, modern voice. The site uses a consistent blue primary accent (#0077c5) for interactive elements, with a darker navy (#0d2035) for high-contrast sections that anchor key messaging.

**Key Characteristics:**
- Clean, white-dominant layouts with generous spacing
- Single typeface system (AvenirNext forINTUIT) at multiple weights
- Restrained primary blue accent for CTAs and links
- Card-based content organization with subtle rounded corners
- Dark navy sections for emphasis and contrast
- Professional photography featuring real business scenarios

## Colors

A restrained palette built around Intuit's blue identity, with warm neutrals for surfaces and a dark navy for anchoring sections.

### Primary
- **Intuit Blue** (#0077c5): Primary interactive color for links, buttons, and CTAs. Used sparingly as the call-to-action accent.
- **Intuit Blue Deep** (#055393): Hover state for primary interactive elements.
- **Intuit Brand Blue** (#236CFF): The Intuit wordmark color. Used only for the logo, not for UI elements.

### Neutral
- **Near Black** (#11181c): Heading text color. Maximum contrast for typography hierarchy.
- **Charcoal** (#21262a): Body text color. Slightly softer than headings for comfortable reading.
- **Stone** (#6b6c72): Muted/secondary text, captions, and supporting content.
- **White** (#ffffff): Primary background and card surfaces.
- **Warm Gray** (#f7f8f3): Light surface for alternating section backgrounds.
- **Cool Gray** (#f0f4f6): Table of contents and navigation backgrounds.
- **Ice Blue** (#eff4f9): Hero section backgrounds.
- **Navy** (#0d2035): Dark section backgrounds for high-contrast messaging blocks.

## Typography

**Primary Font:** AvenirNext forINTUIT (with avenir-fallback, arial, sans-serif fallback stack)

AvenirNext forINTUIT is a private/custom font. The closest system-font fallback chain is avenir-fallback (a local override), then Arial, then sans-serif. Note: this is a proprietary Intuit typeface and cannot be redistributed.

**Character:** Clean, geometric sans-serif with excellent readability at all sizes. The single-family approach creates visual unity while weight variation (400-700) provides clear hierarchy.

### Hierarchy
- **Display** (700, 48px, 1.15): Hero headlines and primary page titles.
- **Headline** (700, 38px, 1.2): Section headings and feature titles.
- **Title** (600, 30px, 1.3): Sub-section headings and card titles.
- **Body** (400, 16px, 1.5): Primary body copy. Comfortable reading rhythm.
- **Label** (600, 14px, 1.4): Navigation items, form labels, metadata.

Additional sizes: 24px (medium heading), 20px (small heading), 18px (extra-small heading), 15px (small body), 12px (fine print).

## Layout

Content is organized in a centered container layout. Sections alternate between white and light-tinted backgrounds to create visual rhythm. Key patterns observed:

- **Hero sections**: Full-width with centered text, optional side imagery
- **Feature grids**: 2-up and 3-up card layouts for capability showcases
- **Stat bars**: Horizontal stat displays (50%, 2-hour, 260+, 90%) with labels
- **Tabbed content**: Horizontal tab navigation for feature categories
- **Dark bands**: Navy (#0d2035) full-width sections for emphasis and industry workflows
- **Contact forms**: Multi-field inline forms with primary CTA

Breakpoints follow the project standard: 768px (tablet), 1024px (desktop), 1200px (wide), 1440px (extra-wide).

## Elevation & Depth

The system is predominantly flat. No recurring box-shadow patterns were detected across the three extracted pages. Depth is conveyed through:

- Background color alternation (white / warm gray / ice blue / navy)
- Card containers with subtle rounded corners (12px radius)
- Photography and illustration layered over colored backgrounds

## Shapes

Border radius follows a consistent scale rooted in 4px increments:

- **Small (4px)**: Buttons, inputs, default interactive elements
- **Medium (8px)**: Badges, tags, intermediate containers
- **Large (12px)**: Cards, content panels, feature blocks
- **Extra Large (16px)**: Prominent containers, hero elements
- **Circle (50%)**: Avatars, icon containers

The dominant interactive radius is 4px (buttons and form fields), while content containers use 12px. This creates a clear visual distinction between interactive and container elements.

## Components

### Buttons
- **Primary**: Intuit Blue (#0077c5) background, white text, 4px radius. Hover darkens to #055393.
- **Secondary/Outline**: White background with border, dark text, 4px radius.
- **Button pairs**: Primary + Secondary frequently appear together in hero sections.

### Cards
- White background, 12px radius, generous internal padding. Used for feature showcases, stat displays, and capability descriptions.

### Navigation
- Sticky header with Intuit brand bar (family logos: TurboTax, Credit Karma, QuickBooks, Mailchimp) above main navigation. Primary CTA ("Schedule a call") anchored at right.

### Forms
- Inline multi-field layout (email, business name, first name, last name, phone) with primary CTA. Used consistently for lead capture across pages.

### FAQ Accordion
- Expandable question/answer pairs with plus/minus toggles. Clean typography hierarchy.

## Do's and Don'ts

- **Do** use the Intuit Blue (#0077c5) only for interactive elements (links, buttons, CTAs)
- **Do** maintain generous white space between sections
- **Do** use the dark navy (#0d2035) sparingly for high-impact messaging sections
- **Don't** use the brand blue (#236CFF) for UI elements; it is reserved for the Intuit wordmark
- **Don't** introduce additional accent colors; the palette is intentionally restrained
- **Don't** use border-radius values outside the defined scale (4/8/12/16/50%)
