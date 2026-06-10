export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-6 pb-1">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-ink-400 text-sm mt-1 font-medium">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0 pt-0.5">{action}</div>}
    </header>
  );
}
