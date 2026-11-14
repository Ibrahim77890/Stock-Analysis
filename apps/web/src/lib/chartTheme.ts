/** Canvas charts cannot read CSS variables, so the chart colours live here (the same values as styles/tokens.css). */
export const CHART = {
  surface: "#ffffff", text: "#172033", grid: "#eef1f8", border: "#dde3ee",
  rule: "#3347c9", hold: "#6b7488", up: "#14663a", down: "#a12020", volume: "#7f8da3", sma: "#b45309", ema: "#7c3aed", rsi: "#0b6b62",
  font: "Raleway Variable, Raleway, system-ui, sans-serif",
  fontHead: "Montserrat Variable, Montserrat, system-ui, sans-serif",
} as const;
