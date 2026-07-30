Rounded pill control for the batch/space selector, filters, and tags.

```jsx
<Chip caret>Select a batch</Chip>
<Chip active caret onDismiss={clear}>CS101 — Sec 1</Chip>
<Chip plain>Mixed</Chip>
```

`active` = azure selected state, `plain` = neutral slate outline, `caret` adds a dropdown chevron, `onDismiss` adds a "×".
