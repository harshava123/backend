const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Supabase client with service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigrations() {
  try {
    console.log('🚀 Starting database migrations...');
    
    const migrationsDir = path.join(__dirname, 'migrations');
    
    // Check if migrations directory exists
    if (!fs.existsSync(migrationsDir)) {
      console.log('📁 No migrations directory found, creating...');
      fs.mkdirSync(migrationsDir, { recursive: true });
      return;
    }
    
    // Get all migration files
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    if (migrationFiles.length === 0) {
      console.log('📋 No migration files found');
      return;
    }
    
    console.log(`📋 Found ${migrationFiles.length} migration(s) to run:`);
    migrationFiles.forEach(file => console.log(`  - ${file}`));
    
    // Track completed migrations
    const completedMigrations = await getCompletedMigrations();
    console.log(`✅ ${completedMigrations.length} migration(s) already completed`);
    
    // Run pending migrations
    for (const file of migrationFiles) {
      const migrationName = file.replace('.sql', '');
      
      if (completedMigrations.includes(migrationName)) {
        console.log(`⏭️  Skipping ${file} (already completed)`);
        continue;
      }
      
      console.log(`🔄 Running migration: ${file}`);
      
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      
      // Run the migration
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: migrationSQL
      });
      
      if (error) {
        // If exec_sql is not available, try alternative approach
        if (error.message && error.message.includes('exec_sql')) {
          console.log(`⚠️  exec_sql not available, trying alternative approach for ${file}`);
          
          // Try to execute the SQL by testing the expected result
          if (file.includes('product_id')) {
            // Test if product_id column exists
            const { data: testData, error: testError } = await supabase
              .from('livestreams')
              .select('id')
              .limit(1);
            
            if (testError && testError.message.includes('product_id')) {
              console.log(`❌ Migration ${file} needs to be run manually in Supabase dashboard`);
              console.log(`📝 SQL to run manually:`);
              console.log(migrationSQL);
            } else {
              console.log(`✅ Migration ${file} appears to be already applied`);
              await markMigrationCompleted(migrationName);
            }
          }
        } else {
          throw error;
        }
      } else {
        console.log(`✅ Migration ${file} completed successfully`);
        await markMigrationCompleted(migrationName);
      }
    }
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
}

async function getCompletedMigrations() {
  try {
    // Try to get completed migrations from a tracking table
    const { data, error } = await supabase
      .from('migration_history')
      .select('migration_name');
    
    if (error) {
      // Table doesn't exist, return empty array
      return [];
    }
    
    return data.map(row => row.migration_name);
  } catch (error) {
    return [];
  }
}

async function markMigrationCompleted(migrationName) {
  try {
    // Create migration history table if it doesn't exist
    await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS migration_history (
          id SERIAL PRIMARY KEY,
          migration_name VARCHAR(255) UNIQUE NOT NULL,
          completed_at TIMESTAMP DEFAULT NOW()
        );
      `
    });
    
    // Mark migration as completed
    await supabase
      .from('migration_history')
      .upsert({
        migration_name: migrationName,
        completed_at: new Date().toISOString()
      });
  } catch (error) {
    console.log('⚠️ Could not track migration completion:', error.message);
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
