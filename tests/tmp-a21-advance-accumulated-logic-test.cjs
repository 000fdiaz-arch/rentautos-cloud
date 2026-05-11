function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function computeAdvancePanel({ rentAmount, advanceBalanceAfter }) {
  const normalizedRent = roundMoney(Math.max(0, rentAmount));
  const effectiveAdvanceBalanceAfter = roundMoney(Math.max(0, advanceBalanceAfter));
  const abonado = normalizedRent > 0 ? roundMoney(Math.min(effectiveAdvanceBalanceAfter, normalizedRent)) : 0;
  const faltante = normalizedRent > 0 ? roundMoney(Math.max(0, normalizedRent - abonado)) : 0;
  return { abonado, faltante };
}

const payment1 = { rentAmount: 299, advanceBalanceAfter: 100 };
const panel1 = computeAdvancePanel(payment1);
if (panel1.abonado !== 100 || panel1.faltante !== 199) {
  throw new Error(`Recibo 1 esperado 100/199, recibido ${panel1.abonado}/${panel1.faltante}`);
}

const payment2 = { rentAmount: 299, advanceBalanceAfter: 120 };
const panel2 = computeAdvancePanel(payment2);
if (panel2.abonado !== 120 || panel2.faltante !== 179) {
  throw new Error(`Recibo 2 esperado 120/179, recibido ${panel2.abonado}/${panel2.faltante}`);
}

console.log('OK A21 logica acumulada: recibo 1 => 100/199, recibo 2 => 120/179.');
