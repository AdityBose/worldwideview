-- Add tier and locking columns to workspaces table
ALTER TABLE "workspaces" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedReason" TEXT,
ADD COLUMN     "tier" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "tierStampedAt" TIMESTAMP(3);
