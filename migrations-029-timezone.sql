-- Each person's time zone + country (for showing times and the daily reset in their own time). Run in the D1 console before pushing.
ALTER TABLE users ADD COLUMN tz TEXT;
ALTER TABLE users ADD COLUMN country TEXT;
