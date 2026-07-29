The product's default white rounded container. Pass `icon`, `title`, `meta` for the standard artifact-card header, or just children.

```jsx
<Card icon={<FileQuestion size={16} />} title="Week 3 Quiz" meta="Week 3 · v2">
  <Button variant="secondary" size="sm">Open Google Form</Button>
</Card>
<Card interactive glass rounded="2xl">…</Card>
```

`interactive` adds hover lift; `glass` gives the frosted surface for use over the academic canvas.
