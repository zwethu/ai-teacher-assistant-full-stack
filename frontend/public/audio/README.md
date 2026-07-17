# Game music

The game ships with generated Web Audio themes so it has music with no assets.
Drop a real file here and it takes over automatically — no code change:

| File             | Plays on                          |
| ---------------- | --------------------------------- |
| `background.mp3` | Avatar select, mode select, lobby |
| `cat-theme.mp3`  | In-game, cat avatar               |
| `dog-theme.mp3`  | In-game, dog avatar               |

Requirements:

- Must be served with an `audio/*` content-type (a normal `.mp3` is fine).
  The player HEAD-checks the path and falls back to the synth theme if the
  content-type isn't audio — the dev server answers missing files with
  `index.html` and a `200`, so the type check is what detects "not there".
- Should loop cleanly — playback uses `loop = true` with no crossfade.
- Keep them quiet. The synth themes peak around 10% gain on purpose; music
  here sits under gameplay sound effects rather than competing with them.

Players can mute music and effects together with the speaker button; the
choice persists in `localStorage` under `catgame:muted`.
