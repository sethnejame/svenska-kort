import { createHashRouter, Navigate, RouterProvider } from 'react-router';
import { Play } from './routes/Play';
import { Decks } from './routes/Decks';
import { Add } from './routes/Add';
import { Leaderboard } from './routes/Leaderboard';
import { Profile } from './routes/Profile';

const router = createHashRouter([
  { path: '/', element: <Navigate to="/play/alla" replace /> },
  { path: '/play/:deckId', element: <Play /> },
  { path: '/decks', element: <Decks /> },
  { path: '/add', element: <Add /> },
  { path: '/leaderboard', element: <Leaderboard /> },
  { path: '/profile', element: <Profile /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
