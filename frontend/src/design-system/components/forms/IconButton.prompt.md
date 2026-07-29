Icon-only button for toolbars, close buttons, and panel toggles. Always pass `label` for accessibility.

```jsx
<IconButton label="Open panel" variant="ghost"><PanelRight size={16} /></IconButton>
<IconButton label="New chat" variant="solid"><Plus size={18} /></IconButton>
<IconButton label="Delete" variant="danger" tile><Trash2 size={16} /></IconButton>
```

Variants: `ghost` (default), `solid`, `soft`, `danger`. `tile` makes a rounded square instead of a circle.
