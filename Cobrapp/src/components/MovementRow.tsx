import { movementTypeLabels } from "../app/constants";
import type { Movement } from "../types";
import { formatDate, formatMoney } from "../utils/format";
import { getMovementImpact } from "../utils/ledger";

interface MovementRowProps {
  movement: Movement;
}

function MovementRow({ movement }: MovementRowProps) {
  const impact = getMovementImpact(movement);
  const sign = impact >= 0 ? "+" : "-";
  const absoluteAmount = Math.abs(impact);

  return (
    <article className="movement-row">
      <div>
        <strong>{movement.description}</strong>
        <span>
          {formatDate(movement.date)} | {movementTypeLabels[movement.type]} |{" "}
          {movement.source === "bank" ? "Banco" : "Manual"}
        </span>
      </div>
      <div className="movement-row__amount">
        <strong className={sign === "+" ? "amount-plus" : "amount-minus"}>
          {sign}
          {formatMoney(absoluteAmount)}
        </strong>
        <span>{movement.bankReference ? movement.bankReference : "Sin ref."}</span>
      </div>
    </article>
  );
}

export default MovementRow;
