import type { ReactElement } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router';
import { Play } from './routes/Play';
import { Decks } from './routes/Decks';
import { Add } from './routes/Add';
import { Leaderboard } from './routes/Leaderboard';
import { Profile } from './routes/Profile';
import { useGameStore } from './store/useGameStore';

/**
 * The one-time setup gate. A learner without a profile is sent to `/profile`,
 * which renders its first-run copy; once saved, nothing asks again.
 */
function RequireProfile({ children }: { children: ReactElement }) {
  const profile = useGameStore((s) => s.profile);
  if (profile === null) return <Navigate to="/profile" replace />;
  return children;
}

function gated(element: ReactElement): ReactElement {
  return <RequireProfile>{element}</RequireProfile>;
}

const router = createHashRouter([
  { path: '/', element: <Navigate to="/decks" replace /> },
  { path: '/play/:deckId', element: gated(<Play />) },
  { path: '/decks', element: gated(<Decks />) },
  { path: '/add', element: gated(<Add />) },
  { path: '/leaderboard', element: gated(<Leaderboard />) },
  { path: '/profile', element: <Profile /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
