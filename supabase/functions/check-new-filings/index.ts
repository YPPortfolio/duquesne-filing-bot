import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Running automated filing check...");

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // Step 1: Fetch new 13F filings
    console.log("Step 1: Fetching 13F filings...");
    const fetchResponse = await fetch(`${SUPABASE_URL}/functions/v1/fetch-13f-filing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });

    const fetchData = await fetchResponse.json();
    console.log("Fetch result:", fetchData);

    if (!fetchData.success || !fetchData.filings || fetchData.filings.length === 0) {
      console.log("No new filings to process");
      return new Response(
        JSON.stringify({ success: true, message: 'No new filings found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: For each new filing, generate report and send email
    const results = [];
    for (const filing of fetchData.filings) {
      console.log(`Processing filing ${filing.id}...`);

      // Send email
      const emailResponse = await fetch(`${SUPABASE_URL}/functions/v1/send-portfolio-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          filingId: filing.id,
          recipient: 'peacenlov32@gmail.com'
        })
      });

      const emailData = await emailResponse.json();
      results.push({
        filing: `${filing.quarter} ${filing.year}`,
        emailStatus: emailData.success ? 'sent' : 'failed'
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${results.length} filing(s)`,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in check-new-filings:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
