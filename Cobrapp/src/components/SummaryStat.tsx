interface SummaryStatProps {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "accent" | "warning";
}

function SummaryStat({ label, value, detail, tone = "default" }: SummaryStatProps) {
  return (
    <article className={`summary-stat summary-stat--${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

export default SummaryStat;
