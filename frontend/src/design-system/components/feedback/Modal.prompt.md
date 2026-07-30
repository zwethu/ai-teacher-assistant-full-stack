Centered dialog with a frosted backdrop, gradient header and footer action row. Used for Terms, About, and Add-Entry style modals.

```jsx
<Modal open={open} onClose={close} title="Add Entry" eyebrow="Wellness Journal"
  footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={save}>Save Entry</Button></>}>
  <Textarea label="Notes" rows={4} />
</Modal>
```
