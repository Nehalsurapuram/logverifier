-- A small catalogue so the listing, filtering and ordering endpoints have
-- something realistic to work against. Idempotent: re-running the migrations
-- never duplicates or overwrites a row.

INSERT INTO products (sku, name, description, category, price_cents, stock) VALUES
  ('AUD-001', 'Studio Over-Ear Headphones',  'Closed-back monitoring headphones with a detachable cable.', 'audio',       24999, 40),
  ('AUD-002', 'Wireless Earbuds',            'In-ear buds with active noise cancellation and a charging case.', 'audio',    12950, 120),
  ('AUD-003', 'Desktop USB Microphone',      'Cardioid condenser microphone with a built-in shock mount.', 'audio',        8999, 65),
  ('KEY-001', 'Mechanical Keyboard 87-Key',  'Tenkeyless board with hot-swappable tactile switches.', 'peripherals',       13500, 55),
  ('KEY-002', 'Low-Profile Wireless Keyboard', 'Slim scissor-switch keyboard with multi-device pairing.', 'peripherals',    7999, 90),
  ('PTR-001', 'Ergonomic Vertical Mouse',    'Vertical grip mouse with adjustable DPI and silent clicks.', 'peripherals',   5499, 140),
  ('DSP-001', '27-inch 4K Monitor',          'IPS panel, 99% sRGB coverage, single-cable USB-C power delivery.', 'displays', 42900, 18),
  ('DSP-002', '34-inch Ultrawide Monitor',   'Curved 1440p ultrawide with a 144Hz refresh rate.', 'displays',              64900, 9),
  ('HUB-001', 'USB-C Docking Station',       'Eleven-port dock with dual 4K output and gigabit ethernet.', 'accessories',  15900, 47),
  ('HUB-002', 'Portable SSD 1TB',            'NVMe drive in an aluminium enclosure, up to 1050 MB/s.', 'accessories',      11900, 73),
  ('CAM-001', '1080p Streaming Webcam',      'Auto-focus webcam with a physical privacy shutter.', 'accessories',           6499, 0),
  ('CHR-001', 'Adjustable Laptop Stand',     'Aluminium stand with six height positions and a cable channel.', 'accessories', 4299, 210)
ON CONFLICT (sku) DO NOTHING;
