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
      return;
    }

    setFilings(data || []);
    if (data && data.length > 0 && !selectedFiling) {
      loadReport(data[0].id);
      setSelectedFiling(data[0]);
    }
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
      const { data, error } = await supabase.functions.invoke('fetch-13f-filing');
      
      if (error) throw error;
      
      toast({
        title: "Success",
        description: data.message || "Filings checked successfully"
      });
      
      await loadFilings();
    } catch (error: any) {
      toast({
        title: "Error fetching filings",
        description: error.message,
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
      
      toast({
        title: "Email sent",
        description: "Portfolio report has been emailed successfully"
      });
    } catch (error: any) {
      toast({
        title: "Error sending email",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

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
          {filings.map((filing) => (
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
