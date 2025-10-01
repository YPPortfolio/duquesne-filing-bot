import { Card } from "@/components/ui/card";
import { FileText } from "lucide-react";

interface PortfolioSummaryProps {
  summary: string;
  filing: any;
}

export function PortfolioSummary({ summary, filing }: PortfolioSummaryProps) {
  return (
    <Card className="border-l-4 border-l-primary">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Executive Summary</h2>
            <p className="text-sm text-muted-foreground">
              {filing.quarter} {filing.year} • Filed {new Date(filing.filing_date).toLocaleDateString()}
            </p>
          </div>
        </div>
        <p className="text-foreground leading-relaxed whitespace-pre-wrap">{summary}</p>
      </div>
    </Card>
  );
}
