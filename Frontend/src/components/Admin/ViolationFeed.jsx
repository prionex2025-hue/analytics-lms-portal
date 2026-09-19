import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ViolationFeed({ items }) {
  return (
    <Card className="rounded-2xl border-border">
      <CardHeader>
        <CardTitle className="text-base">Violation Feed</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-text-secondary">No violations yet.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id || `${item.studentId}-${item.at}`} className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                <p className="font-medium">{item.studentName || "Student"} -&gt; {item.type}</p>
                <p className="text-xs text-warning">{new Date(item.at || Date.now()).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
