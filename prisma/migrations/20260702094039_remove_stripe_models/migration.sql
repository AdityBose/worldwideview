/*
  Warnings:

  - You are about to drop the column `stripeCustomerId` on the `workspaces` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `workspaces` table. All the data in the column will be lost.
  - You are about to drop the `subscription` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "workspaces" DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionId";

-- DropTable
DROP TABLE "subscription";
