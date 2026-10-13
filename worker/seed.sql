-- Seed feeds (SPEC §7.1). Verified 2026-10-13.
-- Excluded: Moneycontrol (returns HTML, not RSS). FT: check terms before launch.

INSERT OR IGNORE INTO sources (id, publisher, section, region, feed_url) VALUES
  ('et-markets',    'Economic Times',    'Markets',  'india',  'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'),
  ('et-stocks',     'Economic Times',    'Stocks',   'india',  'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms'),
  ('et-economy',    'Economic Times',    'Economy',  'india',  'https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms'),
  ('mint-markets',  'Mint',              'Markets',  'india',  'https://www.livemint.com/rss/markets'),
  ('bs-markets',    'Business Standard', 'Markets',  'india',  'https://www.business-standard.com/rss/markets-106.rss'),
  ('ft-markets',    'Financial Times',   'Markets',  'global', 'https://www.ft.com/markets?format=rss'),
  ('yahoo-indices', 'Yahoo Finance',     NULL,       'global', 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^NSEI,^GSPC&region=US&lang=en-US'),
  ('cnbc-markets',  'CNBC',              'Markets',  'global', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258'),
  ('cnbc-top',      'CNBC',              'Top News', 'global', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114');
