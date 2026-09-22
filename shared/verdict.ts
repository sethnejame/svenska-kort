/**
 * How one answer was graded.
 *
 * This lives in `shared/` rather than next to `checkAnswer` because the Worker
 * needs it and must never import the grader: grading needs the learner's deck,
 * which only the device has. The server is told the verdict and prices it.
 */
export type Verdict = 'correct' | 'close' | 'wrong';
