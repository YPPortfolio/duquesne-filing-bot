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
  filing?: any;
}

export function PortfolioTable({ data, filing }: PortfolioTableProps) {
  // Helper to format the filing date
  const formatFilingDate = () => {
    if (!filing?.filing_date) return '';
    const date = new Date(filing.filing_date);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // Helper to get quarter end date
  const getQuarterEndDate = () => {
    if (!filing?.quarter || !filing?.year) return '';
    const quarterEndDates: { [key: string]: string } = {
      'Q1': `March 31, ${filing.year}`,
      'Q2': `June 30, ${filing.year}`,
      'Q3': `September 30, ${filing.year}`,
      'Q4': `December 31, ${filing.year}`,
    };
    return quarterEndDates[filing.quarter] || '';
  };

  // Collect unique footnotes
  const collectFootnotes = () => {
    const footnotes: string[] = [];
    const footnoteMap = new Map<string, number>();
    
    data.forEach(row => {
      if (row.priorQPriceNote && !footnoteMap.has(row.priorQPriceNote)) {
        footnotes.push(row.priorQPriceNote);
        footnoteMap.set(row.priorQPriceNote, footnotes.length);
      }
      if (row.priorYPriceNote && !footnoteMap.has(row.priorYPriceNote)) {
        footnotes.push(row.priorYPriceNote);
        footnoteMap.set(row.priorYPriceNote, footnotes.length);
      }
    });
    
    return { footnotes, footnoteMap };
  };

  const { footnotes, footnoteMap } = collectFootnotes();
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
        <h2 className="text-2xl font-bold">
          Portfolio Holdings {filing && `(As of ${formatFilingDate()}, Latest Quarter End Date: ${getQuarterEndDate()})`}
        </h2>
        <p className="text-muted-foreground mt-1">Top 20 holdings by portfolio weight with quarterly and annual comparisons</p>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Company</TableHead>
              <TableHead className="text-right font-semibold">Current ($)</TableHead>
              <TableHead className="text-right font-semibold">Latest Reporting Date (% of Total Portfolio Value)</TableHead>
              <TableHead className="text-right font-semibold">EOD Stock Price</TableHead>
              <TableHead className="text-right font-semibold border-l-2 border-primary/30">Prior Q ($)</TableHead>
              <TableHead className="text-right font-semibold">Prior Q (% of Total)</TableHead>
              <TableHead className="text-right font-semibold">Prior Q EOD Stock Price</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ ($)</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ (percentage points)</TableHead>
              <TableHead className="text-right font-semibold">QoQ Δ EOD Price (%)</TableHead>
              <TableHead className="text-right font-semibold border-l-2 border-primary/30">Prior Y ($)</TableHead>
              <TableHead className="text-right font-semibold">Prior Y (% of Total)</TableHead>
              <TableHead className="text-right font-semibold">Prior Y EOD Stock Price</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ ($)</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ (Percentage Points)</TableHead>
              <TableHead className="text-right font-semibold">YoY Δ EOD Price (%)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, index) => (
              <TableRow key={index} className="hover:bg-muted/30">
                <TableCell className="font-medium">{row.company}</TableCell>
                <TableCell className="text-right">{formatCurrency(row.currentValue)}</TableCell>
                <TableCell className="text-right">{row.currentPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right">{formatPrice(row.currentAvgPrice)}</TableCell>
                <TableCell className="text-right text-muted-foreground border-l-2 border-primary/30">{formatCurrency(row.priorQValue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.priorQPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatPrice(row.priorQAvgPrice)}
                  {row.priorQPriceNote && (
                    <sup className="text-primary font-medium ml-0.5">
                      {footnoteMap.get(row.priorQPriceNote)}
                    </sup>
                  )}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.qoqValueChange)}`}>
                  {getChangeIcon(row.qoqValueChange)} {formatCurrency(row.qoqValueChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.qoqPctChange)}`}>
                  {formatPercent(row.qoqPctChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${row.qoqAvgPriceChangePct !== null ? getChangeColor(row.qoqAvgPriceChangePct) : ''}`}>
                  {row.qoqAvgPriceChangePct !== null ? formatPercent(row.qoqAvgPriceChangePct) : '—'}
                </TableCell>
                <TableCell className="text-right text-muted-foreground border-l-2 border-primary/30">{formatCurrency(row.priorYValue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.priorYPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatPrice(row.priorYAvgPrice)}
                  {row.priorYPriceNote && (
                    <sup className="text-primary font-medium ml-0.5">
                      {footnoteMap.get(row.priorYPriceNote)}
                    </sup>
                  )}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.yoyValueChange)}`}>
                  {getChangeIcon(row.yoyValueChange)} {formatCurrency(row.yoyValueChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${getChangeColor(row.yoyPctChange)}`}>
                  {formatPercent(row.yoyPctChange)}
                </TableCell>
                <TableCell className={`text-right font-semibold ${row.yoyAvgPriceChangePct !== null ? getChangeColor(row.yoyAvgPriceChangePct) : ''}`}>
                  {row.yoyAvgPriceChangePct !== null ? formatPercent(row.yoyAvgPriceChangePct) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      <div className="p-4 border-t border-border bg-muted/20">
        <p className="text-sm text-muted-foreground text-center mb-2">
          Displaying Top 20 Holdings by Portfolio Weight
        </p>
        {footnotes.length > 0 && (
          <div className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/50">
            <p className="font-semibold mb-2">Footnotes:</p>
            <ul className="space-y-1">
              {footnotes.map((note, index) => (
                <li key={index}>
                  <sup className="text-primary font-medium mr-1">{index + 1}</sup>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
