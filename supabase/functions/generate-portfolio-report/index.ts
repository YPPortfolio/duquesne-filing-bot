import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Generate comparison table
    const comparisonData = generateComparisonTable(
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

function generateComparisonTable(current: any, priorQ: any, priorY: any) {
  const tableData = [];
  const currentHoldings = current.holdings || [];

  for (const holding of currentHoldings) {
    const priorQHolding = priorQ?.holdings?.find((h: any) => h.cusip === holding.cusip);
    const priorYHolding = priorY?.holdings?.find((h: any) => h.cusip === holding.cusip);

    const row = {
      company: holding.company_name,
      currentValue: holding.value_usd,
      currentPct: holding.percentage_of_portfolio,
      priorQValue: priorQHolding?.value_usd || 0,
      priorQPct: priorQHolding?.percentage_of_portfolio || 0,
      qoqValueChange: holding.value_usd - (priorQHolding?.value_usd || 0),
      qoqPctChange: holding.percentage_of_portfolio - (priorQHolding?.percentage_of_portfolio || 0),
      priorYValue: priorYHolding?.value_usd || 0,
      priorYPct: priorYHolding?.percentage_of_portfolio || 0,
      yoyValueChange: holding.value_usd - (priorYHolding?.value_usd || 0),
      yoyPctChange: holding.percentage_of_portfolio - (priorYHolding?.percentage_of_portfolio || 0)
    };

    tableData.push(row);
  }

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
    
    // Post-process to ensure all dollar amounts have "$" symbol
    // Match complete numbers (with optional decimals) followed by M or B
    // Only add $ if not already present
    summary = summary.replace(/(?<!\$)\b(\d+(?:\.\d+)?[MB])\b/g, '$$$1');
    
    return summary;
  } catch (error) {
    console.error('Error generating AI summary:', error);
    return "AI summary unavailable";
  }
}
