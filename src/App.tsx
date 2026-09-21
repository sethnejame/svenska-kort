import type { ReactElement } from 'react';
import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { RecoveryBanner } from './components/RecoveryBanner/RecoveryBanner';
import { Play } from './routes/Play';
import { Decks } from './routes/Decks';
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

/**
 * Decks, Play and Profile are the first screen a learner can land on, so they
 * ship in the entry chunk. Add, the leaderboard and the stats are detours
 * reached by a tap, and between them they own the parser and the whole
 * validation dependency, so they are fetched when that tap happens instead of
 * on every cold start.
 */
const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Navigate to="/decks" replace /> },
      { path: '/play/:deckId', element: gated(<Play />) },
      { path: '/decks', element: gated(<Decks />) },
      {
        path: '/add',
        lazy: async () => {
          const { Add } = await import('./routes/Add');
          return { element: gated(<Add />) };
        },
      },
      {
        path: '/stats',
        lazy: async () => {
          const { Stats } = await import('./routes/Stats');
          return { element: gated(<Stats />) };
        },
      },
      {
        path: '/leaderboard',
        lazy: async () => {
          const { Leaderboard } = await import('./routes/Leaderboard');
          return { element: gated(<Leaderboard />) };
        },
      },
      { path: '/profile', element: <Profile /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
