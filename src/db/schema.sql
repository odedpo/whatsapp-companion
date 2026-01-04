-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
  wake_time TIME,
  sleep_time TIME,
  eating_window_start TIME,
  eating_window_end TIME,
  risk_times JSONB DEFAULT '[]',
  shame_level INT DEFAULT 1,
  loss_aversion_enabled BOOLEAN DEFAULT true,
  onboarding_complete BOOLEAN DEFAULT false,
  onboarding_step VARCHAR(50) DEFAULT 'start',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Behavioral contract (locked weekly)
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  binary_actions JSONB NOT NULL,
  rules_text TEXT,
  locked_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  active BOOLEAN DEFAULT true
);

-- Daily logs
CREATE TABLE IF NOT EXISTS daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  scores JSONB DEFAULT '{}',
  total_score INT DEFAULT 0,
  tomorrow_locked BOOLEAN DEFAULT false,
  tomorrow_plan JSONB,
  miss_reason TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Photos (metadata only)
CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20),
  url TEXT NOT NULL,
  date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Token system
CREATE TABLE IF NOT EXISTS tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  starting_tokens INT DEFAULT 7,
  current_tokens INT DEFAULT 7,
  loss_events JSONB DEFAULT '[]',
  punishment_triggered BOOLEAN DEFAULT false,
  UNIQUE(user_id, week_start)
);

-- Pattern memory
CREATE TABLE IF NOT EXISTS patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  pattern_type VARCHAR(50),
  content TEXT,
  frequency INT DEFAULT 1,
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Conversation history
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10),
  content TEXT,
  flow VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date ON daily_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_patterns_user_type ON patterns(user_id, pattern_type);
CREATE INDEX IF NOT EXISTS idx_tokens_user_week ON tokens(user_id, week_start);
