-- Anonymous usage events for tao.tensor.group. No IP, no user agent string, no typed text.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,          -- server time, ms
  vid TEXT,                     -- random visitor id (localStorage), not linked to a person
  sid TEXT,                     -- random session id (sessionStorage)
  ev TEXT NOT NULL,             -- 'view' or an action name
  path TEXT,                    -- app route, e.g. /p/59, /about, /search
  prev TEXT,                    -- the route before it
  detail TEXT,                  -- short action detail (a note id, a character, a culture kind); never typed text
  country TEXT,                 -- from Cloudflare, two letters
  device TEXT,                  -- phone | tablet | desktop
  standalone INTEGER            -- 1 when opened as an installed app
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_session ON events(sid, ts);
CREATE INDEX IF NOT EXISTS events_ev ON events(ev, ts);
