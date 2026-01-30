-- =========================================================
-- Geometry columns + Spatial indexes (idempotent)
-- =========================================================


-- Add geometry columns if missing
ALTER TABLE "Home" ADD COLUMN IF NOT EXISTS "geom" geometry(Point, 4326);
ALTER TABLE "SearchAdress" ADD COLUMN IF NOT EXISTS "geom" geometry(Point, 4326);

-- Update geom columns if they are null
UPDATE "Home"
SET "geom" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)
WHERE "geom" IS NULL AND "lng" IS NOT NULL AND "lat" IS NOT NULL;

UPDATE "SearchAdress"
SET "geom" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
WHERE "geom" IS NULL AND "longitude" IS NOT NULL AND "latitude" IS NOT NULL;

-- Create GIST indexes for geometry columns
CREATE INDEX IF NOT EXISTS "Home_geom_gist" ON "Home" USING GIST ("geom");
CREATE INDEX IF NOT EXISTS "SearchAdress_geom_gist" ON "SearchAdress" USING GIST ("geom");

-- Add functional GIST indexes for geography casting if needed
CREATE INDEX IF NOT EXISTS "Home_geom_geog_gist" ON "Home" USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS "SearchAdress_geom_geog_gist" ON "SearchAdress" USING GIST ((geom::geography));

-- Add index on SearchAdress.searchId for FK lookups
CREATE INDEX IF NOT EXISTS "SearchAdress_searchId_idx" ON "SearchAdress" ("searchId");

-- Refresh planner statistics
ANALYZE "Home";
ANALYZE "SearchAdress";

-- (Optional) Add triggers to keep geom columns up to date on changes
CREATE OR REPLACE FUNCTION update_home_geom() RETURNS trigger AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW."lng", NEW."lat"), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_home_geom ON "Home";
CREATE TRIGGER trg_update_home_geom
BEFORE INSERT OR UPDATE OF "lng", "lat" ON "Home"
FOR EACH ROW EXECUTE FUNCTION update_home_geom();

CREATE OR REPLACE FUNCTION update_searchadress_geom() RETURNS trigger AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_searchadress_geom ON "SearchAdress";
CREATE TRIGGER trg_update_searchadress_geom
BEFORE INSERT OR UPDATE OF "longitude", "latitude" ON "SearchAdress"
FOR EACH ROW EXECUTE FUNCTION update_searchadress_geom();
