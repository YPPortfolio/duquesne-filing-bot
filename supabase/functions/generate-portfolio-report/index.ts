import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to normalize ticker symbols for Yahoo Finance
function normalizeTicker(ticker: string): string {
  if (!ticker) return '';
  let normalized = ticker.trim().toUpperCase();
  normalized = normalized.replace(/\./g, '-'); // BRK.B -> BRK-B
  normalized = normalized.replace(/\s+/g, ''); // Remove spaces
  return normalized;
}

// Helper function to calculate string similarity for ticker matching
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = a.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
  const tb = b.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
  const aset = new Set(ta);
  const bset = new Set(tb);
  const inter = [...aset].filter(x => bset.has(x)).length;
  const union = new Set([...ta, ...tb]).size || 1;
  return inter / union;
}

// Helper function to find ticker by company name via Yahoo Finance search
async function findTickerByName(issuerName: string): Promise<{ ticker: string | null; score: number; source: string; name?: string }> {
  if (!issuerName) return { ticker: null, score: 0, source: "none" };
  
  const q = encodeURIComponent(issuerName);
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=10&newsCount=0`;
  
  try {
    console.log(`[Yahoo Search] Looking up ticker for: ${issuerName}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    if (!res.ok) {
      console.error(`[Yahoo Search] API error for ${issuerName}: ${res.status}`);
      return { ticker: null, score: 0, source: "yahoo:err" };
    }
    
    const json = await res.json();
    const quotes = Array.isArray(json.quotes) ? json.quotes : [];
    
    let best = { ticker: null as string | null, score: 0, name: "" };
    for (const q of quotes) {
      const candName = q.longname || q.shortname || q.name || "";
      const candTicker = q.symbol || null;
      const s = similarity(issuerName, candName || candTicker || "");
      const booster = issuerName.toUpperCase().includes((candTicker || "").toUpperCase()) ? 0.15 : 0;
      const score = Math.min(1, s + booster);
      if (score > best.score) {
        best = { ticker: candTicker, score, name: candName };
      }
    }
    
    if (best.score >= 0.65) {
      console.log(`[Yahoo Search] Found ticker ${best.ticker} for ${issuerName} (score: ${best.score.toFixed(2)})`);
      return { ticker: best.ticker, score: best.score, source: "yahoo", name: best.name };
    } else {
      console.log(`[Yahoo Search] No good match for ${issuerName} (best score: ${best.score.toFixed(2)})`);
      return { ticker: null, score: best.score, source: "yahoo", name: best.name };
    }
  } catch (err) {
    console.error(`[Yahoo Search] Exception for ${issuerName}:`, err);
    return { ticker: null, score: 0, source: "yahoo:exception" };
  }
}

