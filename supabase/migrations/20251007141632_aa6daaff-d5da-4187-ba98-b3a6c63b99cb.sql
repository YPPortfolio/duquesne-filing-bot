-- Create price cache table for persistent storage of EOD prices
CREATE TABLE IF NOT EXISTS public.price_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  report_date DATE NOT NULL,
  price NUMERIC(10, 2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(ticker, report_date)
);

-- Enable RLS
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access to price_cache"
ON public.price_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_price_cache_ticker_date ON public.price_cache(ticker, report_date);