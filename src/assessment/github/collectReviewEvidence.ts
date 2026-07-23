/** Review evidence placeholder (Phase D). */
export interface ReviewEvidence {
  pull_number: number;
  state: string;
  author_login?: string;
}

export function candidateAuthoredReviews(
  reviews: ReviewEvidence[],
  login: string
): ReviewEvidence[] {
  const want = login.toLowerCase();
  return reviews.filter((r) => r.author_login?.toLowerCase() === want);
}
