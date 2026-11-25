export function pendingRentLettersLabel(amount: number, rentAmount: number): string {
  const amountCents = Math.max(0, Math.round(amount * 100));
  const rentCents = Math.round(rentAmount * 100);
  if (!(amountCents > 0) || !(rentCents > 0)) return "0 letras";
  const letters = Math.ceil(amountCents / rentCents);
  return `${letters} ${letters === 1 ? "letra" : "letras"}`;
}

