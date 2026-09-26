export function calculateLeadAgeExtraDeposit(age: number | null): number {
  if (age === null || age < 0 || age > 27) return 0;
  return (28 - age) * 100;
}
