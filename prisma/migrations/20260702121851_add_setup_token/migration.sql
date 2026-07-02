-- CreateTable
CREATE TABLE "setup_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "setup_tokens_tokenHash_key" ON "setup_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "setup_tokens_tokenHash_idx" ON "setup_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "setup_tokens_userId_idx" ON "setup_tokens"("userId");

-- AddForeignKey
ALTER TABLE "setup_tokens" ADD CONSTRAINT "setup_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
