export type CollisionCreditResult = {
  creditedAmount: number;
  appliedToOverdueRent: number;
  advanceCredit: number;
  balanceAfter: number;
  advanceBalanceAfter: number;
  installmentsCovered: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateCollisionCredit(input: {
  invoiceAmount: number;
  paidToCollision: number;
  rentBalance: number;
  advanceBalance: number;
  rentAmount: number;
}): CollisionCreditResult {
  const creditedAmount = Math.min(roundMoney(Math.max(0, input.invoiceAmount)), roundMoney(Math.max(0, input.paidToCollision)));
  const rentBalance = roundMoney(Math.max(0, input.rentBalance));
  const appliedToOverdueRent = Math.min(rentBalance, creditedAmount);
  const advanceCredit = roundMoney(Math.max(0, creditedAmount - appliedToOverdueRent));
  const balanceAfter = roundMoney(Math.max(0, rentBalance - appliedToOverdueRent));
  const pendingBefore = input.rentAmount > 0 ? Math.ceil(rentBalance / input.rentAmount) : 0;
  const pendingAfter = input.rentAmount > 0 ? Math.ceil(balanceAfter / input.rentAmount) : 0;
  return {
    creditedAmount,
    appliedToOverdueRent,
    advanceCredit,
    balanceAfter,
    advanceBalanceAfter: roundMoney(Math.max(0, input.advanceBalance) + advanceCredit),
    installmentsCovered: Math.max(0, pendingBefore - pendingAfter)
  };
}
