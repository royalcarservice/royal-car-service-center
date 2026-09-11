-- GarageAI PostgreSQL production schema
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner','Advisor','Mechanic','Apprentice')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  preferred_contact TEXT DEFAULT 'WhatsApp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS vehicles (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  year INTEGER,
  make TEXT,
  model TEXT,
  trim TEXT,
  engine TEXT,
  transmission TEXT,
  color TEXT,
  plate TEXT,
  vin TEXT,
  mileage INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  specializations TEXT,
  hourly_rate NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'Available'
);
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id),
  vehicle_id BIGINT REFERENCES vehicles(id),
  employee_id BIGINT REFERENCES employees(id),
  bay_number INTEGER,
  status TEXT NOT NULL DEFAULT 'Received',
  priority TEXT NOT NULL DEFAULT 'Normal',
  complaint TEXT,
  diagnosis TEXT,
  estimated_completion TEXT,
  total NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id),
  vehicle_id BIGINT REFERENCES vehicles(id),
  service_type TEXT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  bay INTEGER,
  status TEXT DEFAULT 'Booked',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS parts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  part_number TEXT,
  category TEXT,
  quantity INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 0,
  cost NUMERIC(12,2) DEFAULT 0,
  sell_price NUMERIC(12,2) DEFAULT 0,
  supplier TEXT,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  work_order_id TEXT REFERENCES work_orders(id),
  customer_id BIGINT REFERENCES customers(id),
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'Draft',
  payment_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS estimate_approvals (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  customer_id BIGINT REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'Awaiting approval',
  approved_items TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id),
  work_order_id TEXT REFERENCES work_orders(id),
  appointment_id BIGINT REFERENCES appointments(id),
  type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'WhatsApp',
  recipient TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS work_order_media (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  media_type TEXT NOT NULL DEFAULT 'photo',
  filename TEXT NOT NULL,
  mime_type TEXT,
  url TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT DEFAULT 'GarageAI',
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_parts_low_stock ON parts(quantity, min_stock);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
