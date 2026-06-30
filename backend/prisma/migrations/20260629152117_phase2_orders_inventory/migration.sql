-- DropIndex
DROP INDEX `Product_fulltext_idx` ON `Product`;

-- CreateTable
CREATE TABLE `InventoryMovement` (
    `id` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `type` ENUM('MANUAL_ADJUSTMENT', 'SALE', 'RESERVATION', 'RESERVATION_RELEASE', 'RESERVATION_EXPIRY', 'REFUND_RESTOCK', 'CANCELLATION_RESTOCK') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `reason` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InventoryMovement_variantId_idx`(`variantId`),
    INDEX `InventoryMovement_orderId_idx`(`orderId`),
    INDEX `InventoryMovement_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryReservation` (
    `id` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `InventoryReservation_variantId_status_idx`(`variantId`, `status`),
    INDEX `InventoryReservation_orderId_idx`(`orderId`),
    INDEX `InventoryReservation_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LowStockNotification` (
    `id` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `threshold` INTEGER NOT NULL,
    `notifiedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LowStockNotification_variantId_idx`(`variantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `guestEmail` VARCHAR(191) NOT NULL,
    `guestPhone` VARCHAR(191) NULL,
    `status` ENUM('AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'AWAITING_PAYMENT',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `discountTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `shippingTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `grandTotal` DECIMAL(12, 2) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `orderToken` VARCHAR(191) NOT NULL,
    `shippingSnapshot` JSON NOT NULL,
    `placedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_orderNumber_key`(`orderNumber`),
    UNIQUE INDEX `Order_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `Order_orderToken_key`(`orderToken`),
    INDEX `Order_status_idx`(`status`),
    INDEX `Order_createdAt_idx`(`createdAt`),
    INDEX `Order_guestEmail_idx`(`guestEmail`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `variantId` VARCHAR(191) NULL,
    `productName` VARCHAR(191) NOT NULL,
    `variantName` VARCHAR(191) NULL,
    `sku` VARCHAR(191) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `lineTotal` DECIMAL(12, 2) NOT NULL,

    INDEX `OrderItem_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shipment` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `carrier` VARCHAR(191) NULL,
    `trackingNumber` VARCHAR(191) NULL,
    `shippedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Shipment_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `provider` ENUM('COD', 'BKASH') NOT NULL,
    `status` ENUM('INITIATED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'INITIATED',
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `tranId` VARCHAR(191) NOT NULL,
    `bkashPaymentID` VARCHAR(191) NULL,
    `bkashTrxID` VARCHAR(191) NULL,
    `payerMasked` VARCHAR(191) NULL,
    `gatewayPageURL` VARCHAR(191) NULL,
    `validatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_tranId_key`(`tranId`),
    UNIQUE INDEX `Payment_bkashPaymentID_key`(`bkashPaymentID`),
    INDEX `Payment_orderId_idx`(`orderId`),
    INDEX `Payment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `rawPayload` JSON NOT NULL,
    `signatureValid` BOOLEAN NOT NULL DEFAULT true,
    `processed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentEvent_paymentId_idx`(`paymentId`),
    INDEX `PaymentEvent_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Job` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `lastError` TEXT NULL,
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Job_status_runAt_idx`(`status`, `runAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `InventoryMovement` ADD CONSTRAINT `InventoryMovement_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryReservation` ADD CONSTRAINT `InventoryReservation_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LowStockNotification` ADD CONSTRAINT `LowStockNotification_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shipment` ADD CONSTRAINT `Shipment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentEvent` ADD CONSTRAINT `PaymentEvent_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
