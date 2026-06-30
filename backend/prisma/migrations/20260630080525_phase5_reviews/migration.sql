-- AlterTable
ALTER TABLE `Product` ADD COLUMN `ratingAvg` DECIMAL(3, 2) NULL,
    ADD COLUMN `ratingCount` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `Review` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL,
    `body` TEXT NULL,
    `authorName` VARCHAR(191) NOT NULL,
    `status` ENUM('PUBLISHED', 'HIDDEN') NOT NULL DEFAULT 'PUBLISHED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Review_productId_status_idx`(`productId`, `status`),
    INDEX `Review_customerId_idx`(`customerId`),
    UNIQUE INDEX `Review_productId_customerId_key`(`productId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
