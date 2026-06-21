import CatGameApp from '../features/cat-game/CatGameApp';

/**
 * Full-screen student-facing game page.
 * No navbar, no sidebar — just the game.
 * Route: /game (public, no auth required)
 */
export default function CatGamePage() {
  return (
    <div style={{ width: '100vw', minHeight: '100vh', overflow: 'auto' }}>
      <CatGameApp />
    </div>
  );
}
