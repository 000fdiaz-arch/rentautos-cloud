interface EmptyBlockProps {
  title: string;
  body: string;
}

function EmptyBlock({ title, body }: EmptyBlockProps) {
  return (
    <div className="empty-block">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export default EmptyBlock;
