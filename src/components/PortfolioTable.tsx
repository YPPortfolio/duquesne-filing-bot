import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, TrendingDown } from "lucide-react";

interface PortfolioTableProps {
  data: any[];
}

export function PortfolioTable({ data }: PortfolioTableProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const getChangeColor = (value: number) => {
    return value >= 0 ? 'text-success' : 'text-destructive';
  };

  const getChangeIcon = (value: number) => {
    return value >= 0 ? (
      <TrendingUp className="h-4 w-4 inline" />
    ) : (
      <TrendingDown className="h-4 w-4 inline" />
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-6 border-b border-border">
        <h2 className="text-2xl font-bold">Portfolio Holdings</h2>
        <p className="text-muted-foreground mt-1">Top {data.length} holdings with quarterly and annual comparisons</p>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Company</TableHead>
              <TableHead className="text-right font-semibold">Current ($)</TableHead>
              <TableHead className="text-right font-semibold">Current (%)</TableHead>
              <TableHead className="text-right font-semibold">Prior Q ($)</TableHead>
              <TableHead className="text-right font-semibold">Prior Q (%)</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ ($)</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ (%)</TableHead>
              <TableHead className="text-right font-semibold">Prior Y ($)</TableHead>
              <TableHead className="text-right font-semibold">Prior Y (%)</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ ($)</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ (%)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, index) => (
              <TableRow key={index} className="hover:bg-muted/30">
                <TableCell className="font-medium">{row.company}</TableCell>
                <TableCell className="text-right">{formatCurrency(row.currentValue)}</TableCell>
                <TableCell className="text-right">{row.currentPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatCurrency(row.priorQValue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.priorQPct.toFixed(2)}%</TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.qoqValueChange)}`}>
                  {getChangeIcon(row.qoqValueChange)} {formatCurrency(row.qoqValueChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.qoqPctChange)}`}>
                  {formatPercent(row.qoqPctChange)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{formatCurrency(row.priorYValue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.priorYPct.toFixed(2)}%</TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.yoyValueChange)}`}>
                  {getChangeIcon(row.yoyValueChange)} {formatCurrency(row.yoyValueChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.yoyPctChange)}`}>
                  {formatPercent(row.yoyPctChange)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
