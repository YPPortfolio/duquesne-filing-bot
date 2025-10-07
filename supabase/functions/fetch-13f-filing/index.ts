import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DUQUESNE_CIK = "0001536411"; // Duquesne Family Office LLC CIK

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== Starting fetch-13f-filing function ===");
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Fetching 13F filings for Duquesne Family Office...");

    // Fetch submissions from SEC EDGAR
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${DUQUESNE_CIK.padStart(10, '0')}.json`;
    console.log("Fetching submissions from:", submissionsUrl);
    
    const submissionsResponse = await fetch(submissionsUrl, {
      headers: {
        'User-Agent': 'Portfolio Tracker peacenlov32@gmail.com',
        'Accept': 'application/json'
      }
    });

    console.log("SEC API response status:", submissionsResponse.status);

    if (!submissionsResponse.ok) {
      const errorText = await submissionsResponse.text();
      console.error("SEC API error response:", errorText);
      throw new Error(`SEC API error: ${submissionsResponse.status} - ${errorText}`);
    }

    const submissionsData = await submissionsResponse.json();
    const allFilings = submissionsData.filings.recent;

    // Find 13F-HR filings
    const filings13F = [];
    for (let i = 0; i < allFilings.form.length; i++) {
      if (allFilings.form[i] === '13F-HR') {
        filings13F.push({
          accessionNumber: allFilings.accessionNumber[i],
          filingDate: allFilings.filingDate[i],
          reportDate: allFilings.reportDate[i],
          primaryDocument: allFilings.primaryDocument[i]
        });
      }
    }

    // Get only the 3 specific quarters needed:
    // 1. Latest quarter
    // 2. Prior quarter (one before latest)
    // 3. Same quarter from 1 year ago
    const recentFilings = [];
    
    if (filings13F.length > 0) {
      // Get latest quarter
      const latest = filings13F[0];
      recentFilings.push(latest);
      
      // Get prior quarter (second most recent)
      if (filings13F.length > 1) {
        recentFilings.push(filings13F[1]);
      }
      
      // Find same quarter from 1 year ago
      const latestReportDate = new Date(latest.reportDate);
      const latestQuarter = Math.floor(latestReportDate.getMonth() / 3) + 1;
      const latestYear = latestReportDate.getFullYear();
      const targetYear = latestYear - 1;
      
      const yearAgoFiling = filings13F.find(f => {
        const reportDate = new Date(f.reportDate);
        const quarter = Math.floor(reportDate.getMonth() / 3) + 1;
        const year = reportDate.getFullYear();
        return quarter === latestQuarter && year === targetYear;
      });
      
      if (yearAgoFiling) {
        recentFilings.push(yearAgoFiling);
      }
    }
    
    const processedFilings = [];

    for (const filing of recentFilings) {
      // Parse quarter and year from report date (not filing date!)
      const reportDate = new Date(filing.reportDate);
      const quarter = `Q${Math.floor(reportDate.getMonth() / 3) + 1}`;
      const year = reportDate.getFullYear();

      // Check if we already have this filing
      const { data: existingFiling } = await supabase
        .from('filings')
        .select('id')
        .eq('cik', DUQUESNE_CIK)
        .eq('quarter', quarter)
        .eq('year', year)
        .maybeSingle();

      if (existingFiling) {
        console.log(`Filing for ${quarter} ${year} already exists, skipping...`);
        continue;
      }

      // Construct the information table filename based on report date
      const accessionNoSlash = filing.accessionNumber.replace(/-/g, '');
      const reportDateStr = filing.reportDate.replace(/-/g, ''); // Convert YYYY-MM-DD to YYYYMMDD
      const infoTableFilename = `form13f_${reportDateStr}.xml`;
      
      // Construct filing URL
      const filingUrl = `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${DUQUESNE_CIK}&accession_number=${filing.accessionNumber}&xbrl_type=v`;

      // Fetch the information table XML (this contains the actual holdings)
      const docUrl = `https://www.sec.gov/Archives/edgar/data/${DUQUESNE_CIK}/${accessionNoSlash}/${infoTableFilename}`;
      console.log("Fetching information table:", docUrl);

      const docResponse = await fetch(docUrl, {
        headers: {
          'User-Agent': 'Portfolio Tracker peacenlov32@gmail.com'
        }
      });

      if (!docResponse.ok) {
        console.error(`Failed to fetch document: ${docResponse.status}`);
        continue;
      }

      const xmlText = await docResponse.text();
      
      // Parse holdings from XML
      const holdings = parseHoldings(xmlText);
      
      if (holdings.length === 0) {
        console.error("No holdings found in filing");
        continue;
      }

      // Calculate total portfolio value
      const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

      // Insert filing record
      const { data: filingRecord, error: filingError } = await supabase
        .from('filings')
        .insert({
          cik: DUQUESNE_CIK,
          company_name: 'Duquesne Family Office LLC',
          filing_date: filing.filingDate,
          quarter,
          year,
          filing_url: filingUrl
        })
        .select()
        .single();

      if (filingError) {
        console.error("Error inserting filing:", filingError);
        continue;
      }

      // Insert holdings
      const holdingsToInsert = holdings.map(h => ({
        filing_id: filingRecord.id,
        company_name: h.nameOfIssuer,
        cusip: h.cusip,
        shares: h.shares,
        value_usd: h.value,
        percentage_of_portfolio: (h.value / totalValue) * 100
      }));

      const { error: holdingsError } = await supabase
        .from('holdings')
        .insert(holdingsToInsert);

      if (holdingsError) {
        console.error("Error inserting holdings:", holdingsError);
      } else {
        console.log(`Successfully processed filing for ${quarter} ${year}`);
        processedFilings.push(filingRecord);
      }
    }

    console.log(`=== Function completed successfully. Processed ${processedFilings.length} filing(s) ===`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${processedFilings.length} new filing(s)`,
        filings: processedFilings
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('=== Error in fetch-13f-filing ===');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error instanceof Error ? error.stack : String(error)
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function parseHoldings(xmlText: string): Array<{nameOfIssuer: string, cusip: string, shares: number, value: number}> {
  const holdings: Array<{nameOfIssuer: string, cusip: string, shares: number, value: number}> = [];
  
  // Parse XML using regex (simple approach for structured SEC XML)
  const infoTableRegex = /<infoTable>([\s\S]*?)<\/infoTable>/g;
  let match;
  
  while ((match = infoTableRegex.exec(xmlText)) !== null) {
    const tableContent = match[1];
    
    const nameMatch = /<nameOfIssuer>(.*?)<\/nameOfIssuer>/.exec(tableContent);
    const cusipMatch = /<cusip>(.*?)<\/cusip>/.exec(tableContent);
    const sharesMatch = /<sshPrnamt>(.*?)<\/sshPrnamt>/.exec(tableContent);
    const valueMatch = /<value>(.*?)<\/value>/.exec(tableContent);
    
    if (nameMatch && cusipMatch && valueMatch) {
      holdings.push({
        nameOfIssuer: nameMatch[1].trim(),
        cusip: cusipMatch[1].trim(),
        shares: sharesMatch ? parseInt(sharesMatch[1]) : 0,
        value: parseInt(valueMatch[1]) * 1000 // SEC reports in thousands
      });
    }
  }
  
  return holdings;
}
