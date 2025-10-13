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

  const formatPrice = (value: number | null) => {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
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
              <TableHead className="text-right font-semibold">Avg Price</TableHead>
              <TableHead className="text-right font-semibold">EOD Price</TableHead>
              <TableHead className="text-right font-semibold">Prior Q ($)</TableHead>
              <TableHead className="text-right font-semibold">Prior Q (%)</TableHead>
              <TableHead className="text-right font-semibold">Prior Q Avg</TableHead>
              <TableHead className="text-right font-semibold">Prior Q EOD</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ ($)</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ (%)</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ Avg</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ EOD</TableHead>
              <TableHead className="text-right font-semibold">Prior Y ($)</TableHead>
              <TableHead className="text-right font-semibold">Prior Y (%)</TableHead>
              <TableHead className="text-right font-semibold">Prior Y Avg</TableHead>
              <TableHead className="text-right font-semibold">Prior Y EOD</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ ($)</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ (%)</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ Avg</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ EOD</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, index) => (
              <TableRow key={index} className="hover:bg-muted/30">
                <TableCell className="font-medium">{row.company}</TableCell>
                <TableCell className="text-right">{formatCurrency(row.currentValue)}</TableCell>
                <TableCell className="text-right">{row.currentPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right">{formatPrice(row.currentAvgPrice)}</TableCell>
                <TableCell className="text-right">{formatPrice(row.currentEodPrice)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatCurrency(row.priorQValue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.priorQPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatPrice(row.priorQAvgPrice)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatPrice(row.priorQEodPrice)}</TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.qoqValueChange)}`}>
                  {getChangeIcon(row.qoqValueChange)} {formatCurrency(row.qoqValueChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.qoqPctChange)}`}>
                  {formatPercent(row.qoqPctChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.qoqAvgPriceChange)}`}>
                  {getChangeIcon(row.qoqAvgPriceChange)} {formatPrice(Math.abs(row.qoqAvgPriceChange))}
                </TableCell>
                <TableCell className={`text-right font-semibold ${row.qoqEodPriceChange !== null ? getChangeColor(row.qoqEodPriceChange) : ''}`}>
                  {row.qoqEodPriceChange !== null ? (
                    <>{getChangeIcon(row.qoqEodPriceChange)} {formatPrice(Math.abs(row.qoqEodPriceChange))}</>
                  ) : '—'}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{formatCurrency(row.priorYValue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.priorYPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatPrice(row.priorYAvgPrice)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatPrice(row.priorYEodPrice)}</TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.yoyValueChange)}`}>
                  {getChangeIcon(row.yoyValueChange)} {formatCurrency(row.yoyValueChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.yoyPctChange)}`}>
                  {formatPercent(row.yoyPctChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.yoyAvgPriceChange)}`}>
                  {getChangeIcon(row.yoyAvgPriceChange)} {formatPrice(Math.abs(row.yoyAvgPriceChange))}
                </TableCell>
                <TableCell className={`text-right font-semibold ${row.yoyEodPriceChange !== null ? getChangeColor(row.yoyEodPriceChange) : ''}`}>
                  {row.yoyEodPriceChange !== null ? (
                    <>{getChangeIcon(row.yoyEodPriceChange)} {formatPrice(Math.abs(row.yoyEodPriceChange))}</>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
