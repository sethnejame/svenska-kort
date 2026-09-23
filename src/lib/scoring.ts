/**
 * Scoring moved to `shared/` so the Worker can recompute a submitted session
 * with the exact lines the client used. This re-export keeps the app's import
 * paths unchanged; there is no second copy of the arithmetic.
 */
export { multiplier, pointsFor } from '../../shared/scoring';
export type { PointsInput, SessionAnswer } from '../../shared/scoring';
