export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      _schema_registry: {
        Row: {
          created_at: string | null
          description: string
          domain: string
          key_fields: Json | null
          query_examples: Json | null
          relationships: Json | null
          state_machine: Json | null
          table_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          domain: string
          key_fields?: Json | null
          query_examples?: Json | null
          relationships?: Json | null
          state_machine?: Json | null
          table_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          domain?: string
          key_fields?: Json | null
          query_examples?: Json | null
          relationships?: Json | null
          state_machine?: Json | null
          table_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      allocations: {
        Row: {
          allocation_type: string
          created_at: string | null
          created_by: string | null
          expiration_date: string | null
          id: string
          inventory_item_id: string
          lot_number: string | null
          notes: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          unit_cost: number | null
        }
        Insert: {
          allocation_type: string
          created_at?: string | null
          created_by?: string | null
          expiration_date?: string | null
          id?: string
          inventory_item_id: string
          lot_number?: string | null
          notes?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          unit_cost?: number | null
        }
        Update: {
          allocation_type?: string
          created_at?: string | null
          created_by?: string | null
          expiration_date?: string | null
          id?: string
          inventory_item_id?: string
          lot_number?: string | null
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "allocations_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_logs: {
        Row: {
          batch_id: string
          created_at: string | null
          created_by: string | null
          data: Json
          id: string
          log_type: string
        }
        Insert: {
          batch_id: string
          created_at?: string | null
          created_by?: string | null
          data: Json
          id?: string
          log_type: string
        }
        Update: {
          batch_id?: string
          created_at?: string | null
          created_by?: string | null
          data?: Json
          id?: string
          log_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          actual_abv: number | null
          actual_fg: number | null
          batch_number: string
          created_at: string | null
          fermenter: string | null
          id: string
          name: string
          notes: string | null
          planned_start_date: string | null
          recipe_id: string | null
          status: string
          updated_at: string | null
          volume_gallons: number | null
        }
        Insert: {
          actual_abv?: number | null
          actual_fg?: number | null
          batch_number: string
          created_at?: string | null
          fermenter?: string | null
          id?: string
          name: string
          notes?: string | null
          planned_start_date?: string | null
          recipe_id?: string | null
          status?: string
          updated_at?: string | null
          volume_gallons?: number | null
        }
        Update: {
          actual_abv?: number | null
          actual_fg?: number | null
          batch_number?: string
          created_at?: string | null
          fermenter?: string | null
          id?: string
          name?: string
          notes?: string | null
          planned_start_date?: string | null
          recipe_id?: string | null
          status?: string
          updated_at?: string | null
          volume_gallons?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          abv: number | null
          created_at: string | null
          description: string | null
          hops: Json | null
          id: string
          name: string
          style_id: string | null
          untappd_rating: number | null
          untappd_url: string | null
          updated_at: string | null
          variant: string | null
        }
        Insert: {
          abv?: number | null
          created_at?: string | null
          description?: string | null
          hops?: Json | null
          id?: string
          name: string
          style_id?: string | null
          untappd_rating?: number | null
          untappd_url?: string | null
          updated_at?: string | null
          variant?: string | null
        }
        Update: {
          abv?: number | null
          created_at?: string | null
          description?: string | null
          hops?: Json | null
          id?: string
          name?: string
          style_id?: string | null
          untappd_rating?: number | null
          untappd_url?: string | null
          updated_at?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      brew_log_batches: {
        Row: {
          batch_id: string
          brew_log_id: string
          created_at: string | null
          id: string
          notes: string | null
          volume_bbl: number
        }
        Insert: {
          batch_id: string
          brew_log_id: string
          created_at?: string | null
          id?: string
          notes?: string | null
          volume_bbl: number
        }
        Update: {
          batch_id?: string
          brew_log_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          volume_bbl?: number
        }
        Relationships: [
          {
            foreignKeyName: "brew_log_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brew_log_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brew_log_batches_brew_log_id_fkey"
            columns: ["brew_log_id"]
            isOneToOne: false
            referencedRelation: "brew_log_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brew_log_batches_brew_log_id_fkey"
            columns: ["brew_log_id"]
            isOneToOne: false
            referencedRelation: "brew_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      brew_logs: {
        Row: {
          brew_date: string
          brew_number: string
          brewer_id: string | null
          created_at: string | null
          events: Json | null
          id: string
          legacy_data: Json | null
          notes: string | null
          recipe_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          brew_date: string
          brew_number: string
          brewer_id?: string | null
          created_at?: string | null
          events?: Json | null
          id?: string
          legacy_data?: Json | null
          notes?: string | null
          recipe_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          brew_date?: string
          brew_number?: string
          brewer_id?: string | null
          created_at?: string | null
          events?: Json | null
          id?: string
          legacy_data?: Json | null
          notes?: string | null
          recipe_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brew_logs_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: Json | null
          contact_name: string | null
          created_at: string | null
          customer_type: string
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: Json | null
          contact_name?: string | null
          created_at?: string | null
          customer_type: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: Json | null
          contact_name?: string | null
          created_at?: string | null
          customer_type?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          category: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          reorder_point: number | null
          reorder_qty: number | null
          sku: string | null
          supplier: string | null
          unit: string
          updated_at: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          reorder_point?: number | null
          reorder_qty?: number | null
          sku?: string | null
          supplier?: string | null
          unit: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          reorder_point?: number | null
          reorder_qty?: number | null
          sku?: string | null
          supplier?: string | null
          unit?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          address: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          location_type: string
          name: string
          updated_at: string | null
        }
        Insert: {
          address?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          location_type?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          address?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          location_type?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          batch_id: string | null
          created_at: string | null
          id: string
          notes: string | null
          order_id: string
          package_id: string | null
          package_type_id: string | null
          quantity: number
          unit_price: number | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          order_id: string
          package_id?: string | null
          package_type_id?: string | null
          quantity: number
          unit_price?: number | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          package_id?: string | null
          package_type_id?: string | null
          quantity?: number
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          customer_id: string | null
          fulfilled_date: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          requested_date: string | null
          scheduled_date: string | null
          shipping_address: Json | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          fulfilled_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number: string
          requested_date?: string | null
          scheduled_date?: string | null
          shipping_address?: Json | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          fulfilled_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string
          requested_date?: string | null
          scheduled_date?: string | null
          shipping_address?: Json | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      package_types: {
        Row: {
          container_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          units_per_case: number | null
          updated_at: string | null
          volume_oz: number
        }
        Insert: {
          container_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          units_per_case?: number | null
          updated_at?: string | null
          volume_oz: number
        }
        Update: {
          container_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          units_per_case?: number | null
          updated_at?: string | null
          volume_oz?: number
        }
        Relationships: []
      }
      packages: {
        Row: {
          batch_id: string
          best_by_date: string | null
          created_at: string | null
          id: string
          lot_code: string | null
          notes: string | null
          package_type_id: string
          packaged_date: string
          quantity: number
        }
        Insert: {
          batch_id: string
          best_by_date?: string | null
          created_at?: string | null
          id?: string
          lot_code?: string | null
          notes?: string | null
          package_type_id: string
          packaged_date: string
          quantity: number
        }
        Update: {
          batch_id?: string
          best_by_date?: string | null
          created_at?: string | null
          id?: string
          lot_code?: string | null
          notes?: string | null
          package_type_id?: string
          packaged_date?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "packages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          batch_size_gallons: number | null
          boil_time_minutes: number | null
          brand_id: string | null
          created_at: string | null
          description: string | null
          id: string
          ingredients: Json | null
          instructions: Json | null
          is_active: boolean | null
          mash_temp_f: number | null
          name: string
          notes: string | null
          style: string | null
          target_abv: number | null
          target_fg: number | null
          target_ibu: number | null
          target_og: number | null
          target_srm: number | null
          updated_at: string | null
        }
        Insert: {
          batch_size_gallons?: number | null
          boil_time_minutes?: number | null
          brand_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          ingredients?: Json | null
          instructions?: Json | null
          is_active?: boolean | null
          mash_temp_f?: number | null
          name: string
          notes?: string | null
          style?: string | null
          target_abv?: number | null
          target_fg?: number | null
          target_ibu?: number | null
          target_og?: number | null
          target_srm?: number | null
          updated_at?: string | null
        }
        Update: {
          batch_size_gallons?: number | null
          boil_time_minutes?: number | null
          brand_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          ingredients?: Json | null
          instructions?: Json | null
          is_active?: boolean | null
          mash_temp_f?: number | null
          name?: string
          notes?: string | null
          style?: string | null
          target_abv?: number | null
          target_fg?: number | null
          target_ibu?: number | null
          target_og?: number | null
          target_srm?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          address: Json | null
          brewery_name: string
          created_at: string | null
          currency: string | null
          date_format: string | null
          default_batch_size_gallons: number | null
          email: string | null
          features: Json | null
          fiscal_year_start_month: number | null
          id: string
          phone: string | null
          timezone: string | null
          ttb_permit_number: string | null
          ttb_registry_number: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: Json | null
          brewery_name?: string
          created_at?: string | null
          currency?: string | null
          date_format?: string | null
          default_batch_size_gallons?: number | null
          email?: string | null
          features?: Json | null
          fiscal_year_start_month?: number | null
          id?: string
          phone?: string | null
          timezone?: string | null
          ttb_permit_number?: string | null
          ttb_registry_number?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: Json | null
          brewery_name?: string
          created_at?: string | null
          currency?: string | null
          date_format?: string | null
          default_batch_size_gallons?: number | null
          email?: string | null
          features?: Json | null
          fiscal_year_start_month?: number | null
          id?: string
          phone?: string | null
          timezone?: string | null
          ttb_permit_number?: string | null
          ttb_registry_number?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      vessel_cleanings: {
        Row: {
          chemicals_used: Json | null
          cleaned_at: string
          cleaned_by: string | null
          cleaning_type: Database["public"]["Enums"]["cleaning_type"]
          created_at: string | null
          duration_min: number | null
          from_status: Database["public"]["Enums"]["vessel_status"]
          id: string
          notes: string | null
          to_status: Database["public"]["Enums"]["vessel_status"]
          vessel_id: string
        }
        Insert: {
          chemicals_used?: Json | null
          cleaned_at?: string
          cleaned_by?: string | null
          cleaning_type: Database["public"]["Enums"]["cleaning_type"]
          created_at?: string | null
          duration_min?: number | null
          from_status: Database["public"]["Enums"]["vessel_status"]
          id?: string
          notes?: string | null
          to_status: Database["public"]["Enums"]["vessel_status"]
          vessel_id: string
        }
        Update: {
          chemicals_used?: Json | null
          cleaned_at?: string
          cleaned_by?: string | null
          cleaning_type?: Database["public"]["Enums"]["cleaning_type"]
          created_at?: string | null
          duration_min?: number | null
          from_status?: Database["public"]["Enums"]["vessel_status"]
          id?: string
          notes?: string | null
          to_status?: Database["public"]["Enums"]["vessel_status"]
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "available_vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["id"]
          },
        ]
      }
      vessel_transfers: {
        Row: {
          batch_id: string
          created_at: string | null
          from_vessel_id: string | null
          id: string
          notes: string | null
          to_vessel_id: string
          transferred_at: string
          transferred_by: string | null
          volume_bbl: number
        }
        Insert: {
          batch_id: string
          created_at?: string | null
          from_vessel_id?: string | null
          id?: string
          notes?: string | null
          to_vessel_id: string
          transferred_at?: string
          transferred_by?: string | null
          volume_bbl: number
        }
        Update: {
          batch_id?: string
          created_at?: string | null
          from_vessel_id?: string | null
          id?: string
          notes?: string | null
          to_vessel_id?: string
          transferred_at?: string
          transferred_by?: string | null
          volume_bbl?: number
        }
        Relationships: [
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_from_vessel_id_fkey"
            columns: ["from_vessel_id"]
            isOneToOne: false
            referencedRelation: "available_vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_from_vessel_id_fkey"
            columns: ["from_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_from_vessel_id_fkey"
            columns: ["from_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_to_vessel_id_fkey"
            columns: ["to_vessel_id"]
            isOneToOne: false
            referencedRelation: "available_vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_to_vessel_id_fkey"
            columns: ["to_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_to_vessel_id_fkey"
            columns: ["to_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["id"]
          },
        ]
      }
      vessels: {
        Row: {
          capacity_bbl: number
          created_at: string | null
          current_batch_id: string | null
          id: string
          is_active: boolean | null
          location_id: string | null
          name: string
          notes: string | null
          status: Database["public"]["Enums"]["vessel_status"]
          updated_at: string | null
          vessel_type: Database["public"]["Enums"]["vessel_type"]
        }
        Insert: {
          capacity_bbl: number
          created_at?: string | null
          current_batch_id?: string | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          name: string
          notes?: string | null
          status?: Database["public"]["Enums"]["vessel_status"]
          updated_at?: string | null
          vessel_type: Database["public"]["Enums"]["vessel_type"]
        }
        Update: {
          capacity_bbl?: number
          created_at?: string | null
          current_batch_id?: string | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          name?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["vessel_status"]
          updated_at?: string | null
          vessel_type?: Database["public"]["Enums"]["vessel_type"]
        }
        Relationships: [
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      available_vessels: {
        Row: {
          capacity_bbl: number | null
          created_at: string | null
          current_batch_id: string | null
          id: string | null
          is_active: boolean | null
          location_id: string | null
          location_name: string | null
          name: string | null
          notes: string | null
          status: Database["public"]["Enums"]["vessel_status"] | null
          updated_at: string | null
          vessel_type: Database["public"]["Enums"]["vessel_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      batches_with_brew_info: {
        Row: {
          actual_abv: number | null
          actual_fg: number | null
          actual_og: number | null
          batch_number: string | null
          brew_count: number | null
          brew_date: string | null
          created_at: string | null
          fermenter: string | null
          id: string | null
          name: string | null
          notes: string | null
          planned_start_date: string | null
          recipe_id: string | null
          status: string | null
          updated_at: string | null
          volume_from_brews_bbl: number | null
          volume_gallons: number | null
        }
        Insert: {
          actual_abv?: number | null
          actual_fg?: number | null
          actual_og?: never
          batch_number?: string | null
          brew_count?: never
          brew_date?: never
          created_at?: string | null
          fermenter?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          planned_start_date?: string | null
          recipe_id?: string | null
          status?: string | null
          updated_at?: string | null
          volume_from_brews_bbl?: never
          volume_gallons?: number | null
        }
        Update: {
          actual_abv?: number | null
          actual_fg?: number | null
          actual_og?: never
          batch_number?: string | null
          brew_count?: never
          brew_date?: never
          created_at?: string | null
          fermenter?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          planned_start_date?: string | null
          recipe_id?: string | null
          status?: string | null
          updated_at?: string | null
          volume_from_brews_bbl?: never
          volume_gallons?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      brew_log_metrics: {
        Row: {
          actual_mash_ph: number | null
          actual_og: number | null
          allocated_volume_bbl: number | null
          brew_date: string | null
          brew_number: string | null
          id: string | null
          pre_boil_gravity: number | null
          status: string | null
          volume_to_fermenter_bbl: number | null
        }
        Insert: {
          actual_mash_ph?: never
          actual_og?: never
          allocated_volume_bbl?: never
          brew_date?: string | null
          brew_number?: string | null
          id?: string | null
          pre_boil_gravity?: never
          status?: string | null
          volume_to_fermenter_bbl?: never
        }
        Update: {
          actual_mash_ph?: never
          actual_og?: never
          allocated_volume_bbl?: never
          brew_date?: string | null
          brew_number?: string | null
          id?: string | null
          pre_boil_gravity?: never
          status?: string | null
          volume_to_fermenter_bbl?: never
        }
        Relationships: []
      }
      recent_vessel_cleanings: {
        Row: {
          chemicals_used: Json | null
          cleaned_at: string | null
          cleaned_by: string | null
          cleaned_by_email: string | null
          cleaning_type: Database["public"]["Enums"]["cleaning_type"] | null
          created_at: string | null
          duration_min: number | null
          from_status: Database["public"]["Enums"]["vessel_status"] | null
          id: string | null
          notes: string | null
          to_status: Database["public"]["Enums"]["vessel_status"] | null
          vessel_id: string | null
          vessel_name: string | null
          vessel_type: Database["public"]["Enums"]["vessel_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "available_vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["id"]
          },
        ]
      }
      vessels_with_batch: {
        Row: {
          batch_name: string | null
          batch_number: string | null
          batch_status: string | null
          capacity_bbl: number | null
          created_at: string | null
          current_batch_id: string | null
          id: string | null
          is_active: boolean | null
          location_id: string | null
          name: string | null
          notes: string | null
          recipe_name: string | null
          status: Database["public"]["Enums"]["vessel_status"] | null
          updated_at: string | null
          vessel_type: Database["public"]["Enums"]["vessel_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      cleaning_type:
        | "cip"
        | "caustic"
        | "acid"
        | "sanitize"
        | "manual"
        | "rinse"
      vessel_status:
        | "dirty"
        | "caustic_cleaned"
        | "ready_for_use"
        | "in_use"
        | "maintenance"
      vessel_type:
        | "fermenter"
        | "brite"
        | "kettle"
        | "mash_tun"
        | "hlt"
        | "unitank"
        | "foeder"
        | "barrel"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cleaning_type: ["cip", "caustic", "acid", "sanitize", "manual", "rinse"],
      vessel_status: [
        "dirty",
        "caustic_cleaned",
        "ready_for_use",
        "in_use",
        "maintenance",
      ],
      vessel_type: [
        "fermenter",
        "brite",
        "kettle",
        "mash_tun",
        "hlt",
        "unitank",
        "foeder",
        "barrel",
      ],
    },
  },
} as const
