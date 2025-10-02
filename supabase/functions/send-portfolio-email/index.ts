import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let filingId: string = '';
  let recipient: string = '';

  try {
    const requestBody = await req.json();
    filingId = requestBody.filingId;
    recipient = requestBody.recipient;
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Sending portfolio email for filing:", filingId);

    // Generate the report first
    const reportResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-portfolio-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ filingId })
    });

    if (!reportResponse.ok) {
      throw new Error('Failed to generate report');
    }

    const reportData = await reportResponse.json();
    
    // Generate HTML email
    const htmlContent = generateEmailHTML(reportData);

    // Get email credentials from Lovable Secrets
    const emailUser = Deno.env.get('EMAIL_USER');
    const emailPass = Deno.env.get('EMAIL_PASS');

    if (!emailUser || !emailPass) {
      throw new Error('Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in Lovable Secrets (Project Settings → Secrets).');
    }

    console.log("Configuring Gmail SMTP with user:", emailUser);

    // Send email via Gmail SMTP (port 587 with STARTTLS)
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 587,
        tls: true,
        auth: {
          username: emailUser,
          password: emailPass
        }
      }
    });

    console.log("Sending email to:", recipient);
    
    await client.send({
      from: emailUser,
      to: recipient,
      subject: `Duquesne Family Office - ${reportData.currentFiling.quarter} ${reportData.currentFiling.year} Portfolio Update`,
      html: htmlContent
    });

    await client.close();

    console.log("Email sent successfully");

    // Log the email delivery
    await supabase.from('email_logs').insert({
      filing_id: filingId,
      recipient,
      status: 'sent'
    });

    console.log("Email logged successfully");

    return new Response(
      JSON.stringify({ 
        status: 'success', 
        message: 'Email sent successfully' 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error sending email:', errorMessage);
    console.error('Full error:', error);
    
    // Log the error to database if we have filingId and recipient
    if (filingId && recipient) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        await supabase.from('email_logs').insert({
          filing_id: filingId,
          recipient,
          status: 'failed',
          error_message: errorMessage
        });
      } catch (logError) {
        console.error('Failed to log error to database:', logError);
      }
    }

    return new Response(
      JSON.stringify({ 
        status: 'error', 
        message: errorMessage 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function generateEmailHTML(reportData: any): string {
  const { currentFiling, comparisonData, summary } = reportData;
  
  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);
  
  const formatPercent = (value: number) => 
    `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  
  const changeColor = (value: number) => 
    value >= 0 ? '#10B981' : '#EF4444';

  const topHoldings = comparisonData.slice(0, 15);

  let tableRows = '';
  for (const holding of topHoldings) {
    tableRows += `
      <tr style="border-bottom: 1px solid #E5E7EB;">
        <td style="padding: 12px 8px; text-align: left; font-weight: 500;">${holding.company}</td>
        <td style="padding: 12px 8px; text-align: right;">${formatCurrency(holding.currentValue)}</td>
        <td style="padding: 12px 8px; text-align: right;">${holding.currentPct.toFixed(2)}%</td>
        <td style="padding: 12px 8px; text-align: right;">${formatCurrency(holding.priorQValue)}</td>
        <td style="padding: 12px 8px; text-align: right;">${holding.priorQPct.toFixed(2)}%</td>
        <td style="padding: 12px 8px; text-align: right; color: ${changeColor(holding.qoqValueChange)};">${formatCurrency(holding.qoqValueChange)}</td>
        <td style="padding: 12px 8px; text-align: right; color: ${changeColor(holding.qoqPctChange)};">${formatPercent(holding.qoqPctChange)}</td>
        <td style="padding: 12px 8px; text-align: right;">${formatCurrency(holding.priorYValue)}</td>
        <td style="padding: 12px 8px; text-align: right;">${holding.priorYPct.toFixed(2)}%</td>
        <td style="padding: 12px 8px; text-align: right; color: ${changeColor(holding.yoyValueChange)};">${formatCurrency(holding.yoyValueChange)}</td>
        <td style="padding: 12px 8px; text-align: right; color: ${changeColor(holding.yoyPctChange)};">${formatPercent(holding.yoyPctChange)}</td>
      </tr>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portfolio Update</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #F9FAFB;">
  <div style="max-width: 1200px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px;">
      <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700;">Duquesne Family Office LLC</h1>
      <p style="margin: 0; font-size: 18px; opacity: 0.9;">${currentFiling.quarter} ${currentFiling.year} Portfolio Update</p>
    </div>

    <!-- AI Summary -->
    <div style="background: white; padding: 24px; border-radius: 12px; margin-bottom: 30px; border-left: 4px solid #3B82F6;">
      <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #1F2937;">Executive Summary</h2>
      <p style="margin: 0; color: #4B5563; line-height: 1.6;">${summary}</p>
    </div>

    <!-- Portfolio Table -->
    <div style="background: white; padding: 24px; border-radius: 12px; overflow-x: auto;">
      <h2 style="margin: 0 0 20px 0; font-size: 20px; color: #1F2937;">Portfolio Holdings</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background-color: #F3F4F6; border-bottom: 2px solid #E5E7EB;">
            <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Company</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">Current ($)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">Current (%)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">Prior Q ($)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">Prior Q (%)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">QoQ Δ ($)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">QoQ Δ (%)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">Prior Y ($)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">Prior Y (%)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">YoY Δ ($)</th>
            <th style="padding: 12px 8px; text-align: right; font-weight: 600; color: #374151;">YoY Δ (%)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 30px; padding: 20px; color: #6B7280; font-size: 12px;">
      <p style="margin: 0;">Automated Portfolio Tracker | Filing Date: ${currentFiling.filing_date}</p>
      <p style="margin: 8px 0 0 0;">Data source: SEC 13F-HR Filings</p>
    </div>
  </div>
</body>
</html>
  `;
}
