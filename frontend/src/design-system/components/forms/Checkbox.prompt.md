Checkbox and Switch — azure-accented boolean controls. Switch is used for connector toggles (e.g. Web Search).

```jsx
<Checkbox label="Set a time limit" defaultChecked />
<Switch label="Web Search" checked={on} onChange={e => setOn(e.target.checked)} />
```
