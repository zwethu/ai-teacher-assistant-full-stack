Inline toast/notification with a colored accent edge and status icon.

```jsx
<Toast type="success" message="Assessment exported to Google Forms." onDismiss={dismiss} />
<Toast type="error" message="Could not load assessments." />
```

Types: `success | error | info | warning`. Pair with a fixed-position container and auto-dismiss timer.
