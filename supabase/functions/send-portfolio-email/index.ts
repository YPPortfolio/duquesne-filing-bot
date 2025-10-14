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

    // Generate the report first using the Supabase client (no direct HTTP fetch)
    const { data: reportData, error: reportError } = await supabase.functions.invoke('generate-portfolio-report', {
      body: { filingId }
    });

    if (reportError) {
      console.error('generate-portfolio-report error:', reportError);
      throw new Error(`Failed to generate report: ${reportError.message || 'unknown error'}`);
    }

    // Generate HTML email
    const htmlContent = generateEmailHTML(reportData);

    // Get email credentials from Lovable Secrets
    const emailUser = Deno.env.get('EMAIL_USER');
    const emailPass = Deno.env.get('EMAIL_PASS');

    if (!emailUser || !emailPass) {
      throw new Error('Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in Lovable Secrets (Project Settings → Secrets).');
    }

    console.log("Configuring Gmail SMTP with user:", emailUser);

    // Send email via Gmail SMTP (implicit SSL on 465)
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: emailUser,
          password: emailPass
        }
      }
    });

    console.log("Sending email to:", recipient);
    
    // Clean up HTML: remove trailing spaces and normalize whitespace to avoid encoding issues
    const cleanHtml = htmlContent
      .replace(/\s+$/gm, '') // Remove trailing spaces on each line
      .replace(/\n{3,}/g, '\n\n'); // Collapse multiple newlines
    
    await client.send({
      from: `Duquesne Filing Bot <${emailUser}>`,
      to: recipient,
      subject: `Duquesne Family Office - ${reportData.currentFiling.quarter} ${reportData.currentFiling.year} Portfolio Update`,
      html: cleanHtml,
      content: 'text/html'
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
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  
  const formatPrice = (value: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  
  const formatPercent = (value: number) => 
    `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  
  const changeColor = (value: number) => 
    value >= 0 ? '#10B981' : '#EF4444';

  // Format summary with consistent, clean HTML structure for Executive Summary
  const formatSummary = (text: string) => {
    let formatted = text.trim();
    
    // Convert **bold** section headers to <h3> with consistent styling
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (match, p1) => {
      return `<h3 style="font-family:Arial,sans-serif; font-size:15px; font-weight:bold; color:#1a1a1a; margin:16px 0 8px 0; line-height:1.3;">${p1}</h3>`;
    });
    
    // Convert Unicode bullet points (•) to proper <li> tags
    // Also handle any - or * bullets that might slip through
    formatted = formatted.replace(/^\s*[•\-*]\s+(.+)$/gm, '<li style="margin:6px 0; line-height:1.5;">$1</li>');
    
    // Wrap consecutive <li> tags in <ul> with clean styling
    formatted = formatted.replace(/(<li[^>]*>.*?<\/li>\s*)+/gs, (match) => {
      return `<ul style="margin:8px 0 16px 0; padding-left:20px; font-family:Arial,sans-serif; font-size:14px; color:#333; list-style-type:disc;">${match}</ul>`;
    });
    
    // Handle any remaining text paragraphs (text not in headings or lists)
    const lines = formatted.split('\n\n');
    formatted = lines.map(line => {
      line = line.trim();
      if (!line) return '';
      // Don't wrap if already has HTML tags
      if (line.startsWith('<h') || line.startsWith('<ul') || line.startsWith('<li>')) {
        return line;
      }
      return `<p style="font-family:Arial,sans-serif; font-size:14px; color:#333; line-height:1.6; margin:0 0 12px 0;">${line}</p>`;
    }).join('\n');
    
    return formatted;
  };

  const topHoldings = comparisonData.slice(0, 15);

  let tableRows = '';
  for (const holding of topHoldings) {
    const qoqValueClass = holding.qoqValueChange >= 0 ? 'positive' : 'negative';
    const qoqPctClass = holding.qoqPctChange >= 0 ? 'positive' : 'negative';
    const qoqAvgPriceClass = holding.qoqAvgPriceChange >= 0 ? 'positive' : 'negative';
    const qoqAvgPriceChangePctClass = holding.qoqAvgPriceChangePct !== null && holding.qoqAvgPriceChangePct >= 0 ? 'positive' : 'negative';
    const yoyValueClass = holding.yoyValueChange >= 0 ? 'positive' : 'negative';
    const yoyPctClass = holding.yoyPctChange >= 0 ? 'positive' : 'negative';
    const yoyAvgPriceClass = holding.yoyAvgPriceChange >= 0 ? 'positive' : 'negative';
    const yoyAvgPriceChangePctClass = holding.yoyAvgPriceChangePct !== null && holding.yoyAvgPriceChangePct >= 0 ? 'positive' : 'negative';
    
    // Format percentage changes or show em-dash if null
    const qoqPriceChangePct = holding.qoqAvgPriceChangePct !== null ? formatPercent(holding.qoqAvgPriceChangePct) : '—';
    const yoyPriceChangePct = holding.yoyAvgPriceChangePct !== null ? formatPercent(holding.yoyAvgPriceChangePct) : '—';
    
    // Compact HTML without extra whitespace to avoid encoding issues
    tableRows += `<tr><td class="company">${holding.company}</td><td class="right">${formatCurrency(holding.currentValue)}</td><td class="right">${holding.currentPct.toFixed(2)}%</td><td class="right">${formatPrice(holding.currentAvgPrice)}</td><td class="right" style="border-left: 2px solid #3B82F6;">${formatCurrency(holding.priorQValue)}</td><td class="right">${holding.priorQPct.toFixed(2)}%</td><td class="right">${formatPrice(holding.priorQAvgPrice)}</td><td class="right ${qoqValueClass}">${formatCurrency(holding.qoqValueChange)}</td><td class="right ${qoqPctClass}">${formatPercent(holding.qoqPctChange)}</td><td class="right ${qoqAvgPriceChangePctClass}">${qoqPriceChangePct}</td><td class="right" style="border-left: 2px solid #3B82F6;">${formatCurrency(holding.priorYValue)}</td><td class="right">${holding.priorYPct.toFixed(2)}%</td><td class="right">${formatPrice(holding.priorYAvgPrice)}</td><td class="right ${yoyValueClass}">${formatCurrency(holding.yoyValueChange)}</td><td class="right ${yoyPctClass}">${formatPercent(holding.yoyPctChange)}</td><td class="right ${yoyAvgPriceChangePctClass}">${yoyPriceChangePct}</td></tr>`;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portfolio Update</title>
  <style type="text/css">
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 13px; background-color: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%); color: #ffffff; padding: 30px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 10px 0; font-size: 24px; font-weight: bold; }
    .header p { margin: 0; font-size: 16px; }
    .summary { background: #ffffff; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3B82F6; }
    .summary h2 { margin: 0 0 12px 0; font-size: 18px; font-weight: bold; color: #1F2937; }
    .summary-text { color: #4B5563; line-height: 1.7; }
    .table-container { background: #ffffff; padding: 20px; border-radius: 8px; }
    .table-container h2 { margin: 0 0 16px 0; font-size: 18px; font-weight: bold; color: #1F2937; }
    table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 13px; }
    thead tr { background-color: #F3F4F6; }
    th { padding: 10px 8px; text-align: left; font-weight: bold; color: #374151; border-bottom: 2px solid #E5E7EB; }
    th.right { text-align: right; }
    td { padding: 10px 8px; border-bottom: 1px solid #E5E7EB; color: #1F2937; }
    td.right { text-align: right; }
    td.company { font-weight: 500; }
    .positive { color: #10B981; }
    .negative { color: #EF4444; }
    .footer { text-align: center; margin-top: 20px; padding: 16px; color: #6B7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Duquesne Family Office LLC</h1>
      <p>${currentFiling.quarter} ${currentFiling.year} Portfolio Update</p>
    </div>

    <div style="background:#ffffff; padding:24px; border-radius:8px; margin-bottom:20px; border-left:4px solid #3B82F6;">
      <h2 style="margin:0 0 16px 0; font-size:18px; font-weight:bold; color:#1a1a1a; font-family:Arial,sans-serif;">Executive Summary</h2>
      <div style="color:#333; line-height:1.7;">
        ${formatSummary(summary)}
      </div>
    </div>

    <div class="table-container">
      <h2>Portfolio Holdings</h2>
      <table cellpadding="0" cellspacing="0" border="0">
        <thead>
          <tr>
            <th>Company</th>
            <th class="right">Current ($)</th>
            <th class="right">Current (%)</th>
            <th class="right">EOD Stock Price</th>
            <th class="right" style="border-left: 2px solid #3B82F6;">Prior Q ($)</th>
            <th class="right">Prior Q (% of Total)</th>
            <th class="right">Prior Q EOD Stock Price</th>
            <th class="right">QoQ &Delta; ($)</th>
            <th class="right">QoQ &Delta; (Percentage Points)</th>
            <th class="right">QoQ &Delta; EOD Price (%)</th>
            <th class="right" style="border-left: 2px solid #3B82F6;">Prior Y ($)</th>
            <th class="right">Prior Y (% of Total)</th>
            <th class="right">Prior Y EOD Stock Price</th>
            <th class="right">YoY &Delta; ($)</th>
            <th class="right">YoY &Delta; (Percentage Points)</th>
            <th class="right">YoY &Delta; EOD Price (%)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <p>Automated Portfolio Tracker | Filing Date: ${currentFiling.filing_date}</p>
      <p>Data source: SEC 13F-HR Filings</p>
    </div>
  </div>
</body>
</html>
  `;
}
