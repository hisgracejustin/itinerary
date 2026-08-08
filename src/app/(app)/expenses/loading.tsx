export default function ExpensesLoading() {
  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="mat-surface p-5 animate-pulse">
        <div className="h-6 w-32 rounded bg-surface-container mb-5" />
        <div className="space-y-4">
          {[1, 2, 3].map((row) => (
            <div key={row} className="h-14 rounded-xl bg-surface-container/70" />
          ))}
        </div>
      </div>
    </div>
  );
}
