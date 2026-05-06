-- =============================================================================
-- Migration: Notification Triggers
-- =============================================================================
-- Creates database triggers to automatically generate notifications when
-- important events occur (batch status changes, order updates, etc.)
-- =============================================================================

-- =============================================================================
-- 1. Helper: Notify All Active Users
-- =============================================================================
-- Since this is a single-tenant app, we notify all active users for most events.

CREATE OR REPLACE FUNCTION notify_all_users(
  p_type TEXT,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal',
  p_action_url TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_count INTEGER := 0;
BEGIN
  -- Get all users who have logged in (have a session/are active)
  FOR v_user IN
    -- check-auth-users-leak: skip server-side admin broadcast (SECURITY DEFINER, IDs only, not via PostgREST)
    SELECT DISTINCT id FROM auth.users
  LOOP
    PERFORM create_notification(
      v_user.id,
      p_type,
      p_title,
      p_message,
      p_entity_type,
      p_entity_id,
      p_priority,
      p_action_url,
      p_metadata
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION notify_all_users IS 'Creates a notification for all users. Used for broadcast notifications.';

-- =============================================================================
-- 2. Batch Status Change Trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_batch_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_priority TEXT := 'normal';
  v_action_url TEXT;
BEGIN
  -- Only trigger on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Build notification based on new status
  v_action_url := '/production/batches/' || NEW.id;

  CASE NEW.status
    WHEN 'fermenting' THEN
      v_title := 'Batch Started Fermenting';
      v_message := NEW.batch_number || ' (' || COALESCE(NEW.name, 'Unnamed') || ') has started fermentation.';
      v_priority := 'normal';
    WHEN 'conditioning' THEN
      v_title := 'Batch Moved to Conditioning';
      v_message := NEW.batch_number || ' is now conditioning.';
      v_priority := 'normal';
    WHEN 'packaging' THEN
      v_title := 'Batch Ready for Packaging';
      v_message := NEW.batch_number || ' (' || COALESCE(NEW.name, 'Unnamed') || ') is ready to be packaged.';
      v_priority := 'high';
    WHEN 'completed' THEN
      v_title := 'Batch Completed';
      v_message := NEW.batch_number || ' has been completed and is ready for sale.';
      v_priority := 'normal';
    WHEN 'cancelled' THEN
      v_title := 'Batch Cancelled';
      v_message := NEW.batch_number || ' has been cancelled.';
      v_priority := 'high';
    ELSE
      -- Don't notify for other status changes
      RETURN NEW;
  END CASE;

  -- Notify all users
  PERFORM notify_all_users(
    'batch_status',
    v_title,
    v_message,
    'batch',
    NEW.id,
    v_priority,
    v_action_url,
    jsonb_build_object(
      'batch_number', NEW.batch_number,
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on batches table
DROP TRIGGER IF EXISTS batch_status_notification ON batches;
CREATE TRIGGER batch_status_notification
  AFTER UPDATE OF status ON batches
  FOR EACH ROW
  EXECUTE FUNCTION trigger_batch_status_notification();

-- =============================================================================
-- 3. Order Status Change Trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_order_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_priority TEXT := 'normal';
  v_action_url TEXT;
  v_customer_name TEXT;
BEGIN
  -- Only trigger on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get customer name
  SELECT name INTO v_customer_name
  FROM customers
  WHERE id = NEW.customer_id;

  v_action_url := '/sales/orders/' || NEW.id;

  CASE NEW.status
    WHEN 'confirmed' THEN
      v_title := 'New Order Confirmed';
      v_message := 'Order ' || NEW.order_number || ' from ' || COALESCE(v_customer_name, 'Unknown') || ' has been confirmed.';
      v_priority := 'normal';
    WHEN 'ready_to_ship' THEN
      v_title := 'Order Ready to Ship';
      v_message := 'Order ' || NEW.order_number || ' is ready for pickup/delivery.';
      v_priority := 'high';
    WHEN 'out_the_door' THEN
      v_title := 'Order Shipped';
      v_message := 'Order ' || NEW.order_number || ' has left the building.';
      v_priority := 'normal';
    WHEN 'cancelled' THEN
      v_title := 'Order Cancelled';
      v_message := 'Order ' || NEW.order_number || ' has been cancelled.';
      v_priority := 'high';
    ELSE
      -- Don't notify for other status changes
      RETURN NEW;
  END CASE;

  -- Notify all users
  PERFORM notify_all_users(
    'order_status',
    v_title,
    v_message,
    'order',
    NEW.id,
    v_priority,
    v_action_url,
    jsonb_build_object(
      'order_number', NEW.order_number,
      'customer_name', v_customer_name,
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on orders table
DROP TRIGGER IF EXISTS order_status_notification ON orders;
CREATE TRIGGER order_status_notification
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_order_status_notification();

-- =============================================================================
-- 4. New Order Notification Trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_new_order_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_name TEXT;
  v_action_url TEXT;
BEGIN
  -- Get customer name
  SELECT name INTO v_customer_name
  FROM customers
  WHERE id = NEW.customer_id;

  v_action_url := '/sales/orders/' || NEW.id;

  -- Notify all users about new order
  PERFORM notify_all_users(
    'order_received',
    'New Order Received',
    'Order ' || NEW.order_number || ' from ' || COALESCE(v_customer_name, 'Unknown') || '.',
    'order',
    NEW.id,
    'normal',
    v_action_url,
    jsonb_build_object(
      'order_number', NEW.order_number,
      'customer_name', v_customer_name
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on orders table for inserts
DROP TRIGGER IF EXISTS new_order_notification ON orders;
CREATE TRIGGER new_order_notification
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_new_order_notification();

-- =============================================================================
-- 5. Purchase Order Status Change Trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_po_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_priority TEXT := 'normal';
  v_action_url TEXT;
  v_supplier_name TEXT;
BEGIN
  -- Only trigger on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get supplier name
  SELECT name INTO v_supplier_name
  FROM suppliers
  WHERE id = NEW.supplier_id;

  v_action_url := '/purchasing/purchase-orders/' || NEW.id;

  CASE NEW.status
    WHEN 'confirmed' THEN
      v_title := 'PO Confirmed by Supplier';
      v_message := 'PO ' || NEW.po_number || ' from ' || COALESCE(v_supplier_name, 'Unknown') || ' has been confirmed.';
      v_priority := 'normal';
    WHEN 'partially_received' THEN
      v_title := 'PO Partially Received';
      v_message := 'Partial delivery received for PO ' || NEW.po_number || '.';
      v_priority := 'normal';
    WHEN 'received' THEN
      v_title := 'PO Fully Received';
      v_message := 'All items received for PO ' || NEW.po_number || '.';
      v_priority := 'normal';
    WHEN 'closed' THEN
      v_title := 'PO Closed';
      v_message := 'PO ' || NEW.po_number || ' has been closed.';
      v_priority := 'low';
    ELSE
      -- Don't notify for other status changes
      RETURN NEW;
  END CASE;

  -- Notify all users
  PERFORM notify_all_users(
    'po_status',
    v_title,
    v_message,
    'purchase_order',
    NEW.id,
    v_priority,
    v_action_url,
    jsonb_build_object(
      'po_number', NEW.po_number,
      'supplier_name', v_supplier_name,
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on purchase_orders table
DROP TRIGGER IF EXISTS po_status_notification ON purchase_orders;
CREATE TRIGGER po_status_notification
  AFTER UPDATE OF status ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_po_status_notification();

-- =============================================================================
-- 6. Low Inventory Check Function (called periodically or manually)
-- =============================================================================
-- This function checks for low inventory and creates notifications.
-- It should be called via a cron job or pg_cron extension.

CREATE OR REPLACE FUNCTION check_low_inventory()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_count INTEGER := 0;
  v_notification_exists BOOLEAN;
BEGIN
  -- Find inventory items below reorder point that don't have a recent notification
  FOR v_item IN
    SELECT
      ii.id,
      ii.name,
      ii.sku,
      ii.quantity_on_hand,
      ii.reorder_point,
      ii.category
    FROM inventory_items ii
    WHERE ii.reorder_point IS NOT NULL
      AND ii.quantity_on_hand <= ii.reorder_point
      AND ii.is_active = true
  LOOP
    -- Check if we've already notified about this item in the last 24 hours
    SELECT EXISTS (
      SELECT 1 FROM notifications
      WHERE type = 'inventory_low'
        AND entity_type = 'inventory_item'
        AND entity_id = v_item.id
        AND created_at > now() - interval '24 hours'
        AND dismissed_at IS NULL
    ) INTO v_notification_exists;

    IF NOT v_notification_exists THEN
      PERFORM notify_all_users(
        'inventory_low',
        'Low Inventory Alert',
        v_item.name || ' (' || COALESCE(v_item.sku, 'No SKU') || ') is below reorder point. ' ||
          'Current: ' || v_item.quantity_on_hand || ', Reorder at: ' || v_item.reorder_point,
        'inventory_item',
        v_item.id,
        'high',
        '/inventory/items/' || v_item.id,
        jsonb_build_object(
          'name', v_item.name,
          'sku', v_item.sku,
          'quantity_on_hand', v_item.quantity_on_hand,
          'reorder_point', v_item.reorder_point,
          'category', v_item.category
        )
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION check_low_inventory IS 'Checks for inventory items below reorder point and creates notifications. Call periodically via cron.';

-- =============================================================================
-- 7. Packaging Session Completion Trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_packaging_completion_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_info RECORD;
  v_action_url TEXT;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF OLD.status = NEW.status OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  -- Get batch info
  SELECT batch_number, name INTO v_batch_info
  FROM batches
  WHERE id = NEW.batch_id;

  v_action_url := '/production/packaging-sessions/' || NEW.id;

  -- Notify all users
  PERFORM notify_all_users(
    'batch_status',
    'Packaging Complete',
    'Packaging session for ' || COALESCE(v_batch_info.batch_number, 'Unknown Batch') ||
      ' (' || COALESCE(v_batch_info.name, '') || ') is complete. ' ||
      NEW.total_packaged || ' units packaged.',
    'packaging_session',
    NEW.id,
    'normal',
    v_action_url,
    jsonb_build_object(
      'batch_number', v_batch_info.batch_number,
      'total_packaged', NEW.total_packaged
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on packaging_sessions table
DROP TRIGGER IF EXISTS packaging_completion_notification ON packaging_sessions;
CREATE TRIGGER packaging_completion_notification
  AFTER UPDATE OF status ON packaging_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_packaging_completion_notification();
