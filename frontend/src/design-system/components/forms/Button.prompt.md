Primary action button and its variants — MILA's rounded-md purple CTA. Use for the main action on a form, dialog, or toolbar.

```jsx
<Button variant="primary" leadingIcon={<Sparkles size={16} />}>Generate outline</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger" size="sm">Delete</Button>
<Button variant="primary" block loading>Saving…</Button>
```

Variants: `primary` (azure, default), `secondary` (outlined white), `ghost` (text-only), `danger` (red). Sizes `sm|md|lg` — `md` is the 44px min hit target. `block` stretches full-width; `loading` swaps in a spinner and disables.
