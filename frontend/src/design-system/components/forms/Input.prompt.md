Form controls — text input, textarea, and select — sharing MILA's purple focus ring. All accept `label`, `hint`, `error`, `required`, and a `soft` variant (violet border on slate-50 fill).

```jsx
<Input label="Topic" placeholder="Leave blank to let the agent choose" />
<Select label="Difficulty" defaultValue="medium">
  <option>easy</option><option>medium</option><option>hard</option>
</Select>
<Textarea label="Additional instructions" rows={2} hint="Anything else the agent should consider…" />
<Input label="Email" error="Enter a valid address" />
```

Omit label/hint/error to render the bare control for custom layouts.
