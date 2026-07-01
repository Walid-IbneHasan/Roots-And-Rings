-- AlterTable
ALTER TABLE `Order` ADD COLUMN `source` ENUM('WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'OTHER') NOT NULL DEFAULT 'WEBSITE';

-- AlterTable
ALTER TABLE `Payment` MODIFY `provider` ENUM('COD', 'BKASH', 'MANUAL') NOT NULL;

-- CreateIndex
CREATE INDEX `Order_source_idx` ON `Order`(`source`);
