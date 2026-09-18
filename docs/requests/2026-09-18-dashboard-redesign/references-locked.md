- short_id: dk-a1
  seg: anchor
  gist: "Supply-chain intelligence terminal for investors: pure-black data-dense dashboard with monospace numerals and semantic market colors."
  tags: ["dashboard", "dark", "data-dense", "analytics", "kpi", "financial", "terminal"]
  layout: |
    Split-screen asymmetric grid md:grid-cols-[minmax(250px,0.7fr)_1fr]; left panel sticky full-height visual, right content column. Stats row in 3-column grid below hero. Generous vertical rhythm between sections; max content width ~1360px centered.
  color: |
    Dark-first palette: background #000000, foreground #ffffff, muted text #8f8f8f (--muted-foreground), borders #2e2e2e. Data semantics: emerald #00bb7f (gains/positive), red #fb2c36 (losses/negative), blue #3080ff (primary series). Subtle edge fades from-background to-transparent for scroll regions.
  typography: |
    Inter for UI and body (weights 400/600); serif display for hero headlines at font-normal. Monospace (font-mono) for all data, labels, buttons: uppercase with tracking 0.1em–0.2em. Body font-light leading-relaxed. KPI numerals large, tabular-nums, letter-spacing -0.02em.
  components: |
    Primary button bg-foreground text-background (white fill, black text, mono uppercase). Secondary: border border-border transparent bg. Cards dark bg, rounded corners (rounded-md), subtle borders. Tags: small pill with colored dot. Ticker: infinite horizontal scroll with gradient masks at both edges.
  motion: |
    Continuous ticker scroll; hover transitions transition-colors 0.2s; smooth scroll-behavior. No bouncy easing — functional timing only.
- short_id: dk-a3
  seg: anchor
  gist: "Infrastructure monitoring wall: Grafana-style dark ops UI where every pixel serves timeseries data and alert states."
  tags: ["dashboard", "monitoring", "grafana", "ops", "dark", "charts", "dense"]
  layout: |
    Grid of panel cards (12-col grid, gutters 16px) on #111217 canvas. Each panel: 8px padding header row (title 13px + collapsible controls) above chart body. Left tree navigation for dashboards. Tight density: 24px row heights, 12px gaps.
  color: |
    Canvas #111217, panel bg #181b1f, panel border #2c3238. Series palette (ordered): #5794f2 blue, #b877d9 purple, #73bf69 green, #f2cc0c yellow, #ff9830 orange, #fa7800 dark-orange, #e02f44 red, #ae561e brown. Text #d8d9da, muted #9fa7b3. Alert states: ok green, warning amber, critical red badges with dark text.
  typography: |
    Roboto / system sans 13px base; monospace Roboto Mono for axis labels, legend values, and thresholds. Axis tick labels 11px #8492a6. Panel titles 13px 500 weight. All numerals tabular.
  components: |
    Panels with 3px top border in series color (status accent). Legends as inline clickable chips with colored line-swatch. Time picker top-right with relative ranges (last 6h / 24h / 7d). Annotation markers as vertical dashed lines. Tooltips: dark panel with grid crosshair on hover.
  motion: |
    Live data: charts redraw on interval without animation flourish. Tooltip crosshair snaps. Panel resize via drag handles (ew-resize cursor). Transitions under 150ms.
