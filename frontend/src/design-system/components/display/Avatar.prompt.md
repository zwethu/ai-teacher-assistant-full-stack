User avatar — shows a photo, or initials on an azure gradient when there's no `src`.

```jsx
<Avatar src={user.photoURL} name="Ada Lovelace" />
<Avatar name="Ada Lovelace" size="lg" ring />
<Avatar size={28} />
```

`size` accepts `sm|md|lg` or a pixel number. `ring` adds a white border for colored backgrounds.
