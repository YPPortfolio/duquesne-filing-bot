import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to normalize ticker symbols for Yahoo Finance
function normalizeTicker(ticker: string): string {
  return ticker.replace(/\./g, '-').trim().toUpperCase();
}

// Helper function to convert CUSIP to ticker via OpenFIGI API
async function cusipToTicker(cusip: string): Promise<string | null> {
  if (!cusip) return null;

  try {
    console.log(`Attempting to map CUSIP ${cusip} to ticker via OpenFIGI`);
    
    const response = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        idType: 'ID_CUSIP',
        idValue: cusip
      }])
    });

    if (!response.ok) {
      console.error(`OpenFIGI API error for CUSIP ${cusip}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (Array.isArray(data) && data.length > 0) {
      const mapping = data[0]?.data?.[0];
      const ticker = mapping?.ticker;
      
      if (ticker) {
        console.log(`Mapped CUSIP ${cusip} to ticker ${ticker}`);
        return ticker;
      }
    }

    console.log(`No ticker found for CUSIP ${cusip}`);
    return null;
  } catch (error) {
    console.error(`Error mapping CUSIP ${cusip}:`, error);
    return null;
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

// Helper function to fetch EOD price with database caching and retries
async function getEodPrice(
  supabase: any,
  ticker: string | null,
  reportDate: string,
  retries: number = 3
): Promise<number | null> {
  if (!ticker) {
    console.log('No ticker provided, skipping EOD price fetch');
    return null;
  }

  const normalizedTicker = normalizeTicker(ticker);
  const cacheKey = `${normalizedTicker}-${reportDate}`;

  // Check database cache first
  try {
    const { data: cachedPrice } = await supabase
      .from('price_cache')
      .select('price')
      .eq('ticker', normalizedTicker)
      .eq('report_date', reportDate)
      .maybeSingle();

    if (cachedPrice) {
      console.log(`Using cached price from database for ${normalizedTicker} on ${reportDate}: $${cachedPrice.price}`);
      return cachedPrice.price;
    }
  } catch (error) {
    console.error(`Error checking price cache:`, error);
  }

  // Fetch from Yahoo Finance with retries
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const date = new Date(reportDate);
      const startTimestamp = Math.floor(date.getTime() / 1000);
      const endTimestamp = startTimestamp + 86400;

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${normalizedTicker}?period1=${startTimestamp}&period2=${endTimestamp}&interval=1d`;
      
      console.log(`[Attempt ${attempt}/${retries}] Fetching EOD price for ${normalizedTicker} on ${reportDate}`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      if (!response.ok) {
        console.error(`Yahoo Finance API error for ${normalizedTicker}: ${response.status}`);
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        break;
      }

      const data = await response.json();
      const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
      
      if (quotes && quotes.close && quotes.close.length > 0) {
        const closePrice = quotes.close[quotes.close.length - 1];
        const roundedPrice = Math.round(closePrice * 100) / 100;
        
        console.log(`EOD price for ${normalizedTicker}: $${roundedPrice}`);
        
        // Save to database cache
        try {
          await supabase
            .from('price_cache')
            .upsert({
              ticker: normalizedTicker,
              report_date: reportDate,
              price: roundedPrice
            }, {
              onConflict: 'ticker,report_date'
            });
        } catch (error) {
          console.error(`Error saving to price cache:`, error);
        }
        
        return roundedPrice;
      }

      console.log(`No price data found for ${normalizedTicker} on ${reportDate}`);
      
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
      
    } catch (error) {
      console.error(`[Attempt ${attempt}/${retries}] Error fetching EOD price for ${normalizedTicker}:`, error);
      
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // Cache null result to avoid repeated failed lookups
  try {
    await supabase
      .from('price_cache')
      .upsert({
        ticker: normalizedTicker,
        report_date: reportDate,
        price: null
      }, {
        onConflict: 'ticker,report_date'
      });
  } catch (error) {
    console.error(`Error caching null price:`, error);
  }

  return null;
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

  // Get reporting dates for each period
  const currentReportDate = getQuarterEndDate(current.quarter, current.year);
  const priorQReportDate = priorQ ? getQuarterEndDate(priorQ.quarter, priorQ.year) : '';
  const priorYReportDate = priorY ? getQuarterEndDate(priorY.quarter, priorY.year) : '';

  console.log(`Report dates - Current: ${currentReportDate}, Prior Q: ${priorQReportDate}, Prior Y: ${priorYReportDate}`);

  // First pass: resolve tickers from CUSIPs if needed
  const tickerResolutionPromises = [];
  for (const holding of currentHoldings) {
    if (!holding.ticker && holding.cusip) {
      tickerResolutionPromises.push(
        cusipToTicker(holding.cusip).then(ticker => {
          if (ticker) {
            holding.ticker = ticker;
          }
        })
      );
    }
  }

  if (tickerResolutionPromises.length > 0) {
    console.log(`Resolving ${tickerResolutionPromises.length} CUSIP-to-ticker mappings...`);
    await Promise.all(tickerResolutionPromises);
  }

  // Collect all unique tickers and dates for batch processing
  const priceRequests: Promise<number | null>[] = [];
  const requestMap: { [key: string]: number } = {};
  
  for (const holding of currentHoldings) {
    const priorQHolding = priorQ?.holdings?.find((h: any) => h.cusip === holding.cusip);
    const priorYHolding = priorY?.holdings?.find((h: any) => h.cusip === holding.cusip);

    // Queue up all price requests
    if (holding.ticker) {
      const currentKey = `${holding.ticker}-${currentReportDate}`;
      if (!(currentKey in requestMap)) {
        requestMap[currentKey] = priceRequests.length;
        priceRequests.push(getEodPrice(supabase, holding.ticker, currentReportDate));
      }
    }

    if (priorQHolding?.ticker && priorQReportDate) {
      const priorQKey = `${priorQHolding.ticker}-${priorQReportDate}`;
      if (!(priorQKey in requestMap)) {
        requestMap[priorQKey] = priceRequests.length;
        priceRequests.push(getEodPrice(supabase, priorQHolding.ticker, priorQReportDate));
      }
    }

    if (priorYHolding?.ticker && priorYReportDate) {
      const priorYKey = `${priorYHolding.ticker}-${priorYReportDate}`;
      if (!(priorYKey in requestMap)) {
        requestMap[priorYKey] = priceRequests.length;
        priceRequests.push(getEodPrice(supabase, priorYHolding.ticker, priorYReportDate));
      }
    }
  }

  // Fetch all prices in parallel
  console.log(`Fetching ${priceRequests.length} unique stock prices...`);
  const prices = await Promise.all(priceRequests);
  
  // Rebuild the price cache from results
  const priceResults: { [key: string]: number | null } = {};
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

    // Get EOD prices from cache (null means no price data available)
    const currentKey = `${holding.ticker}-${currentReportDate}`;
    const priorQKey = `${priorQHolding?.ticker}-${priorQReportDate}`;
    const priorYKey = `${priorYHolding?.ticker}-${priorYReportDate}`;

    const currentEodPrice = priceResults[currentKey];
    const priorQEodPrice = priceResults[priorQKey];
    const priorYEodPrice = priceResults[priorYKey];

    const row = {
      company: holding.company_name,
      ticker: holding.ticker || 'N/A',
      currentValue: holding.value_usd,
      currentPct: holding.percentage_of_portfolio,
      currentAvgPrice: currentAvgPrice,
      currentEodPrice: currentEodPrice ?? 0, // Use 0 for display if no price found
      priorQValue: priorQHolding?.value_usd || 0,
      priorQPct: priorQHolding?.percentage_of_portfolio || 0,
      priorQAvgPrice: priorQAvgPrice,
      priorQEodPrice: priorQEodPrice ?? 0,
      qoqValueChange: holding.value_usd - (priorQHolding?.value_usd || 0),
      qoqPctChange: holding.percentage_of_portfolio - (priorQHolding?.percentage_of_portfolio || 0),
      qoqAvgPriceChange: currentAvgPrice - priorQAvgPrice,
      qoqEodPriceChange: currentEodPrice && priorQEodPrice ? currentEodPrice - priorQEodPrice : 0,
      priorYValue: priorYHolding?.value_usd || 0,
      priorYPct: priorYHolding?.percentage_of_portfolio || 0,
      priorYAvgPrice: priorYAvgPrice,
      priorYEodPrice: priorYEodPrice ?? 0,
      yoyValueChange: holding.value_usd - (priorYHolding?.value_usd || 0),
      yoyPctChange: holding.percentage_of_portfolio - (priorYHolding?.percentage_of_portfolio || 0),
      yoyAvgPriceChange: currentAvgPrice - priorYAvgPrice,
      yoyEodPriceChange: currentEodPrice && priorYEodPrice ? currentEodPrice - priorYEodPrice : 0
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
