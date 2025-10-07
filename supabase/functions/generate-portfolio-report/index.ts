import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Price cache to avoid duplicate API calls
const priceCache: { [key: string]: number } = {};

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

// Helper function to fetch EOD price from Yahoo Finance with caching
async function getEodPrice(ticker: string | null, reportDate: string): Promise<number> {
  if (!ticker) {
    console.log('No ticker provided, skipping EOD price fetch');
    return 0;
  }

  // Check cache first
  const cacheKey = `${ticker}-${reportDate}`;
  if (priceCache[cacheKey] !== undefined) {
    console.log(`Using cached price for ${ticker} on ${reportDate}: $${priceCache[cacheKey]}`);
    return priceCache[cacheKey];
  }

  try {
    // Convert date to Unix timestamp
    const date = new Date(reportDate);
    const startTimestamp = Math.floor(date.getTime() / 1000);
    const endTimestamp = startTimestamp + 86400; // Add 1 day

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startTimestamp}&period2=${endTimestamp}&interval=1d`;
    
    console.log(`Fetching EOD price for ${ticker} on ${reportDate}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      console.error(`Yahoo Finance API error for ${ticker}: ${response.status}`);
      priceCache[cacheKey] = 0;
      return 0;
    }

    const data = await response.json();
    const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
    
    if (quotes && quotes.close && quotes.close.length > 0) {
      const closePrice = quotes.close[quotes.close.length - 1];
      console.log(`EOD price for ${ticker}: $${closePrice}`);
      priceCache[cacheKey] = closePrice || 0;
      return closePrice || 0;
    }

    console.log(`No price data found for ${ticker} on ${reportDate}`);
    priceCache[cacheKey] = 0;
    return 0;
  } catch (error) {
    console.error(`Error fetching EOD price for ${ticker}:`, error);
    priceCache[cacheKey] = 0;
    return 0;
  }
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
      priorYearFiling
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

