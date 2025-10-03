-- Migration: Add product_id column to livestreams table
-- Version: 001
-- Description: Adds product_id column to support product-specific livestreams
-- Date: 2025-09-30

-- Check if the column already exists before adding it
DO $$ 
BEGIN
    -- Check if product_id column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'livestreams' 
        AND column_name = 'product_id'
    ) THEN
        -- Add the product_id column
        ALTER TABLE livestreams 
        ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE SET NULL;
        
        -- Add comment
        COMMENT ON COLUMN livestreams.product_id IS 'ID of the product this livestream is associated with. NULL means the livestream is not associated with any specific product.';
        
        RAISE NOTICE 'Added product_id column to livestreams table';
    ELSE
        RAISE NOTICE 'product_id column already exists in livestreams table';
    END IF;
END $$;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_livestreams_product_id ON livestreams(product_id);

-- Verify the migration
DO $$
BEGIN
    -- Check if column was added successfully
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'livestreams' 
        AND column_name = 'product_id'
    ) THEN
        RAISE NOTICE 'Migration completed successfully: product_id column is available';
    ELSE
        RAISE EXCEPTION 'Migration failed: product_id column was not added';
    END IF;
END $$;
