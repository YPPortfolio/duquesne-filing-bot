-- Create table for 13F filings
CREATE TABLE public.filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cik TEXT NOT NULL,
  company_name TEXT NOT NULL,
  filing_date DATE NOT NULL,
  quarter TEXT NOT NULL,
  year INTEGER NOT NULL,
  filing_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(cik, quarter, year)
);

-- Create table for portfolio holdings
CREATE TABLE public.holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID REFERENCES public.filings(id) ON DELETE CASCADE NOT NULL,
  company_name TEXT NOT NULL,
  ticker TEXT,
  cusip TEXT,
  shares BIGINT,
  value_usd BIGINT NOT NULL,
  percentage_of_portfolio NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create table for email delivery tracking
CREATE TABLE public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID REFERENCES public.filings(id) ON DELETE CASCADE NOT NULL,
  recipient TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status TEXT NOT NULL,
  error_message TEXT
);

-- Create indexes for performance
CREATE INDEX idx_filings_cik_date ON public.filings(cik, filing_date DESC);
CREATE INDEX idx_holdings_filing_id ON public.holdings(filing_id);
CREATE INDEX idx_holdings_value ON public.holdings(value_usd DESC);

-- Enable RLS (make public for now since this is automated backend work)
ALTER TABLE public.filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything (edge functions use service role)
CREATE POLICY "Service role full access to filings" ON public.filings FOR ALL USING (true);
CREATE POLICY "Service role full access to holdings" ON public.holdings FOR ALL USING (true);
CREATE POLICY "Service role full access to email_logs" ON public.email_logs FOR ALL USING (true);