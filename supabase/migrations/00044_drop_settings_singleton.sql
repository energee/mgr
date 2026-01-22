-- Drop Deprecated Settings Singleton Table
-- The settings table has been fully replaced by system_settings (key-value store)

-- =============================================================================
-- 1. DROP THE TABLE
-- =============================================================================

DROP TABLE IF EXISTS settings;

-- =============================================================================
-- 2. REMOVE FROM SCHEMA REGISTRY
-- =============================================================================

DELETE FROM _schema_registry WHERE table_name = 'settings';
