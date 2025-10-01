import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DUQUESNE_CIK = "0001067293"; // Duquesne Family Office LLC CIK

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Fetching 13F filings for Duquesne Family Office...");

    // Fetch submissions from SEC EDGAR
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${DUQUESNE_CIK.padStart(10, '0')}.json`;
    const submissionsResponse = await fetch(submissionsUrl, {
      headers: {
        'User-Agent': 'Portfolio Tracker peacenlov32@gmail.com',
        'Accept': 'application/json'
      }
    });

    if (!submissionsResponse.ok) {
      throw new Error(`SEC API error: ${submissionsResponse.status}`);
    }

    const submissionsData = await submissionsResponse.json();
    const recentFilings = submissionsData.filings.recent;

    // Find 13F-HR filings
    const filings13F = [];
    for (let i = 0; i < recentFilings.form.length; i++) {
      if (recentFilings.form[i] === '13F-HR') {
        filings13F.push({
          accessionNumber: recentFilings.accessionNumber[i],
          filingDate: recentFilings.filingDate[i],
          reportDate: recentFilings.reportDate[i],
          primaryDocument: recentFilings.primaryDocument[i]
        });
      }
    }

    // Get the 3 most recent filings
    const recentThree = filings13F.slice(0, 3);
    
    const processedFilings = [];

    for (const filing of recentThree) {
      // Parse quarter and year from filing date
      const filingDate = new Date(filing.filingDate);
      const quarter = `Q${Math.floor(filingDate.getMonth() / 3) + 1}`;
      const year = filingDate.getFullYear();

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

      // Fetch the information table (primary document)
      const accessionNoSlash = filing.accessionNumber.replace(/-/g, '');
      const xmlUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${DUQUESNE_CIK}&type=13F-HR&dateb=&owner=exclude&count=100&search_text=`;
      
      // Construct filing URL
      const filingUrl = `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${DUQUESNE_CIK}&accession_number=${filing.accessionNumber}&xbrl_type=v`;

      // Try to fetch the primary document (information table XML)
      const docUrl = `https://www.sec.gov/Archives/edgar/data/${DUQUESNE_CIK}/${accessionNoSlash}/${filing.primaryDocument}`;
      console.log("Fetching document:", docUrl);

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

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${processedFilings.length} new filing(s)`,
        filings: processedFilings
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in fetch-13f-filing:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
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
