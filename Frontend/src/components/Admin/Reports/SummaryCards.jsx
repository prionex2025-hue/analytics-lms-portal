const getTrendTone = (value) => {
  if (value >= 75) return "text-success";
  if (value >= 40) return "text-warning";
  return "text-danger";
};

export default function SummaryCards({ summary }) {
  const cards = [
    { title: "Total Students Attempted", value: summary?.totalStudentsAttempted ?? 0 },
    { title: "Average Score", value: Number(summary?.averageScore || 0).toFixed(2), tone: getTrendTone(Number(summary?.averageScore || 0)) },
    { title: "Highest Score", value: Number(summary?.highestScore || 0).toFixed(2), tone: "text-success" },
    { title: "Lowest Score", value: Number(summary?.lowestScore || 0).toFixed(2), tone: "text-danger" },
    { title: "Completion Rate", value: `${Number(summary?.completionRate || 0).toFixed(1)}%`, tone: getTrendTone(Number(summary?.completionRate || 0)) },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <article key={card.title} className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{card.title}</p>
          <p className={`mt-2 text-2xl font-bold ${card.tone || "text-text-primary"}`}>{card.value}</p>
        </article>
      ))}
    </section>
  );
}
