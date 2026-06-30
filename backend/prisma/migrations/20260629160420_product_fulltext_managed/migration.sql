-- CreateIndex
CREATE FULLTEXT INDEX `Product_name_shortDescription_idx` ON `Product`(`name`, `shortDescription`);
