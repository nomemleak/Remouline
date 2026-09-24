// Remouline design system: the ONE source of truth for colors, type, spacing,
// shapes, logo usage and icon geometry. Both the student dashboard and the admin
// panel import this file (through the CSS variables generated below), so the two
// interfaces cannot drift apart. Never hardcode a hex value in a component.
//
// Contrast (WCAG 2.1), against `bg` #0d0d0f / `surface` #16161a:
//   text 16.5 / 15.3 · textMuted 7.8 / 7.2 · textFaint 5.2 / 4.8 · accent 8.1 / 7.5
//   pass 10.0 / 9.3 · fail 7.0 / 6.5 · warn 11.6 / 10.8 · running 7.0 / 6.5
//   -> every text color passes AA (>= 4.5:1) on both backgrounds.
//   textFaint is for captions only, never on `surfaceRaised`.

export const colors = {
  bg: '#0d0d0f', // page background: near-black, never pure #000
  surface: '#16161a', // elevated surface: cards, panels, sidebar
  surfaceRaised: '#1e1e23', // hover / nested surfaces, code blocks
  border: '#2a2a31',
  borderStrong: '#3a3a43',
  text: '#ececf1',
  textMuted: '#a3a3ae',
  textFaint: '#83838e',

  // Single accent, used sparingly (links, focus, primary action): "millstone" copper.
  accent: '#e8935a',
  accentMuted: '#3a2718',
  onAccent: '#0d0d0f',

  // Semantic
  pass: '#4fd18b',
  passMuted: '#15301f',
  fail: '#ff6b6b',
  failMuted: '#3a1a1c',
  warn: '#f2c14e', // warnings, skipped
  warnMuted: '#35290f',
  running: '#9a9aa6', // queued / in progress
  runningMuted: '#232329',
} as const;

export const fonts = {
  // Geometric sans for UI; monospace for code, logs and raw test output.
  sans: "var(--font-sans), 'Outfit', ui-sans-serif, system-ui, sans-serif",
  mono: "var(--font-mono), 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
} as const;

// Type scale: [font-size, line-height, weight]
export const type = {
  h1: ['28px', '36px', 600],
  h2: ['22px', '30px', 600],
  h3: ['17px', '24px', 600],
  body: ['15px', '22px', 400],
  small: ['13px', '19px', 400],
  caption: ['12px', '16px', 500],
  code: ['13px', '20px', 400],
} as const;

export const weights = { regular: 400, medium: 500, semibold: 600 } as const;

export const space = { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '24px', 6: '32px', 7: '48px' } as const;

export const radius = { sm: '3px', md: '5px', lg: '7px' } as const;

export const logo = {
  // Clear space around the mark = 25% of its height, on every side.
  clearSpaceRatio: 0.25,
  // Under this rendered width the full lockup switches to the icon-only mark.
  minFullWidthPx: 140,
  // Black artwork on transparent PNG -> rendered white on dark surfaces.
  onDarkFilter: 'brightness(0) invert(1)',
  fullSrc: '/branding/logo-full.png',
  markSrc: '/branding/logo-mark.png',
  fullAspect: 972 / 189,
  markAspect: 405 / 388,
} as const;

export const icons = {
  // Monoline, geometric, sharp corners - same language as the logo mark.
  grid: 16, // every icon is drawn on a 16x16 grid
  strokeWidth: 1.5,
  linecap: 'square',
  linejoin: 'miter',
} as const;

/** CSS custom properties generated from the tokens above (injected in the root layout). */
export function themeCss(): string {
  const vars: string[] = [];
  const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  for (const [k, v] of Object.entries(colors)) vars.push(`--c-${kebab(k)}: ${v};`);
  vars.push(`--f-sans: ${fonts.sans};`, `--f-mono: ${fonts.mono};`);
  for (const [k, [size, lh, w]] of Object.entries(type)) {
    vars.push(`--t-${k}-size: ${size};`, `--t-${k}-lh: ${lh};`, `--t-${k}-weight: ${w};`);
  }
  for (const [k, v] of Object.entries(space)) vars.push(`--s-${k}: ${v};`);
  for (const [k, v] of Object.entries(radius)) vars.push(`--r-${k}: ${v};`);
  vars.push(`--logo-filter: ${logo.onDarkFilter};`);
  return `:root{${vars.join('')}color-scheme:dark;}`;
}