async function generateComparisonTable(current: any, priorQ: any, priorY: any) {
  const tableData = [];
  const currentHoldings = current.holdings || [];

  // Get reporting dates for each period
  const currentReportDate = getQuarterEndDate(current.quarter, current.year);
  const priorQReportDate = priorQ ? getQuarterEndDate(priorQ.quarter, priorQ.year) : '';
  const priorYReportDate = priorY ? getQuarterEndDate(priorY.quarter, priorY.year) : '';

  console.log(`Report dates - Current: ${currentReportDate}, Prior Q: ${priorQReportDate}, Prior Y: ${priorYReportDate}`);

  // Collect all unique tickers and dates for batch processing
  const priceRequests: Promise<number>[] = [];
  const requestMap: { [key: string]: number } = {};
  
  for (const holding of currentHoldings) {
    const priorQHolding = priorQ?.holdings?.find((h: any) => h.cusip === holding.cusip);
    const priorYHolding = priorY?.holdings?.find((h: any) => h.cusip === holding.cusip);

    // Queue up all price requests
    if (holding.ticker) {
      const currentKey = `${holding.ticker}-${currentReportDate}`;
      if (!(currentKey in requestMap)) {
        requestMap[currentKey] = priceRequests.length;
        priceRequests.push(getEodPrice(holding.ticker, currentReportDate));
      }
    }

    if (priorQHolding?.ticker && priorQReportDate) {
      const priorQKey = `${priorQHolding.ticker}-${priorQReportDate}`;
      if (!(priorQKey in requestMap)) {
        requestMap[priorQKey] = priceRequests.length;
        priceRequests.push(getEodPrice(priorQHolding.ticker, priorQReportDate));
      }
    }

    if (priorYHolding?.ticker && priorYReportDate) {
      const priorYKey = `${priorYHolding.ticker}-${priorYReportDate}`;
      if (!(priorYKey in requestMap)) {
        requestMap[priorYKey] = priceRequests.length;
        priceRequests.push(getEodPrice(priorYHolding.ticker, priorYReportDate));
      }
    }
  }

  // Fetch all prices in parallel
  console.log(`Fetching ${priceRequests.length} unique stock prices...`);
  const prices = await Promise.all(priceRequests);
  
  // Rebuild the price cache from results
  const priceResults: { [key: string]: number } = {};
  let index = 0;
  for (const key in requestMap) {
    priceResults[key] = prices[requestMap[key]];
  }

  // Now build the comparison table with cached prices
  for (const holding of currentHoldings) {
    const priorQHolding = priorQ?.holdings?.find((h: any) => h.cusip === holding.cusip);
    const priorYHolding = priorY?.holdings?.find((h: any) => h.cusip === holding.cusip);

    // Calculate average purchase price
    const currentAvgPrice = holding.shares > 0 ? holding.value_usd / holding.shares : 0;
    const priorQAvgPrice = priorQHolding?.shares > 0 ? priorQHolding.value_usd / priorQHolding.shares : 0;
    const priorYAvgPrice = priorYHolding?.shares > 0 ? priorYHolding.value_usd / priorYHolding.shares : 0;

    // Get EOD prices from cache
    const currentKey = `${holding.ticker}-${currentReportDate}`;
    const priorQKey = `${priorQHolding?.ticker}-${priorQReportDate}`;
    const priorYKey = `${priorYHolding?.ticker}-${priorYReportDate}`;

    const currentEodPrice = priceResults[currentKey] || 0;
    const priorQEodPrice = priceResults[priorQKey] || 0;
    const priorYEodPrice = priceResults[priorYKey] || 0;

    const row = {
      company: holding.company_name,
      currentValue: holding.value_usd,
      currentPct: holding.percentage_of_portfolio,
      currentAvgPrice: currentAvgPrice,
      currentEodPrice: currentEodPrice || currentAvgPrice, // Fallback to avg price if API fails
      priorQValue: priorQHolding?.value_usd || 0,
      priorQPct: priorQHolding?.percentage_of_portfolio || 0,
      priorQAvgPrice: priorQAvgPrice,
      priorQEodPrice: priorQEodPrice || priorQAvgPrice,
      qoqValueChange: holding.value_usd - (priorQHolding?.value_usd || 0),
      qoqPctChange: holding.percentage_of_portfolio - (priorQHolding?.percentage_of_portfolio || 0),
      qoqAvgPriceChange: currentAvgPrice - priorQAvgPrice,
      qoqEodPriceChange: (currentEodPrice || currentAvgPrice) - (priorQEodPrice || priorQAvgPrice),
      priorYValue: priorYHolding?.value_usd || 0,
      priorYPct: priorYHolding?.percentage_of_portfolio || 0,
      priorYAvgPrice: priorYAvgPrice,
      priorYEodPrice: priorYEodPrice || priorYAvgPrice,
      yoyValueChange: holding.value_usd - (priorYHolding?.value_usd || 0),
      yoyPctChange: holding.percentage_of_portfolio - (priorYHolding?.percentage_of_portfolio || 0),
      yoyAvgPriceChange: currentAvgPrice - priorYAvgPrice,
      yoyEodPriceChange: (currentEodPrice || currentAvgPrice) - (priorYEodPrice || priorYAvgPrice)
    };

    tableData.push(row);
  }

  console.log(`Generated comparison data for ${tableData.length} holdings`);
  
  // Sort by current value descending
  return tableData.sort((a, b) => b.currentValue - a.currentValue);
}

async function generateAISummary(comparisonData: any[], filing: any): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return "AI summary unavailable - API key not configured";
  }

  const prompt = `Analyze this portfolio data for Duquesne Family Office LLC's ${filing.quarter} ${filing.year} 13F filing and provide a concise executive summary highlighting:
1. Top 3-5 holdings by value
2. Notable quarter-over-quarter changes (new positions, increased/decreased positions)
3. Year-over-year trends
4. Overall portfolio concentration and diversification

Portfolio Data:
${JSON.stringify(comparisonData.slice(0, 15), null, 2)}

IMPORTANT FORMATTING RULES:
- ALL dollar amounts MUST include the "$" symbol (e.g., "$132.7M", "$99.9M", "+$122.3M", "-$81.0M")
- Use consistent formatting: "$" + value + "M" or "B" for millions/billions
- Include "$" even for positive and negative changes (e.g., "+$50M", "-$25M")
- Never write amounts without the "$" symbol (e.g., "+122.3M" is WRONG, must be "+$122.3M")

Keep the summary professional, data-driven, and under 200 words.`;

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
