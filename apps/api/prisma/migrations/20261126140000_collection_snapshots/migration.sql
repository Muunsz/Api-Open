-- Collection Version History Snapshots
CREATE TABLE IF NOT EXISTS "CollectionSnapshot" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "note" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CollectionSnapshot_collectionId_createdAt_idx" ON "CollectionSnapshot"("collectionId", "createdAt" DESC);
DO $$ BEGIN
  ALTER TABLE "CollectionSnapshot" ADD CONSTRAINT "CollectionSnapshot_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
