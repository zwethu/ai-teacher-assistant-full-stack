Thin rounded progress/level bar. Powers the sidebar stress meter and wellness mood-summary bars.

```jsx
<ProgressBar value={72} tone="auto" />   {/* low→max color from value */}
<ProgressBar value={40} tone="primary" />
<ProgressBar value={90} max={100} tone="gradient" size="lg" />
```

`tone="auto"` maps ≥100 → danger, ≥80 → warning, else azure (matches the stress widget).
