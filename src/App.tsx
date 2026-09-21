import type { ReactElement } from 'react';
import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { RecoveryBanner } from './components/RecoveryBanner/RecoveryBanner';
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

/**
 * A layout route exists for one reason: the recovery notice has to reach the
 * learner wherever the router happens to drop them, and losing the stored data
 * also loses the profile, which sends them to `/profile` rather than `/decks`.
 */
function Shell() {
  return (
    <>
      <RecoveryBanner />
      <Outlet />
    </>
  );
}

const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Navigate to="/decks" replace /> },
      { path: '/play/:deckId', element: gated(<Play />) },
      { path: '/decks', element: gated(<Decks />) },
      { path: '/add', element: gated(<Add />) },
      { path: '/leaderboard', element: gated(<Leaderboard />) },
      { path: '/profile', element: <Profile /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
