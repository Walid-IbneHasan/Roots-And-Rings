-- Add MySQL FULLTEXT index for product search (not expressible in Prisma schema)
ALTER TABLE `Product` ADD FULLTEXT INDEX `Product_fulltext_idx` (`name`, `shortDescription`);