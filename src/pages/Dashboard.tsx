import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Mail } from "lucide-react";
import { PortfolioTable } from "@/components/PortfolioTable";
import { PortfolioSummary } from "@/components/PortfolioSummary";

export default function Dashboard() {
  const [filings, setFilings] = useState<any[]>([]);
  const [selectedFiling, setSelectedFiling] = useState<any>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingNew, setIsFetchingNew] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const { toast } = useToast();

  // Keep the UI focused on only 3 quarters:
  // 1) Latest available quarter
  // 2) Quarter before the latest
  // 3) Same quarter from 1 year before the latest
  const getRelevantFilings = (list: any[]) => {
    if (!list || list.length === 0) return [] as any[];
    // Ensure sorted by date desc in case upstream changes
    const sorted = [...list].sort(
      (a, b) => new Date(b.filing_date).getTime() - new Date(a.filing_date).getTime()
    );
    const latest = sorted[0];
    const result: any[] = [latest];
    if (sorted.length > 1) result.push(sorted[1]);
    const yearAgo = sorted.find(
      (f) => f.quarter === latest.quarter && f.year === latest.year - 1
    );
    if (yearAgo && !result.find((r) => r.id === yearAgo.id)) result.push(yearAgo);
    return result;
  };

  useEffect(() => {
    loadFilings();
  }, []);

  const loadFilings = async () => {
    const { data, error } = await supabase
      .from('filings')
      .select('*')
      .order('filing_date', { ascending: false });
    
    if (error) {
      toast({
        title: "Error loading filings",
        description: error.message,
        variant: "destructive"
      });
      return [] as any[];
    }

    setFilings(data || []);
    if (data && data.length > 0 && !selectedFiling) {
      loadReport(data[0].id);
      setSelectedFiling(data[0]);
    }
    return data || [];
  };

  const loadReport = async (filingId: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-portfolio-report', {
        body: { filingId }
      });

      if (error) throw error;
      setReportData(data);
    } catch (error: any) {
      toast({
        title: "Error generating report",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNewFilings = async () => {
    setIsFetchingNew(true);
    try {
      console.log("Calling fetch-13f-filing edge function...");
      
      const { data, error } = await supabase.functions.invoke('fetch-13f-filing', {
        body: {}
      });
      
      console.log("Edge function response:", { data, error });
      
      if (error) {
        console.error("Edge function error:", error);
        throw new Error(error.message || "Failed to fetch filings from edge function");
      }
      
      toast({
        title: "Success",
        description: data?.message || "Filings checked successfully"
      });
      
      const newList = await loadFilings();
      const filtered = getRelevantFilings(newList || []);
      if (filtered.length > 0) {
        setSelectedFiling(filtered[0]);
        await loadReport(filtered[0].id);
      } else {
        setSelectedFiling(null);
        setReportData(null);
      }
    } catch (error: any) {
      console.error("Fetch filings error:", error);
      toast({
        title: "Error fetching filings",
        description: error.message || "Failed to send a request to the Edge Function",
        variant: "destructive"
      });
    } finally {
      setIsFetchingNew(false);
    }
  };

  const sendEmail = async () => {
    if (!selectedFiling) return;
    
    setIsSendingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-portfolio-email', {
        body: { 
          filingId: selectedFiling.id,
          recipient: 'peacenlov32@gmail.com'
        }
      });

      if (error) throw error;
      
      // Display the backend response message
      if (data?.status === 'success') {
        toast({
          title: "Success",
          description: data.message || "Portfolio report has been emailed successfully"
        });
      } else if (data?.status === 'error') {
        toast({
          title: "Email Error",
          description: data.message || "Failed to send email",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Email sent",
          description: "Portfolio report has been emailed successfully"
        });
      }
    } catch (error: any) {
      toast({
        title: "Error sending email",
        description: error.message || "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const filteredFilings = getRelevantFilings(filings);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-blue-600 text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2">Duquesne Family Office LLC</h1>
              <p className="text-lg opacity-90">SEC 13F Portfolio Tracker</p>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={fetchNewFilings}
                disabled={isFetchingNew}
                variant="secondary"
                className="gap-2"
              >
                {isFetchingNew ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Fetch New Filings
              </Button>
              <Button
                onClick={sendEmail}
                disabled={isSendingEmail || !selectedFiling}
                variant="secondary"
                className="gap-2"
              >
                {isSendingEmail ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Email Report
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Quarter Selector */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-2 flex-wrap">
          {filteredFilings.map((filing) => (
            <Button
              key={filing.id}
              onClick={() => {
                setSelectedFiling(filing);
                loadReport(filing.id);
              }}
              variant={selectedFiling?.id === filing.id ? "default" : "outline"}
              className="gap-2"
            >
              {filing.quarter} {filing.year}
            </Button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : reportData ? (
          <div className="space-y-6">
            {/* AI Summary */}
            {reportData.summary && (
              <PortfolioSummary summary={reportData.summary} filing={selectedFiling} />
            )}

            {/* Portfolio Table */}
            {reportData.comparisonData && (
              <PortfolioTable data={reportData.comparisonData} />
            )}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">
              {filings.length === 0 
                ? "No filings available. Click 'Fetch New Filings' to get started."
                : "Select a quarter to view portfolio data"}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
