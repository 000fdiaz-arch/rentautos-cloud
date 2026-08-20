export function hasMissingClaimNumber(claimNumber: string | null | undefined): boolean {
  return !claimNumber?.trim();
}

export function dateMatchesRange(value: string, from: string, to: string): boolean {
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}