// Helper function to get quarter-end reporting date
function getQuarterEndDate(quarter: string, year: number): string {
  const quarterEndDates: { [key: string]: string } = {
    'Q1': `${year}-03-31`,
    'Q2': `${year}-06-30`,
    'Q3': `${year}-09-30`,
    'Q4': `${year}-12-31`,
  };
  return quarterEndDates[quarter] || `${year}-12-31`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filingId } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Generating portfolio report for filing:", filingId);

    // Get current filing details
    const { data: currentFiling, error: currentError } = await supabase
      .from('filings')
      .select('*, holdings(*)')
      .eq('id', filingId)
      .single();

    if (currentError || !currentFiling) {
      throw new Error('Filing not found');
    }

    // Get prior quarter filing
    const { data: priorQuarterFiling } = await supabase
      .from('filings')
      .select('*, holdings(*)')
      .eq('cik', currentFiling.cik)
      .lt('filing_date', currentFiling.filing_date)
      .order('filing_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get prior year same quarter filing
    const priorYear = currentFiling.year - 1;
    const { data: priorYearFiling } = await supabase
      .from('filings')
      .select('*, holdings(*)')
      .eq('cik', currentFiling.cik)
      .eq('quarter', currentFiling.quarter)
      .eq('year', priorYear)
      .maybeSingle();

    // Generate comparison table with EOD prices
    const comparisonData = await generateComparisonTable(
      currentFiling,
      priorQuarterFiling,
      priorYearFiling,
      supabase
    );

    // Generate AI summary
    const summary = await generateAISummary(comparisonData, currentFiling);

    return new Response(
      JSON.stringify({
        success: true,
        currentFiling,
        priorQuarterFiling,
        priorYearFiling,
        comparisonData,
        summary
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating report:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function generateComparisonTable(current: any, priorQ: any, priorY: any, supabase: any) {
  const tableData = [];
  const currentHoldings = current.holdings || [];

  // First pass: resolve tickers from company names using Yahoo Finance search
  const tickerResolutionPromises = [];
  for (const holding of currentHoldings) {
    if (!holding.ticker && holding.company_name) {
      tickerResolutionPromises.push(
        findTickerByName(holding.company_name).then(result => {
          if (result.ticker) {
            holding.ticker = result.ticker;
            console.log(`[Ticker] Mapped "${holding.company_name}" -> ${result.ticker}`);
          } else {
            console.log(`[Ticker] No ticker found for "${holding.company_name}"`);
          }
        })
      );
    }
  }

  if (tickerResolutionPromises.length > 0) {
    console.log(`Resolving ${tickerResolutionPromises.length} company-to-ticker mappings via Yahoo...`);
    await Promise.all(tickerResolutionPromises);
  }

  // Log resolved tickers for verification
  console.log(`[Ticker Resolution Complete] Summary:`);
  for (const holding of currentHoldings) {
    if (holding.ticker) {
      console.log(`  ✓ ${holding.company_name}: ${holding.ticker}`);
    } else {
      console.log(`  ✗ ${holding.company_name}: NO TICKER FOUND`);
    }
  }

  // Now build the comparison table
  for (const holding of currentHoldings) {
    const priorQHolding = priorQ?.holdings?.find((h: any) => h.cusip === holding.cusip);
    const priorYHolding = priorY?.holdings?.find((h: any) => h.cusip === holding.cusip);

    // Calculate average purchase price
    const currentAvgPrice = holding.shares > 0 ? holding.value_usd / holding.shares : 0;
    const priorQAvgPrice = priorQHolding?.shares > 0 ? priorQHolding.value_usd / priorQHolding.shares : 0;
    const priorYAvgPrice = priorYHolding?.shares > 0 ? priorYHolding.value_usd / priorYHolding.shares : 0;

    const row = {
      company: holding.company_name,
      ticker: holding.ticker || 'N/A',
      shares: holding.shares || 0,
      currentValue: holding.value_usd,
      currentPct: holding.percentage_of_portfolio,
      currentAvgPrice: currentAvgPrice,
      priorQValue: priorQHolding?.value_usd || 0,
      priorQPct: priorQHolding?.percentage_of_portfolio || 0,
      priorQAvgPrice: priorQAvgPrice,
      qoqValueChange: holding.value_usd - (priorQHolding?.value_usd || 0),
      qoqPctChange: holding.percentage_of_portfolio - (priorQHolding?.percentage_of_portfolio || 0),
      qoqAvgPriceChange: currentAvgPrice - priorQAvgPrice,
      qoqAvgPriceChangePct: priorQAvgPrice > 0 ? ((currentAvgPrice - priorQAvgPrice) / priorQAvgPrice) * 100 : null,
      priorYValue: priorYHolding?.value_usd || 0,
      priorYPct: priorYHolding?.percentage_of_portfolio || 0,
      priorYAvgPrice: priorYAvgPrice,
      yoyValueChange: holding.value_usd - (priorYHolding?.value_usd || 0),
      yoyPctChange: holding.percentage_of_portfolio - (priorYHolding?.percentage_of_portfolio || 0),
      yoyAvgPriceChange: currentAvgPrice - priorYAvgPrice,
      yoyAvgPriceChangePct: priorYAvgPrice > 0 ? ((currentAvgPrice - priorYAvgPrice) / priorYAvgPrice) * 100 : null
    };

    tableData.push(row);
  }

  // Calculate total portfolio value
  const totalPortfolioValue = tableData.reduce((sum, row) => sum + row.currentValue, 0);
  
  console.log(`Total Portfolio Value: $${totalPortfolioValue.toLocaleString()}`);

  // Add percentOfPortfolio based on value
  const enrichedData = tableData.map(row => ({
    ...row,
    percentOfPortfolio: totalPortfolioValue > 0 ? (row.currentValue / totalPortfolioValue) * 100 : 0
  }));

  // Sort by value descending
  enrichedData.sort((a, b) => b.currentValue - a.currentValue);

  // Take only top 20 holdings
  const top20Holdings = enrichedData.slice(0, 20);

  console.log(`Generated comparison data for ${tableData.length} holdings, showing top 20`);
  console.log(`Top 20 holdings represent ${top20Holdings.reduce((sum, h) => sum + h.percentOfPortfolio, 0).toFixed(2)}% of portfolio`);
  
  return top20Holdings;
}

async function generateAISummary(comparisonData: any[], filing: any): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return "AI summary unavailable - API key not configured";
  }

  const prompt = `Analyze this portfolio data for Duquesne Family Office LLC's ${filing.quarter} ${filing.year} 13F filing and generate an executive summary following this EXACT structure:

Portfolio Data:
${JSON.stringify(comparisonData.slice(0, 15), null, 2)}

REQUIRED STRUCTURE (follow exactly):

**Top Holdings**
• [Company Name] – $[value] ([% of total portfolio value])
• [Company Name] – $[value] ([% of total portfolio value])
• [Company Name] – $[value] ([% of total portfolio value])
• [Company Name] – $[value] ([% of total portfolio value])
• [Company Name] – $[value] ([% of total portfolio value])

**QoQ Change**

**New Position**
• [Company Name] – $[value] ([% of total portfolio value])
[List all new positions, or state "None" if no new positions]

**Increased Position**
• [Company Name] – Increased by $[Δ value] (+[Δ percentage points] percentage points of total portfolio value)
[List all increased positions, or state "None" if no increases]

**Decreased Position**
• [Company Name] – Decreased by $[Δ value] (−[Δ percentage points] percentage points of total portfolio value)
[List all decreased positions, or state "None" if no decreases]

**YoY Change**
• [Brief narrative describing notable YoY changes in same format]

CRITICAL FORMATTING RULES:
1. Use Unicode bullet character • (not dash or asterisk) for ALL list items
2. Bold section headers using **Header Text**
3. Company names should NOT be bolded in the list items
4. Dollar amounts: Always use "$" symbol with M or B suffix (e.g., "$132.7M", "$1.5B")
5. For changes, include both: dollar amount AND "([X.X]% of total portfolio value)"
6. Use exactly two decimal places for percentages
7. For increases: "Increased by $[amount] (+[percentage points] percentage points of total portfolio value)"
8. For decreases: "Decreased by $[amount] (−[percentage points] percentage points of total portfolio value)"
9. Maintain one blank line between major sections
10. Keep total summary under 250 words

DATA RULES:
- Top Holdings: Select top 5 by current value, sorted descending
- New Position: priorQValue == 0 and currentValue > 0
- Increased Position: currentValue > priorQValue (show absolute dollar change and percentage point change)
- Decreased Position: currentValue < priorQValue (show absolute dollar reduction and percentage point change)
- Percentage points refer to the change in % of total portfolio value (e.g., from 2.5% to 4.2% = +1.7 percentage points)`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a financial analyst specializing in institutional portfolio analysis.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      console.error('AI API error:', response.status);
      return "AI summary unavailable - API error";
    }

    const data = await response.json();
    let summary = data.choices[0]?.message?.content || "AI summary unavailable";

    // Fix cases where a stray "$" appears after a decimal (e.g., $132.$7M -> $132.7M)
    summary = summary.replace(/(\d)\.\$(\d)/g, '$1.$2');

    // Add a single "$" before amounts like 132.7M or +122.3M only when not already present
    // Do NOT match if preceded by a digit or a dot to avoid hitting the fractional part
    summary = summary.replace(/(?<![\$\d\.])(\d+(?:\.\d+)?[MB])\b/g, '$$$1');

    // Collapse any accidental multiple dollar signs (e.g., $$132.7M -> $132.7M)
    summary = summary.replace(/\${2,}/g, '$');

    return summary;
  } catch (error) {
    console.error('Error generating AI summary:', error);
    return "AI summary unavailable";
  }
}
