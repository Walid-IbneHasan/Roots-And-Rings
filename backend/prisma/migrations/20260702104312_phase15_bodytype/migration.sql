-- Rename Product.clayBody -> Product.bodyType (data-preserving)
ALTER TABLE `Product` CHANGE `clayBody` `bodyType` VARCHAR(191) NULL;
