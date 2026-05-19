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
          ai_context: Json | null
          calculated_fields: Json | null
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
          ai_context?: Json | null
          calculated_fields?: Json | null
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
          ai_context?: Json | null
          calculated_fields?: Json | null
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
      additives: {
        Row: {
          cost_per_unit: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          type: string
          typical_amount: number | null
          typical_unit: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          cost_per_unit?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          type: string
          typical_amount?: number | null
          typical_unit?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          cost_per_unit?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          type?: string
          typical_amount?: number | null
          typical_unit?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      adjuncts: {
        Row: {
          bag_weight_lbs: number | null
          color_lovibond: number | null
          cost_per_lb: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          potential_ppg: number | null
          requires_mash: boolean | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          bag_weight_lbs?: number | null
          color_lovibond?: number | null
          cost_per_lb?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          potential_ppg?: number | null
          requires_mash?: boolean | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          bag_weight_lbs?: number | null
          color_lovibond?: number | null
          cost_per_lb?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          potential_ppg?: number | null
          requires_mash?: boolean | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      allocations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          destination_id: string | null
          destination_type: string
          id: string
          lot_number: string | null
          notes: string | null
          quantity: number
          reason_code: string | null
          rejection_reason: string | null
          requires_approval: boolean | null
          source_id: string | null
          source_type: string
          status: string
          unit_cost: number | null
          updated_at: string | null
          volume_bbl: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          destination_id?: string | null
          destination_type: string
          id?: string
          lot_number?: string | null
          notes?: string | null
          quantity: number
          reason_code?: string | null
          rejection_reason?: string | null
          requires_approval?: boolean | null
          source_id?: string | null
          source_type: string
          status?: string
          unit_cost?: number | null
          updated_at?: string | null
          volume_bbl?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          destination_id?: string | null
          destination_type?: string
          id?: string
          lot_number?: string | null
          notes?: string | null
          quantity?: number
          reason_code?: string | null
          rejection_reason?: string | null
          requires_approval?: boolean | null
          source_id?: string | null
          source_type?: string
          status?: string
          unit_cost?: number | null
          updated_at?: string | null
          volume_bbl?: number | null
        }
        Relationships: []
      }
      allocations_legacy: {
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
          {
            foreignKeyName: "allocations_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_low_stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_additions: {
        Row: {
          addition_type: string
          amount: number
          batch_id: string
          catalog_id: string | null
          catalog_table: string | null
          created_at: string
          date_added: string | null
          days: number | null
          id: string
          name: string
          notes: string | null
          timing: string | null
          unit: string
        }
        Insert: {
          addition_type: string
          amount: number
          batch_id: string
          catalog_id?: string | null
          catalog_table?: string | null
          created_at?: string
          date_added?: string | null
          days?: number | null
          id?: string
          name: string
          notes?: string | null
          timing?: string | null
          unit: string
        }
        Update: {
          addition_type?: string
          amount?: number
          batch_id?: string
          catalog_id?: string | null
          catalog_table?: string | null
          created_at?: string
          date_added?: string | null
          days?: number | null
          id?: string
          name?: string
          notes?: string | null
          timing?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      batch_blends: {
        Row: {
          blend_batch_id: string
          blended_at: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          source_batch_id: string
          volume_bbl: number
        }
        Insert: {
          blend_batch_id: string
          blended_at?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          source_batch_id: string
          volume_bbl: number
        }
        Update: {
          blend_batch_id?: string
          blended_at?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          source_batch_id?: string
          volume_bbl?: number
        }
        Relationships: [
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      batches: {
        Row: {
          actual_abv: number | null
          actual_fg: number | null
          archive_notes: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          batch_code: string
          cancellation_notes: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          estimated_volume_bbl: number | null
          id: string
          name: string
          notes: string | null
          planned_start_date: string | null
          recipe_id: string | null
          recipe_variant_id: string | null
          status: string
          target_package_date: string | null
          updated_at: string | null
          volume_bbl: number | null
        }
        Insert: {
          actual_abv?: number | null
          actual_fg?: number | null
          archive_notes?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          batch_code?: string
          cancellation_notes?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          estimated_volume_bbl?: number | null
          id?: string
          name: string
          notes?: string | null
          planned_start_date?: string | null
          recipe_id?: string | null
          recipe_variant_id?: string | null
          status?: string
          target_package_date?: string | null
          updated_at?: string | null
          volume_bbl?: number | null
        }
        Update: {
          actual_abv?: number | null
          actual_fg?: number | null
          archive_notes?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          batch_code?: string
          cancellation_notes?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          estimated_volume_bbl?: number | null
          id?: string
          name?: string
          notes?: string | null
          planned_start_date?: string | null
          recipe_id?: string | null
          recipe_variant_id?: string | null
          status?: string
          target_package_date?: string | null
          updated_at?: string | null
          volume_bbl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      beer_styles: {
        Row: {
          abv_max: number | null
          abv_min: number | null
          category: string
          created_at: string | null
          description: string | null
          fg_max: number | null
          fg_min: number | null
          ibu_max: number | null
          ibu_min: number | null
          id: string
          is_active: boolean | null
          is_bjcp: boolean | null
          name: string
          og_max: number | null
          og_min: number | null
          srm_max: number | null
          srm_min: number | null
          updated_at: string | null
        }
        Insert: {
          abv_max?: number | null
          abv_min?: number | null
          category: string
          created_at?: string | null
          description?: string | null
          fg_max?: number | null
          fg_min?: number | null
          ibu_max?: number | null
          ibu_min?: number | null
          id?: string
          is_active?: boolean | null
          is_bjcp?: boolean | null
          name: string
          og_max?: number | null
          og_min?: number | null
          srm_max?: number | null
          srm_min?: number | null
          updated_at?: string | null
        }
        Update: {
          abv_max?: number | null
          abv_min?: number | null
          category?: string
          created_at?: string | null
          description?: string | null
          fg_max?: number | null
          fg_min?: number | null
          ibu_max?: number | null
          ibu_min?: number | null
          id?: string
          is_active?: boolean | null
          is_bjcp?: boolean | null
          name?: string
          og_max?: number | null
          og_min?: number | null
          srm_max?: number | null
          srm_min?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      bin_inventory: {
        Row: {
          bin_id: string
          created_at: string | null
          finished_good_id: string
          id: string
          quantity: number
          updated_at: string | null
          version: number | null
        }
        Insert: {
          bin_id: string
          created_at?: string | null
          finished_good_id: string
          id?: string
          quantity?: number
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          bin_id?: string
          created_at?: string | null
          finished_good_id?: string
          id?: string
          quantity?: number
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bin_inventory_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_inventory_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_inventory_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_inventory_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_inventory_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_ttb_class"
            referencedColumns: ["id"]
          },
        ]
      }
      bin_inventory_items: {
        Row: {
          bin_id: string
          created_at: string
          id: string
          inventory_lot_id: string
          quantity: number
          updated_at: string
          version: number
        }
        Insert: {
          bin_id: string
          created_at?: string
          id?: string
          inventory_lot_id: string
          quantity?: number
          updated_at?: string
          version?: number
        }
        Update: {
          bin_id?: string
          created_at?: string
          id?: string
          inventory_lot_id?: string
          quantity?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bin_inventory_items_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_inventory_items_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_inventory_items_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_inventory_items_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots_with_quantities"
            referencedColumns: ["id"]
          },
        ]
      }
      bins: {
        Row: {
          bin_type: string
          capacity: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          location_id: string
          name: string
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          bin_type?: string
          capacity?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          location_id: string
          name: string
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          bin_type?: string
          capacity?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          location_id?: string
          name?: string
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
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
          sku: string | null
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
          sku?: string | null
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
          sku?: string | null
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "brew_log_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brew_log_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brew_log_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "brew_log_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
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
          {
            foreignKeyName: "brew_log_batches_brew_log_id_fkey"
            columns: ["brew_log_id"]
            isOneToOne: false
            referencedRelation: "brew_logs_with_batches"
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
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      channel_formats: {
        Row: {
          id: string
          sales_channel_id: string
          selling_format_id: string
        }
        Insert: {
          id?: string
          sales_channel_id: string
          selling_format_id: string
        }
        Update: {
          id?: string
          sales_channel_id?: string
          selling_format_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_formats_sales_channel_id_fkey"
            columns: ["sales_channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_formats_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "channel_formats_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "channel_formats_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "channel_formats_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_formats_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_formats_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      containers: {
        Row: {
          created_at: string
          deposit_amount: number
          id: string
          is_active: boolean
          name: string
          position: number
          type: string
          updated_at: string
          volume_bbl: number | null
          volume_oz: number | null
        }
        Insert: {
          created_at?: string
          deposit_amount?: number
          id?: string
          is_active?: boolean
          name: string
          position?: number
          type: string
          updated_at?: string
          volume_bbl?: number | null
          volume_oz?: number | null
        }
        Update: {
          created_at?: string
          deposit_amount?: number
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          type?: string
          updated_at?: string
          volume_bbl?: number | null
          volume_oz?: number | null
        }
        Relationships: []
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
          is_tax_exempt: boolean
          name: string
          notes: string | null
          payment_terms_days: number | null
          phone: string | null
          price_tier_id: string | null
          sales_channel_id: string | null
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
          is_tax_exempt?: boolean
          name: string
          notes?: string | null
          payment_terms_days?: number | null
          phone?: string | null
          price_tier_id?: string | null
          sales_channel_id?: string | null
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
          is_tax_exempt?: boolean
          name?: string
          notes?: string | null
          payment_terms_days?: number | null
          phone?: string | null
          price_tier_id?: string | null
          sales_channel_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_pricing_tier_id_fkey"
            columns: ["price_tier_id"]
            isOneToOne: false
            referencedRelation: "pricing_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_sales_channel_id_fkey"
            columns: ["sales_channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_number: string
          driver_name: string | null
          id: string
          notes: string | null
          receive_date: string | null
          scheduled_date: string | null
          ship_date: string | null
          status: string
          updated_at: string
          updated_by: string | null
          vehicle: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_number: string
          driver_name?: string | null
          id?: string
          notes?: string | null
          receive_date?: string | null
          scheduled_date?: string | null
          ship_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_number?: string
          driver_name?: string | null
          id?: string
          notes?: string | null
          receive_date?: string | null
          scheduled_date?: string | null
          ship_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle?: string | null
        }
        Relationships: []
      }
      email_notification_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          notification_type: string
          recipient_email: string
          sent_at: string | null
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          notification_type: string
          recipient_email: string
          sent_at?: string | null
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          notification_type?: string
          recipient_email?: string
          sent_at?: string | null
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          app_url: string | null
          created_at: string
          id: string
          is_enabled: boolean
          supabase_project_url: string | null
          updated_at: string
        }
        Insert: {
          app_url?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          supabase_project_url?: string | null
          updated_at?: string
        }
        Update: {
          app_url?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          supabase_project_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      entity_revisions: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by: string | null
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          new_data: Json | null
          old_data: Json | null
          operation: string
          revision_number: number
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation: string
          revision_number: number
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation?: string
          revision_number?: number
        }
        Relationships: []
      }
      enum_values: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          enum_type: string
          group_name: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          label: string
          metadata: Json | null
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          enum_type: string
          group_name?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          label: string
          metadata?: Json | null
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          enum_type?: string
          group_name?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          label?: string
          metadata?: Json | null
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      finished_goods: {
        Row: {
          batch_id: string | null
          best_by_date: string | null
          brand_id: string
          created_at: string | null
          created_by: string | null
          expiration_date: string | null
          id: string
          lot_number: string
          notes: string | null
          production_date: string | null
          quantity: number
          selling_format_id: string | null
          session_line_item_id: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          batch_id?: string | null
          best_by_date?: string | null
          brand_id: string
          created_at?: string | null
          created_by?: string | null
          expiration_date?: string | null
          id?: string
          lot_number: string
          notes?: string | null
          production_date?: string | null
          quantity: number
          selling_format_id?: string | null
          session_line_item_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          batch_id?: string | null
          best_by_date?: string | null
          brand_id?: string
          created_at?: string | null
          created_by?: string | null
          expiration_date?: string | null
          id?: string
          lot_number?: string
          notes?: string | null
          production_date?: string | null
          quantity?: number
          selling_format_id?: string | null
          session_line_item_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_session_line_item_id_fkey"
            columns: ["session_line_item_id"]
            isOneToOne: false
            referencedRelation: "session_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fruits: {
        Row: {
          cost_per_lb: number | null
          created_at: string | null
          description: string | null
          form: string | null
          id: string
          is_active: boolean | null
          name: string
          sugar_content: number | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          cost_per_lb?: number | null
          created_at?: string | null
          description?: string | null
          form?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sugar_content?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          cost_per_lb?: number | null
          created_at?: string | null
          description?: string | null
          form?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sugar_content?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hops: {
        Row: {
          alpha_acid_max: number | null
          alpha_acid_min: number | null
          alpha_acid_typical: number | null
          bag_weight_lbs: number | null
          beta_acid_max: number | null
          beta_acid_min: number | null
          caryophyllene_percent: number | null
          cost_per_lb: number | null
          created_at: string | null
          farnesene_percent: number | null
          flavor_profile: string | null
          hsi: number | null
          humulene_percent: number | null
          id: string
          is_active: boolean | null
          myrcene_percent: number | null
          name: string
          oil_ml_100g: number | null
          origin: string | null
          substitutes: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          alpha_acid_max?: number | null
          alpha_acid_min?: number | null
          alpha_acid_typical?: number | null
          bag_weight_lbs?: number | null
          beta_acid_max?: number | null
          beta_acid_min?: number | null
          caryophyllene_percent?: number | null
          cost_per_lb?: number | null
          created_at?: string | null
          farnesene_percent?: number | null
          flavor_profile?: string | null
          hsi?: number | null
          humulene_percent?: number | null
          id?: string
          is_active?: boolean | null
          myrcene_percent?: number | null
          name: string
          oil_ml_100g?: number | null
          origin?: string | null
          substitutes?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          alpha_acid_max?: number | null
          alpha_acid_min?: number | null
          alpha_acid_typical?: number | null
          bag_weight_lbs?: number | null
          beta_acid_max?: number | null
          beta_acid_min?: number | null
          caryophyllene_percent?: number | null
          cost_per_lb?: number | null
          created_at?: string | null
          farnesene_percent?: number | null
          flavor_profile?: string | null
          hsi?: number | null
          humulene_percent?: number | null
          id?: string
          is_active?: boolean | null
          myrcene_percent?: number | null
          name?: string
          oil_ml_100g?: number | null
          origin?: string | null
          substitutes?: string | null
          type?: string | null
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
      inventory_lots: {
        Row: {
          created_at: string | null
          expiration_date: string | null
          id: string
          inventory_item_id: string
          landed_cost: number | null
          location: string | null
          lot_number: string | null
          notes: string | null
          po_receive_id: string | null
          quantity: number
          received_date: string | null
          unit: string
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          inventory_item_id: string
          landed_cost?: number | null
          location?: string | null
          lot_number?: string | null
          notes?: string | null
          po_receive_id?: string | null
          quantity: number
          received_date?: string | null
          unit: string
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          inventory_item_id?: string
          landed_cost?: number | null
          location?: string | null
          lot_number?: string | null
          notes?: string | null
          po_receive_id?: string | null
          quantity?: number
          received_date?: string | null
          unit?: string
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_low_stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_po_receive_id_fkey"
            columns: ["po_receive_id"]
            isOneToOne: false
            referencedRelation: "po_receives"
            referencedColumns: ["id"]
          },
        ]
      }
      keg_owner_deposits: {
        Row: {
          created_at: string | null
          deposit_amount: number
          id: string
          keg_owner_id: string
          selling_format_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deposit_amount?: number
          id?: string
          keg_owner_id: string
          selling_format_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deposit_amount?: number
          id?: string
          keg_owner_id?: string
          selling_format_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keg_owner_deposits_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_owner_deposits_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_owner_deposits_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_owner_deposits_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_owner_deposits_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_owner_deposits_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_owner_deposits_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      keg_owners: {
        Row: {
          code: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          position: number | null
          updated_at: string | null
        }
        Insert: {
          code: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          position?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          position?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      keg_transactions: {
        Row: {
          batch_id: string | null
          created_at: string | null
          created_by_name: string | null
          customer_id: string | null
          finished_good_id: string | null
          from_location_id: string | null
          from_state: Database["public"]["Enums"]["keg_state"] | null
          id: string
          keg_owner_id: string | null
          notes: string | null
          order_id: string | null
          packaging_session_id: string | null
          quantity: number
          selling_format_id: string | null
          to_location_id: string | null
          to_state: Database["public"]["Enums"]["keg_state"]
          transaction_type: Database["public"]["Enums"]["keg_transaction_type"]
        }
        Insert: {
          batch_id?: string | null
          created_at?: string | null
          created_by_name?: string | null
          customer_id?: string | null
          finished_good_id?: string | null
          from_location_id?: string | null
          from_state?: Database["public"]["Enums"]["keg_state"] | null
          id?: string
          keg_owner_id?: string | null
          notes?: string | null
          order_id?: string | null
          packaging_session_id?: string | null
          quantity: number
          selling_format_id?: string | null
          to_location_id?: string | null
          to_state: Database["public"]["Enums"]["keg_state"]
          transaction_type: Database["public"]["Enums"]["keg_transaction_type"]
        }
        Update: {
          batch_id?: string | null
          created_at?: string | null
          created_by_name?: string | null
          customer_id?: string | null
          finished_good_id?: string | null
          from_location_id?: string | null
          from_state?: Database["public"]["Enums"]["keg_state"] | null
          id?: string
          keg_owner_id?: string | null
          notes?: string | null
          order_id?: string | null
          packaging_session_id?: string | null
          quantity?: number
          selling_format_id?: string | null
          to_location_id?: string | null
          to_state?: Database["public"]["Enums"]["keg_state"]
          transaction_type?: Database["public"]["Enums"]["keg_transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balance_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_revenue_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_with_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_ttb_class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_packaging_session_id_fkey"
            columns: ["packaging_session_id"]
            isOneToOne: false
            referencedRelation: "packaging_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_packaging_session_id_fkey"
            columns: ["packaging_session_id"]
            isOneToOne: false
            referencedRelation: "packaging_sessions_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      location_transfers: {
        Row: {
          created_at: string | null
          delivery_id: string | null
          from_bin_id: string
          id: string
          notes: string | null
          receive_date: string | null
          received_by: string | null
          remainder_of: string | null
          ship_date: string | null
          shipped_by: string | null
          status: string
          to_bin_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          delivery_id?: string | null
          from_bin_id: string
          id?: string
          notes?: string | null
          receive_date?: string | null
          received_by?: string | null
          remainder_of?: string | null
          ship_date?: string | null
          shipped_by?: string | null
          status?: string
          to_bin_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          delivery_id?: string | null
          from_bin_id?: string
          id?: string
          notes?: string | null
          receive_date?: string | null
          received_by?: string | null
          remainder_of?: string | null
          ship_date?: string | null
          shipped_by?: string | null
          status?: string
          to_bin_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_transfers_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_from_bin_id_fkey"
            columns: ["from_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_from_bin_id_fkey"
            columns: ["from_bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_remainder_of_fkey"
            columns: ["remainder_of"]
            isOneToOne: false
            referencedRelation: "location_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_remainder_of_fkey"
            columns: ["remainder_of"]
            isOneToOne: false
            referencedRelation: "location_transfers_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_to_bin_id_fkey"
            columns: ["to_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_to_bin_id_fkey"
            columns: ["to_bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
        ]
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
          pos_bin_id: string | null
          square_location_id: string | null
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
          pos_bin_id?: string | null
          square_location_id?: string | null
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
          pos_bin_id?: string | null
          square_location_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_pos_bin_id_fkey"
            columns: ["pos_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_pos_bin_id_fkey"
            columns: ["pos_bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      malts: {
        Row: {
          bag_weight_lbs: number | null
          color_lovibond: number | null
          cost_per_lb: number | null
          country: string | null
          created_at: string | null
          description: string | null
          diastatic_power: number | null
          id: string
          is_active: boolean | null
          maltster: string | null
          max_percentage: number | null
          moisture_percent: number | null
          name: string
          potential_ppg: number | null
          protein_percent: number | null
          requires_mash: boolean | null
          type: string
          updated_at: string | null
        }
        Insert: {
          bag_weight_lbs?: number | null
          color_lovibond?: number | null
          cost_per_lb?: number | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          diastatic_power?: number | null
          id?: string
          is_active?: boolean | null
          maltster?: string | null
          max_percentage?: number | null
          moisture_percent?: number | null
          name: string
          potential_ppg?: number | null
          protein_percent?: number | null
          requires_mash?: boolean | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          bag_weight_lbs?: number | null
          color_lovibond?: number | null
          cost_per_lb?: number | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          diastatic_power?: number | null
          id?: string
          is_active?: boolean | null
          maltster?: string | null
          max_percentage?: number | null
          moisture_percent?: number | null
          name?: string
          potential_ppg?: number | null
          protein_percent?: number | null
          requires_mash?: boolean | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          batch_status_enabled: boolean | null
          created_at: string | null
          email_digest_frequency: string | null
          email_enabled: boolean | null
          id: string
          in_app_enabled: boolean | null
          inventory_low_enabled: boolean | null
          order_received_enabled: boolean | null
          quiet_hours_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          system_enabled: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          batch_status_enabled?: boolean | null
          created_at?: string | null
          email_digest_frequency?: string | null
          email_enabled?: boolean | null
          id?: string
          in_app_enabled?: boolean | null
          inventory_low_enabled?: boolean | null
          order_received_enabled?: boolean | null
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          system_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          batch_status_enabled?: boolean | null
          created_at?: string | null
          email_digest_frequency?: string | null
          email_enabled?: boolean | null
          id?: string
          in_app_enabled?: boolean | null
          inventory_low_enabled?: boolean | null
          order_received_enabled?: boolean | null
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          system_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          message: string | null
          metadata: Json | null
          priority: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          priority?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          priority?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          batch_id: string | null
          brand_id: string | null
          created_at: string | null
          id: string
          keg_owner_id: string | null
          notes: string | null
          order_id: string
          package_id: string | null
          quantity: number
          selling_format_id: string | null
          style_id: string | null
          tbd_notes: string | null
          unit_price: number | null
        }
        Insert: {
          batch_id?: string | null
          brand_id?: string | null
          created_at?: string | null
          id?: string
          keg_owner_id?: string | null
          notes?: string | null
          order_id: string
          package_id?: string | null
          quantity: number
          selling_format_id?: string | null
          style_id?: string | null
          tbd_notes?: string | null
          unit_price?: number | null
        }
        Update: {
          batch_id?: string | null
          brand_id?: string | null
          created_at?: string | null
          id?: string
          keg_owner_id?: string | null
          notes?: string | null
          order_id?: string
          package_id?: string | null
          quantity?: number
          selling_format_id?: string | null
          style_id?: string | null
          tbd_notes?: string | null
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "order_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "order_items_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
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
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
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
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "beer_styles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          customer_id: string | null
          delivery_id: string | null
          fulfilled_date: string | null
          id: string
          is_export: boolean | null
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
          delivery_id?: string | null
          fulfilled_date?: string | null
          id?: string
          is_export?: boolean | null
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
          delivery_id?: string | null
          fulfilled_date?: string | null
          id?: string
          is_export?: boolean | null
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
            referencedRelation: "customer_keg_balance_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_revenue_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_with_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries_with_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          batch_id: string
          best_by_date: string | null
          created_at: string | null
          id: string
          lot_code: string | null
          notes: string | null
          packaged_date: string
          quantity: number
          selling_format_id: string
        }
        Insert: {
          batch_id: string
          best_by_date?: string | null
          created_at?: string | null
          id?: string
          lot_code?: string | null
          notes?: string | null
          packaged_date: string
          quantity: number
          selling_format_id: string
        }
        Update: {
          batch_id?: string
          best_by_date?: string | null
          created_at?: string | null
          id?: string
          lot_code?: string | null
          notes?: string | null
          packaged_date?: string
          quantity?: number
          selling_format_id?: string
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "packages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "packages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "packages_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "packages_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "packages_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "packages_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          session_date: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          session_date?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          session_date?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pick_list_items: {
        Row: {
          finished_good_id: string
          id: string
          location_id: string | null
          notes: string | null
          order_item_id: string
          pick_list_id: string
          picked_at: string | null
          quantity_picked: number | null
          quantity_requested: number
          sort_order: number
        }
        Insert: {
          finished_good_id: string
          id?: string
          location_id?: string | null
          notes?: string | null
          order_item_id: string
          pick_list_id: string
          picked_at?: string | null
          quantity_picked?: number | null
          quantity_requested: number
          sort_order?: number
        }
        Update: {
          finished_good_id?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          order_item_id?: string
          pick_list_id?: string
          picked_at?: string | null
          quantity_picked?: number | null
          quantity_requested?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "pick_list_items_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_ttb_class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_pick_list_id_fkey"
            columns: ["pick_list_id"]
            isOneToOne: false
            referencedRelation: "pick_list_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_list_items_pick_list_id_fkey"
            columns: ["pick_list_id"]
            isOneToOne: false
            referencedRelation: "pick_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_lists: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          generated_at: string
          id: string
          notes: string | null
          order_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          generated_at?: string
          id?: string
          notes?: string | null
          order_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          generated_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
            referencedColumns: ["id"]
          },
        ]
      }
      po_line_items: {
        Row: {
          catalog_id: string
          catalog_type: string
          created_at: string | null
          id: string
          po_id: string
          quantity: number
          unit: string
          unit_price: number | null
        }
        Insert: {
          catalog_id: string
          catalog_type: string
          created_at?: string | null
          id?: string
          po_id: string
          quantity: number
          unit: string
          unit_price?: number | null
        }
        Update: {
          catalog_id?: string
          catalog_type?: string
          created_at?: string | null
          id?: string
          po_id?: string
          quantity?: number
          unit?: string
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "po_line_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      po_receives: {
        Row: {
          created_at: string | null
          expiration_date: string | null
          id: string
          lot_number: string | null
          notes: string | null
          po_line_item_id: string
          quantity: number
          received_by: string | null
          received_date: string | null
        }
        Insert: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          lot_number?: string | null
          notes?: string | null
          po_line_item_id: string
          quantity: number
          received_by?: string | null
          received_date?: string | null
        }
        Update: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          lot_number?: string | null
          notes?: string | null
          po_line_item_id?: string
          quantity?: number
          received_by?: string | null
          received_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_receives_po_line_item_id_fkey"
            columns: ["po_line_item_id"]
            isOneToOne: false
            referencedRelation: "po_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_receives_po_line_item_id_fkey"
            columns: ["po_line_item_id"]
            isOneToOne: false
            referencedRelation: "po_line_items_with_quantities"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_channel_formats: {
        Row: {
          format_id: string
          sales_channel_id: string
        }
        Insert: {
          format_id: string
          sales_channel_id: string
        }
        Update: {
          format_id?: string
          sales_channel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_channel_formats_sales_channel_id_fkey"
            columns: ["sales_channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          format_id: string | null
          id: string
          new_price: number | null
          old_price: number | null
          pricing_tier_id: string
          pricing_tier_price_id: string | null
          sales_channel_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          format_id?: string | null
          id?: string
          new_price?: number | null
          old_price?: number | null
          pricing_tier_id: string
          pricing_tier_price_id?: string | null
          sales_channel_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          format_id?: string | null
          id?: string
          new_price?: number | null
          old_price?: number | null
          pricing_tier_id?: string
          pricing_tier_price_id?: string | null
          sales_channel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_history_pricing_tier_price_id_fkey"
            columns: ["pricing_tier_price_id"]
            isOneToOne: false
            referencedRelation: "pricing_tier_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_tier_prices: {
        Row: {
          created_at: string
          format_id: string
          id: string
          price: number
          pricing_tier_id: string
          sales_channel_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          format_id: string
          id?: string
          price: number
          pricing_tier_id: string
          sales_channel_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          format_id?: string
          id?: string
          price?: number
          pricing_tier_id?: string
          sales_channel_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_tier_prices_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "pricing_tier_prices_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "pricing_tier_prices_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "pricing_tier_prices_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_tier_prices_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_tier_prices_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_tier_prices_pricing_tier_id_fkey"
            columns: ["pricing_tier_id"]
            isOneToOne: false
            referencedRelation: "pricing_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_tier_prices_sales_channel_id_fkey"
            columns: ["sales_channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_tiers: {
        Row: {
          cogs_max: number | null
          created_at: string
          default_upc: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          cogs_max?: number | null
          created_at?: string
          default_upc?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          cogs_max?: number | null
          created_at?: string
          default_upc?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          created_at: string | null
          created_by: string | null
          expected_date: string | null
          id: string
          notes: string | null
          order_date: string | null
          po_number: string
          shipping_cost: number | null
          status: string
          submitted_at: string | null
          supplier_id: string | null
          tax: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          po_number: string
          shipping_cost?: number | null
          status?: string
          submitted_at?: string | null
          supplier_id?: string | null
          tax?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          po_number?: string
          shipping_cost?: number | null
          status?: string
          submitted_at?: string | null
          supplier_id?: string | null
          tax?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_account_mappings: {
        Row: {
          category: string
          created_at: string
          id: string
          qbo_account_id: string | null
          qbo_account_name: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          qbo_account_id?: string | null
          qbo_account_name?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          qbo_account_id?: string | null
          qbo_account_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      qbo_sync_log: {
        Row: {
          action: string
          completed_at: string | null
          created_at: string
          entity_id: string
          entity_type: string
          error_message: string | null
          id: string
          request_payload: Json | null
          response_payload: Json | null
          status: string
        }
        Insert: {
          action: string
          completed_at?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          error_message?: string | null
          id?: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
        }
        Update: {
          action?: string
          completed_at?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          id?: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
        }
        Relationships: []
      }
      qbo_sync_mappings: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          last_synced_at: string
          qbo_entity_id: string
          qbo_entity_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          last_synced_at?: string
          qbo_entity_id: string
          qbo_entity_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          last_synced_at?: string
          qbo_entity_id?: string
          qbo_entity_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      recipe_additions: {
        Row: {
          additive_id: string
          amount: number
          created_at: string | null
          id: string
          position: number | null
          recipe_id: string
          target: string | null
          timing: string
          unit: string
        }
        Insert: {
          additive_id: string
          amount: number
          created_at?: string | null
          id?: string
          position?: number | null
          recipe_id: string
          target?: string | null
          timing: string
          unit: string
        }
        Update: {
          additive_id?: string
          amount?: number
          created_at?: string | null
          id?: string
          position?: number | null
          recipe_id?: string
          target?: string | null
          timing?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_additions_additive_id_fkey"
            columns: ["additive_id"]
            isOneToOne: false
            referencedRelation: "additives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_additions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_additions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_additions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_additions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_adjuncts: {
        Row: {
          adjunct_id: string
          created_at: string | null
          id: string
          notes: string | null
          position: number | null
          recipe_id: string
          timing: string | null
          weight_lbs: number
        }
        Insert: {
          adjunct_id: string
          created_at?: string | null
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id: string
          timing?: string | null
          weight_lbs: number
        }
        Update: {
          adjunct_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id?: string
          timing?: string | null
          weight_lbs?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_adjuncts_adjunct_id_fkey"
            columns: ["adjunct_id"]
            isOneToOne: false
            referencedRelation: "adjuncts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_adjuncts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_adjuncts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_adjuncts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_adjuncts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_collaborators: {
        Row: {
          created_at: string | null
          id: string
          recipe_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          recipe_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          recipe_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_collaborators_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_collaborators_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_collaborators_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_collaborators_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_fruits: {
        Row: {
          amount: number
          created_at: string | null
          fruit_id: string
          id: string
          notes: string | null
          position: number | null
          recipe_id: string
          timing: string | null
          unit: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          fruit_id: string
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id: string
          timing?: string | null
          unit?: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          fruit_id?: string
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id?: string
          timing?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_fruits_fruit_id_fkey"
            columns: ["fruit_id"]
            isOneToOne: false
            referencedRelation: "fruits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_fruits_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_fruits_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_fruits_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_fruits_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_hops: {
        Row: {
          alpha_acid: number | null
          boil_time_min: number | null
          created_at: string | null
          hop_id: string
          id: string
          notes: string | null
          position: number | null
          recipe_id: string
          timing: string
          weight_oz: number
        }
        Insert: {
          alpha_acid?: number | null
          boil_time_min?: number | null
          created_at?: string | null
          hop_id: string
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id: string
          timing?: string
          weight_oz: number
        }
        Update: {
          alpha_acid?: number | null
          boil_time_min?: number | null
          created_at?: string | null
          hop_id?: string
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id?: string
          timing?: string
          weight_oz?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_hops_hop_id_fkey"
            columns: ["hop_id"]
            isOneToOne: false
            referencedRelation: "hops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_hops_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_hops_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_hops_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_hops_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_malts: {
        Row: {
          color_lov: number | null
          created_at: string | null
          id: string
          malt_id: string
          notes: string | null
          position: number | null
          ppg: number | null
          recipe_id: string
          weight_lbs: number
        }
        Insert: {
          color_lov?: number | null
          created_at?: string | null
          id?: string
          malt_id: string
          notes?: string | null
          position?: number | null
          ppg?: number | null
          recipe_id: string
          weight_lbs: number
        }
        Update: {
          color_lov?: number | null
          created_at?: string | null
          id?: string
          malt_id?: string
          notes?: string | null
          position?: number | null
          ppg?: number | null
          recipe_id?: string
          weight_lbs?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_malts_malt_id_fkey"
            columns: ["malt_id"]
            isOneToOne: false
            referencedRelation: "malts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_malts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_malts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_malts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_malts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_spices: {
        Row: {
          amount: number
          boil_time_min: number | null
          created_at: string | null
          id: string
          notes: string | null
          position: number | null
          recipe_id: string
          spice_id: string
          timing: string | null
          unit: string
        }
        Insert: {
          amount: number
          boil_time_min?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id: string
          spice_id: string
          timing?: string | null
          unit?: string
        }
        Update: {
          amount?: number
          boil_time_min?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id?: string
          spice_id?: string
          timing?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_spices_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_spices_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_spices_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_spices_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_spices_spice_id_fkey"
            columns: ["spice_id"]
            isOneToOne: false
            referencedRelation: "spices"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_sugars: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          position: number | null
          recipe_id: string
          sugar_id: string
          timing: string | null
          weight_lbs: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id: string
          sugar_id: string
          timing?: string | null
          weight_lbs: number
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          position?: number | null
          recipe_id?: string
          sugar_id?: string
          timing?: string | null
          weight_lbs?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_sugars_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_sugars_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_sugars_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_sugars_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_sugars_sugar_id_fkey"
            columns: ["sugar_id"]
            isOneToOne: false
            referencedRelation: "sugars"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_variant_adjuncts: {
        Row: {
          adjunct_id: string
          amount: number
          created_at: string
          id: string
          position: number
          recipe_variant_id: string
          timing: string | null
          unit: string
        }
        Insert: {
          adjunct_id: string
          amount: number
          created_at?: string
          id?: string
          position?: number
          recipe_variant_id: string
          timing?: string | null
          unit: string
        }
        Update: {
          adjunct_id?: string
          amount?: number
          created_at?: string
          id?: string
          position?: number
          recipe_variant_id?: string
          timing?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_variant_adjuncts_adjunct_id_fkey"
            columns: ["adjunct_id"]
            isOneToOne: false
            referencedRelation: "adjuncts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_adjuncts_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_adjuncts_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_variant_fruits: {
        Row: {
          amount: number
          created_at: string
          fruit_id: string
          id: string
          position: number
          recipe_variant_id: string
          timing: string | null
          unit: string
        }
        Insert: {
          amount: number
          created_at?: string
          fruit_id: string
          id?: string
          position?: number
          recipe_variant_id: string
          timing?: string | null
          unit: string
        }
        Update: {
          amount?: number
          created_at?: string
          fruit_id?: string
          id?: string
          position?: number
          recipe_variant_id?: string
          timing?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_variant_fruits_fruit_id_fkey"
            columns: ["fruit_id"]
            isOneToOne: false
            referencedRelation: "fruits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_fruits_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_fruits_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_variant_hops: {
        Row: {
          created_at: string
          days: number | null
          hop_id: string
          id: string
          position: number
          recipe_variant_id: string
          timing: string
          weight_oz: number
        }
        Insert: {
          created_at?: string
          days?: number | null
          hop_id: string
          id?: string
          position?: number
          recipe_variant_id: string
          timing?: string
          weight_oz: number
        }
        Update: {
          created_at?: string
          days?: number | null
          hop_id?: string
          id?: string
          position?: number
          recipe_variant_id?: string
          timing?: string
          weight_oz?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_variant_hops_hop_id_fkey"
            columns: ["hop_id"]
            isOneToOne: false
            referencedRelation: "hops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_hops_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_hops_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_variant_spices: {
        Row: {
          amount: number
          boil_time_min: number | null
          created_at: string
          id: string
          position: number
          recipe_variant_id: string
          spice_id: string
          timing: string | null
          unit: string
        }
        Insert: {
          amount: number
          boil_time_min?: number | null
          created_at?: string
          id?: string
          position?: number
          recipe_variant_id: string
          spice_id: string
          timing?: string | null
          unit: string
        }
        Update: {
          amount?: number
          boil_time_min?: number | null
          created_at?: string
          id?: string
          position?: number
          recipe_variant_id?: string
          spice_id?: string
          timing?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_variant_spices_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_spices_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants_with_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variant_spices_spice_id_fkey"
            columns: ["spice_id"]
            isOneToOne: false
            referencedRelation: "spices"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_variants: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          planned_volume_bbl: number | null
          position: number
          recipe_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          planned_volume_bbl?: number | null
          position?: number
          recipe_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          planned_volume_bbl?: number | null
          position?: number
          recipe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_yeasts: {
        Row: {
          created_at: string | null
          fermentation_temp_f: number | null
          id: string
          is_primary: boolean | null
          notes: string | null
          pitch_rate: number | null
          position: number | null
          recipe_id: string
          yeast_id: string
        }
        Insert: {
          created_at?: string | null
          fermentation_temp_f?: number | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          pitch_rate?: number | null
          position?: number | null
          recipe_id: string
          yeast_id: string
        }
        Update: {
          created_at?: string | null
          fermentation_temp_f?: number | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          pitch_rate?: number | null
          position?: number | null
          recipe_id?: string
          yeast_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_yeasts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_yeasts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_yeasts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_yeasts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_yeasts_yeast_id_fkey"
            columns: ["yeast_id"]
            isOneToOne: false
            referencedRelation: "yeasts"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          batch_size_bbl: number | null
          batch_size_gallons: number | null
          boil_time_min: number | null
          brand_id: string | null
          brew_day_notes: string | null
          conditioning_days: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          development_notes: string | null
          fermentation_days: number | null
          fermentation_schedule: Json | null
          id: string
          ingredients: Json | null
          instructions: Json | null
          is_active: boolean | null
          is_template: boolean | null
          mash_efficiency: number | null
          mash_schedule: Json | null
          mash_temp_f: number | null
          mash_water_volume_gal: number | null
          name: string
          notes: string | null
          preboil_volume_bbl: number | null
          pricing_tier_id: string | null
          sparge_water_volume_gal: number | null
          status: string
          style: string | null
          style_id: string | null
          target_abv: number | null
          target_attenuation: number | null
          target_fg: number | null
          target_ibu: number | null
          target_ko_temp_f: number | null
          target_ko_volume_bbl: number | null
          target_mash_ph: number | null
          target_og: number | null
          target_pitching_rate: number | null
          target_srm: number | null
          target_water_profile_id: string | null
          tasting_notes: string | null
          updated_at: string | null
          version: number
          volume_bbl: number | null
          water_profile_id: string | null
          water_to_grain_ratio: number | null
          whirlpool_rest_min: number | null
          whirlpool_temp_f: number | null
          whirlpool_time_min: number | null
          yeast_id: string | null
          yeast_nutrient_amount_g: number | null
        }
        Insert: {
          batch_size_bbl?: number | null
          batch_size_gallons?: number | null
          boil_time_min?: number | null
          brand_id?: string | null
          brew_day_notes?: string | null
          conditioning_days?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          development_notes?: string | null
          fermentation_days?: number | null
          fermentation_schedule?: Json | null
          id?: string
          ingredients?: Json | null
          instructions?: Json | null
          is_active?: boolean | null
          is_template?: boolean | null
          mash_efficiency?: number | null
          mash_schedule?: Json | null
          mash_temp_f?: number | null
          mash_water_volume_gal?: number | null
          name: string
          notes?: string | null
          preboil_volume_bbl?: number | null
          pricing_tier_id?: string | null
          sparge_water_volume_gal?: number | null
          status?: string
          style?: string | null
          style_id?: string | null
          target_abv?: number | null
          target_attenuation?: number | null
          target_fg?: number | null
          target_ibu?: number | null
          target_ko_temp_f?: number | null
          target_ko_volume_bbl?: number | null
          target_mash_ph?: number | null
          target_og?: number | null
          target_pitching_rate?: number | null
          target_srm?: number | null
          target_water_profile_id?: string | null
          tasting_notes?: string | null
          updated_at?: string | null
          version?: number
          volume_bbl?: number | null
          water_profile_id?: string | null
          water_to_grain_ratio?: number | null
          whirlpool_rest_min?: number | null
          whirlpool_temp_f?: number | null
          whirlpool_time_min?: number | null
          yeast_id?: string | null
          yeast_nutrient_amount_g?: number | null
        }
        Update: {
          batch_size_bbl?: number | null
          batch_size_gallons?: number | null
          boil_time_min?: number | null
          brand_id?: string | null
          brew_day_notes?: string | null
          conditioning_days?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          development_notes?: string | null
          fermentation_days?: number | null
          fermentation_schedule?: Json | null
          id?: string
          ingredients?: Json | null
          instructions?: Json | null
          is_active?: boolean | null
          is_template?: boolean | null
          mash_efficiency?: number | null
          mash_schedule?: Json | null
          mash_temp_f?: number | null
          mash_water_volume_gal?: number | null
          name?: string
          notes?: string | null
          preboil_volume_bbl?: number | null
          pricing_tier_id?: string | null
          sparge_water_volume_gal?: number | null
          status?: string
          style?: string | null
          style_id?: string | null
          target_abv?: number | null
          target_attenuation?: number | null
          target_fg?: number | null
          target_ibu?: number | null
          target_ko_temp_f?: number | null
          target_ko_volume_bbl?: number | null
          target_mash_ph?: number | null
          target_og?: number | null
          target_pitching_rate?: number | null
          target_srm?: number | null
          target_water_profile_id?: string | null
          tasting_notes?: string | null
          updated_at?: string | null
          version?: number
          volume_bbl?: number | null
          water_profile_id?: string | null
          water_to_grain_ratio?: number | null
          whirlpool_rest_min?: number | null
          whirlpool_temp_f?: number | null
          whirlpool_time_min?: number | null
          yeast_id?: string | null
          yeast_nutrient_amount_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "recipes_pricing_tier_id_fkey"
            columns: ["pricing_tier_id"]
            isOneToOne: false
            referencedRelation: "pricing_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "beer_styles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_target_water_profile_id_fkey"
            columns: ["target_water_profile_id"]
            isOneToOne: false
            referencedRelation: "water_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_water_profile_id_fkey"
            columns: ["water_profile_id"]
            isOneToOne: false
            referencedRelation: "water_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_yeast_id_fkey"
            columns: ["yeast_id"]
            isOneToOne: false
            referencedRelation: "yeasts"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channels: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          position: number | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          position?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          position?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      selling_formats: {
        Row: {
          container_id: string
          created_at: string
          default_layers: number | null
          id: string
          is_active: boolean
          name: string
          pallet_quantity: number | null
          position: number
          unit_count: number
          units_per_layer: number | null
          updated_at: string
        }
        Insert: {
          container_id: string
          created_at?: string
          default_layers?: number | null
          id?: string
          is_active?: boolean
          name: string
          pallet_quantity?: number | null
          position?: number
          unit_count?: number
          units_per_layer?: number | null
          updated_at?: string
        }
        Update: {
          container_id?: string
          created_at?: string
          default_layers?: number | null
          id?: string
          is_active?: boolean
          name?: string
          pallet_quantity?: number | null
          position?: number
          unit_count?: number
          units_per_layer?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "selling_formats_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
        ]
      }
      session_line_items: {
        Row: {
          actual_quantity: number | null
          batch_id: string | null
          brand_id: string
          created_at: string | null
          id: string
          keg_owner_id: string | null
          planned_quantity: number | null
          selling_format_id: string | null
          session_id: string
          source_batches: Json | null
        }
        Insert: {
          actual_quantity?: number | null
          batch_id?: string | null
          brand_id: string
          created_at?: string | null
          id?: string
          keg_owner_id?: string | null
          planned_quantity?: number | null
          selling_format_id?: string | null
          session_id: string
          source_batches?: Json | null
        }
        Update: {
          actual_quantity?: number | null
          batch_id?: string | null
          brand_id?: string
          created_at?: string | null
          id?: string
          keg_owner_id?: string | null
          planned_quantity?: number | null
          selling_format_id?: string | null
          session_id?: string
          source_batches?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "session_line_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_line_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "session_line_items_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_line_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "session_line_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "session_line_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "session_line_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_line_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_line_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_line_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "packaging_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_line_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "packaging_sessions_with_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_notification_log: {
        Row: {
          action_url: string | null
          channel: string | null
          created_at: string
          error_message: string | null
          id: string
          message: string | null
          metadata: Json | null
          notification_type: string
          priority: string
          sent_at: string | null
          status: string
          title: string
        }
        Insert: {
          action_url?: string | null
          channel?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          notification_type: string
          priority?: string
          sent_at?: string | null
          status?: string
          title: string
        }
        Update: {
          action_url?: string | null
          channel?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          notification_type?: string
          priority?: string
          sent_at?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      slack_settings: {
        Row: {
          app_url: string | null
          channel_overrides: Json
          created_at: string
          default_channel: string | null
          id: string
          internal_secret: string
          is_enabled: boolean
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          app_url?: string | null
          channel_overrides?: Json
          created_at?: string
          default_channel?: string | null
          id?: string
          internal_secret?: string
          is_enabled?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          app_url?: string | null
          channel_overrides?: Json
          created_at?: string
          default_channel?: string | null
          id?: string
          internal_secret?: string
          is_enabled?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      spices: {
        Row: {
          cost_per_unit: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          type: string | null
          typical_amount: number | null
          typical_unit: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          cost_per_unit?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          type?: string | null
          typical_amount?: number | null
          typical_unit?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          cost_per_unit?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          type?: string | null
          typical_amount?: number | null
          typical_unit?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      square_catalog_map: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          last_synced_at: string | null
          object_type: string
          selling_format_id: string | null
          square_catalog_id: string
          square_version: number | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          object_type: string
          selling_format_id?: string | null
          square_catalog_id: string
          square_version?: number | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          object_type?: string
          selling_format_id?: string | null
          square_catalog_id?: string
          square_version?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_catalog_map_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_catalog_map_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "square_catalog_map_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "square_catalog_map_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "square_catalog_map_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "square_catalog_map_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_catalog_map_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_catalog_map_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      square_draft_sales: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          location_id: string
          quantity: number
          selling_format_id: string | null
          sold_at: string
          square_order_id: string
          square_payment_id: string | null
          unit_price_cents: number | null
          volume_oz: number | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          location_id: string
          quantity: number
          selling_format_id?: string | null
          sold_at: string
          square_order_id: string
          square_payment_id?: string | null
          unit_price_cents?: number | null
          volume_oz?: number | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          location_id?: string
          quantity?: number
          selling_format_id?: string | null
          sold_at?: string
          square_order_id?: string
          square_payment_id?: string | null
          unit_price_cents?: number | null
          volume_oz?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "square_draft_sales_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_draft_sales_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "square_draft_sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_draft_sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_draft_sales_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "square_draft_sales_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "square_draft_sales_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "square_draft_sales_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_draft_sales_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_draft_sales_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      square_settings: {
        Row: {
          access_token: string | null
          created_at: string
          id: string
          is_enabled: boolean
          last_catalog_sync_at: string | null
          last_inventory_sync_at: string | null
          updated_at: string
          webhook_signature_key: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          id: string
          is_enabled?: boolean
          last_catalog_sync_at?: string | null
          last_inventory_sync_at?: string | null
          updated_at?: string
          webhook_signature_key?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_catalog_sync_at?: string | null
          last_inventory_sync_at?: string | null
          updated_at?: string
          webhook_signature_key?: string | null
        }
        Relationships: []
      }
      square_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          details: Json | null
          event_id: string | null
          id: string
          items_failed: number
          items_synced: number
          location_id: string | null
          started_at: string
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          details?: Json | null
          event_id?: string | null
          id?: string
          items_failed?: number
          items_synced?: number
          location_id?: string | null
          started_at?: string
          sync_type: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          details?: Json | null
          event_id?: string | null
          id?: string
          items_failed?: number
          items_synced?: number
          location_id?: string | null
          started_at?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_sync_log_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_sync_log_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      sugars: {
        Row: {
          color_lovibond: number | null
          cost_per_lb: number | null
          created_at: string | null
          description: string | null
          fermentability: number | null
          id: string
          is_active: boolean | null
          name: string
          potential_ppg: number | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          color_lovibond?: number | null
          cost_per_lb?: number | null
          created_at?: string | null
          description?: string | null
          fermentability?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          potential_ppg?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          color_lovibond?: number | null
          cost_per_lb?: number | null
          created_at?: string | null
          description?: string | null
          fermentability?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          potential_ppg?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      supplier_catalog: {
        Row: {
          catalog_id: string
          catalog_type: string
          created_at: string | null
          id: string
          is_preferred: boolean | null
          lead_time_days: number | null
          min_order_qty: number | null
          notes: string | null
          price: number | null
          supplier_id: string
          supplier_sku: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          catalog_id: string
          catalog_type: string
          created_at?: string | null
          id?: string
          is_preferred?: boolean | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          price?: number | null
          supplier_id: string
          supplier_sku?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          catalog_id?: string
          catalog_type?: string
          created_at?: string | null
          id?: string
          is_preferred?: boolean | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          price?: number | null
          supplier_id?: string
          supplier_sku?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_catalog_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: Json | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          default_lead_time_days: number | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          payment_terms: string | null
          updated_at: string | null
        }
        Insert: {
          address?: Json | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_lead_time_days?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          payment_terms?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: Json | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_lead_time_days?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          payment_terms?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value?: Json
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      transfer_lines: {
        Row: {
          created_at: string | null
          finished_good_id: string | null
          id: string
          inventory_lot_id: string | null
          quantity: number
          quantity_shipped: number | null
          transfer_id: string
        }
        Insert: {
          created_at?: string | null
          finished_good_id?: string | null
          id?: string
          inventory_lot_id?: string | null
          quantity: number
          quantity_shipped?: number | null
          transfer_id: string
        }
        Update: {
          created_at?: string | null
          finished_good_id?: string | null
          id?: string
          inventory_lot_id?: string | null
          quantity?: number
          quantity_shipped?: number | null
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_lines_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_ttb_class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots_with_quantities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "location_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "location_transfers_with_details"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          anthropic_api_key: string | null
          created_at: string
          date_format: string
          gravity_unit: string
          id: string
          retail_volume_unit: string
          temperature_unit: string
          theme: string
          updated_at: string
          user_id: string
          volume_unit: string
          weight_unit: string
        }
        Insert: {
          anthropic_api_key?: string | null
          created_at?: string
          date_format?: string
          gravity_unit?: string
          id?: string
          retail_volume_unit?: string
          temperature_unit?: string
          theme?: string
          updated_at?: string
          user_id: string
          volume_unit?: string
          weight_unit?: string
        }
        Update: {
          anthropic_api_key?: string | null
          created_at?: string
          date_format?: string
          gravity_unit?: string
          id?: string
          retail_volume_unit?: string
          temperature_unit?: string
          theme?: string
          updated_at?: string
          user_id?: string
          volume_unit?: string
          weight_unit?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          last_active_at: string | null
          roles: string[]
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          invited_at?: string | null
          invited_by?: string | null
          last_active_at?: string | null
          roles?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          last_active_at?: string | null
          roles?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      vessel_cleanings: {
        Row: {
          chemicals_used: Json | null
          cleaned_at: string
          cleaned_by: string | null
          cleaned_by_name: string | null
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
          cleaned_by_name?: string | null
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
          cleaned_by_name?: string | null
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
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
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
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "vessel_transfers_from_vessel_id_fkey"
            columns: ["from_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
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
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "vessel_transfers_to_vessel_id_fkey"
            columns: ["to_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      water_profiles: {
        Row: {
          bicarbonate_ppm: number | null
          calcium_ppm: number | null
          chloride_ppm: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          magnesium_ppm: number | null
          name: string
          ph: number | null
          sodium_ppm: number | null
          sulfate_ppm: number | null
          updated_at: string | null
        }
        Insert: {
          bicarbonate_ppm?: number | null
          calcium_ppm?: number | null
          chloride_ppm?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          magnesium_ppm?: number | null
          name: string
          ph?: number | null
          sodium_ppm?: number | null
          sulfate_ppm?: number | null
          updated_at?: string | null
        }
        Update: {
          bicarbonate_ppm?: number | null
          calcium_ppm?: number | null
          chloride_ppm?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          magnesium_ppm?: number | null
          name?: string
          ph?: number | null
          sodium_ppm?: number | null
          sulfate_ppm?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      yeast_pitch_events: {
        Row: {
          batch_id: string
          cells_pitched_thousand: number | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          pitch_id: string
          pitched_at: string
          quantity_lbs: number
          viability_at_pitch: number | null
        }
        Insert: {
          batch_id: string
          cells_pitched_thousand?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          pitch_id: string
          pitched_at?: string
          quantity_lbs: number
          viability_at_pitch?: number | null
        }
        Update: {
          batch_id?: string
          cells_pitched_thousand?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          pitch_id?: string
          pitched_at?: string
          quantity_lbs?: number
          viability_at_pitch?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches_with_remaining"
            referencedColumns: ["id"]
          },
        ]
      }
      yeast_pitches: {
        Row: {
          cell_count_thousand: number | null
          cell_density_thousand: number | null
          cost: number | null
          cost_per_batch: number | null
          created_at: string | null
          created_by: string | null
          current_viability: number | null
          generation: number
          harvest_date: string | null
          id: string
          initial_viability: number | null
          location_id: string | null
          notes: string | null
          parent_pitch_id: string | null
          quantity_lbs: number | null
          received_date: string | null
          source_type: string
          status: string
          strain_id: string
          updated_at: string | null
          use_by_date: string | null
          vessel_id: string | null
          volume_ml: number | null
        }
        Insert: {
          cell_count_thousand?: number | null
          cell_density_thousand?: number | null
          cost?: number | null
          cost_per_batch?: number | null
          created_at?: string | null
          created_by?: string | null
          current_viability?: number | null
          generation?: number
          harvest_date?: string | null
          id?: string
          initial_viability?: number | null
          location_id?: string | null
          notes?: string | null
          parent_pitch_id?: string | null
          quantity_lbs?: number | null
          received_date?: string | null
          source_type: string
          status?: string
          strain_id: string
          updated_at?: string | null
          use_by_date?: string | null
          vessel_id?: string | null
          volume_ml?: number | null
        }
        Update: {
          cell_count_thousand?: number | null
          cell_density_thousand?: number | null
          cost?: number | null
          cost_per_batch?: number | null
          created_at?: string | null
          created_by?: string | null
          current_viability?: number | null
          generation?: number
          harvest_date?: string | null
          id?: string
          initial_viability?: number | null
          location_id?: string | null
          notes?: string | null
          parent_pitch_id?: string | null
          quantity_lbs?: number | null
          received_date?: string | null
          source_type?: string
          status?: string
          strain_id?: string
          updated_at?: string | null
          use_by_date?: string | null
          vessel_id?: string | null
          volume_ml?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "yeast_pitches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_parent_pitch_id_fkey"
            columns: ["parent_pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_parent_pitch_id_fkey"
            columns: ["parent_pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches_with_remaining"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_strain_id_fkey"
            columns: ["strain_id"]
            isOneToOne: false
            referencedRelation: "yeasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "available_vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["id"]
          },
        ]
      }
      yeasts: {
        Row: {
          alcohol_tolerance: number | null
          attenuation_max: number | null
          attenuation_min: number | null
          attenuation_typical: number | null
          cost_per_unit: number | null
          created_at: string | null
          description: string | null
          flocculation: string | null
          form: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          name: string
          pitching_rate: number | null
          product_code: string | null
          temp_ideal_f: number | null
          temp_max_f: number | null
          temp_min_f: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          alcohol_tolerance?: number | null
          attenuation_max?: number | null
          attenuation_min?: number | null
          attenuation_typical?: number | null
          cost_per_unit?: number | null
          created_at?: string | null
          description?: string | null
          flocculation?: string | null
          form?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          name: string
          pitching_rate?: number | null
          product_code?: string | null
          temp_ideal_f?: number | null
          temp_max_f?: number | null
          temp_min_f?: number | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          alcohol_tolerance?: number | null
          attenuation_max?: number | null
          attenuation_min?: number | null
          attenuation_typical?: number | null
          cost_per_unit?: number | null
          created_at?: string | null
          description?: string | null
          flocculation?: string | null
          form?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          name?: string
          pitching_rate?: number | null
          product_code?: string | null
          temp_ideal_f?: number | null
          temp_max_f?: number | null
          temp_min_f?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_additions_with_costs: {
        Row: {
          addition_type: string | null
          amount: number | null
          batch_id: string | null
          catalog_id: string | null
          catalog_table: string | null
          created_at: string | null
          date_added: string | null
          days: number | null
          estimated_cost: number | null
          id: string | null
          name: string | null
          notes: string | null
          timing: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_additions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      batch_blend_details: {
        Row: {
          blend_batch_id: string | null
          blend_batch_name: string | null
          blend_batch_code: string | null
          blended_at: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          notes: string | null
          source_batch_abv: number | null
          source_batch_id: string | null
          source_batch_name: string | null
          source_batch_code: string | null
          source_batch_status: string | null
          source_batch_volume: number | null
          source_recipe_name: string | null
          volume_bbl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_blend_batch_id_fkey"
            columns: ["blend_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_blends_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      batch_status_counts: {
        Row: {
          count: number | null
          status: string | null
        }
        Relationships: []
      }
      batch_yeast_summary: {
        Row: {
          batch_id: string | null
          cells_pitched_thousand: number | null
          event_id: string | null
          generation: number | null
          notes: string | null
          pitch_id: string | null
          pitched_at: string | null
          quantity_lbs: number | null
          source_type: string | null
          strain_code: string | null
          strain_form: string | null
          strain_id: string | null
          strain_manufacturer: string | null
          strain_name: string | null
          strain_type: string | null
          viability_at_pitch: number | null
        }
        Relationships: [
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitch_events_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches_with_remaining"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_strain_id_fkey"
            columns: ["strain_id"]
            isOneToOne: false
            referencedRelation: "yeasts"
            referencedColumns: ["id"]
          },
        ]
      }
      batches_in_production_by_brand: {
        Row: {
          batch_id: string | null
          batch_name: string | null
          batch_code: string | null
          brand_id: string | null
          conditioning_days: number | null
          estimated_ready_date: string | null
          fermentation_days: number | null
          planned_start_date: string | null
          recipe_id: string | null
          recipe_name: string | null
          status: string | null
          volume_bbl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
        ]
      }
      batches_with_brew_info: {
        Row: {
          actual_abv: number | null
          actual_fg: number | null
          actual_og: number | null
          archive_notes: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          batch_code: string | null
          brew_count: number | null
          brew_date: string | null
          cancellation_notes: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          current_vessel_id: string | null
          current_vessel_name: string | null
          estimated_volume_bbl: number | null
          id: string | null
          name: string | null
          notes: string | null
          planned_start_date: string | null
          recipe_id: string | null
          recipe_variant_id: string | null
          status: string | null
          target_package_date: string | null
          updated_at: string | null
          volume_bbl: number | null
          volume_from_brews_bbl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_variant_id_fkey"
            columns: ["recipe_variant_id"]
            isOneToOne: false
            referencedRelation: "recipe_variants_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      batches_with_remaining_volume: {
        Row: {
          actual_abv: number | null
          actual_fg: number | null
          archive_notes: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          batch_code: string | null
          cancellation_notes: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          id: string | null
          name: string | null
          notes: string | null
          packaged_volume_bbl: number | null
          planned_start_date: string | null
          recipe_id: string | null
          remaining_volume_bbl: number | null
          status: string | null
          total_volume_bbl: number | null
          updated_at: string | null
          volume_bbl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      bin_contents: {
        Row: {
          bin_id: string | null
          item_date: string | null
          item_id: string | null
          item_name: string | null
          item_type: string | null
          lot_number: string | null
          package_name: string | null
          quantity: number | null
        }
        Relationships: []
      }
      bins_with_summary: {
        Row: {
          bin_type: string | null
          capacity: number | null
          created_at: string | null
          fg_item_count: number | null
          id: string | null
          is_active: boolean | null
          location_id: string | null
          location_name: string | null
          location_type: string | null
          name: string | null
          notes: string | null
          rm_item_count: number | null
          total_item_count: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      brew_log_metrics: {
        Row: {
          actual_mash_ph: number | null
          actual_og: number | null
          allocated_volume_bbl: number | null
          batch_count: number | null
          brew_date: string | null
          id: string | null
          phases_completed: Json | null
          pre_boil_gravity: number | null
          recipe_name: string | null
          status: string | null
          volume_to_fermenter_bbl: number | null
        }
        Relationships: []
      }
      brew_logs_with_batches: {
        Row: {
          batch_count: number | null
          batch_codes: string | null
          brew_date: string | null
          brew_number: string | null
          brewer_id: string | null
          created_at: string | null
          events: Json | null
          id: string | null
          legacy_data: Json | null
          notes: string | null
          recipe_id: string | null
          recipe_name: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      customer_keg_balance_summary: {
        Row: {
          customer_id: string | null
          customer_name: string | null
          keg_type_count: number | null
          total_deposit_value: number | null
          total_kegs_out: number | null
        }
        Relationships: []
      }
      customer_keg_balances: {
        Row: {
          customer_id: string | null
          customer_name: string | null
          deposit_amount: number | null
          deposit_value: number | null
          keg_owner_id: string | null
          keg_owner_name: string | null
          keg_type_name: string | null
          kegs_out: number | null
          selling_format_id: string | null
          volume_bbl: number | null
        }
        Relationships: []
      }
      customer_keg_transaction_history: {
        Row: {
          created_at: string | null
          created_by_name: string | null
          customer_id: string | null
          customer_name: string | null
          from_state: Database["public"]["Enums"]["keg_state"] | null
          id: string | null
          keg_owner_id: string | null
          keg_owner_name: string | null
          keg_type_name: string | null
          notes: string | null
          order_id: string | null
          order_number: string | null
          quantity: number | null
          selling_format_id: string | null
          to_state: Database["public"]["Enums"]["keg_state"] | null
          transaction_type:
            | Database["public"]["Enums"]["keg_transaction_type"]
            | null
          volume_bbl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balance_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_revenue_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_with_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_revenue_summary: {
        Row: {
          customer_id: string | null
          customer_name: string | null
          order_count: number | null
          sales_channel: string | null
          total_revenue: number | null
        }
        Relationships: []
      }
      customers_with_order_summary: {
        Row: {
          address: Json | null
          contact_name: string | null
          created_at: string | null
          customer_type: string | null
          email: string | null
          id: string | null
          is_active: boolean | null
          is_tax_exempt: boolean | null
          last_order_date: string | null
          name: string | null
          notes: string | null
          payment_terms_days: number | null
          pending_orders: number | null
          pending_revenue: number | null
          phone: string | null
          price_tier_id: string | null
          price_tier_name: string | null
          sales_channel_id: string | null
          sales_channel_name: string | null
          total_deposit_value: number | null
          total_kegs_out: number | null
          total_orders: number | null
          total_revenue: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_pricing_tier_id_fkey"
            columns: ["price_tier_id"]
            isOneToOne: false
            referencedRelation: "pricing_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_sales_channel_id_fkey"
            columns: ["sales_channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries_with_summary: {
        Row: {
          created_at: string | null
          created_by: string | null
          delivery_number: string | null
          driver_name: string | null
          id: string | null
          notes: string | null
          order_count: number | null
          receive_date: string | null
          scheduled_date: string | null
          ship_date: string | null
          status: string | null
          total_stops: number | null
          transfer_count: number | null
          updated_at: string | null
          updated_by: string | null
          vehicle: string | null
        }
        Relationships: []
      }
      finished_goods_supply_by_product: {
        Row: {
          allocated_quantity: number | null
          available_quantity: number | null
          brand_id: string | null
          reserved_quantity: number | null
          selling_format_id: string | null
          total_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      finished_goods_with_availability: {
        Row: {
          allocated_quantity: number | null
          available_quantity: number | null
          batch_id: string | null
          best_by_date: string | null
          brand_id: string | null
          brand_name: string | null
          container_name: string | null
          container_type: string | null
          created_at: string | null
          created_by: string | null
          expiration_date: string | null
          id: string | null
          lot_number: string | null
          notes: string | null
          production_date: string | null
          quantity: number | null
          reserved_quantity: number | null
          selling_format_id: string | null
          selling_format_name: string | null
          session_line_item_id: string | null
          total_quantity: number | null
          updated_at: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_session_line_item_id_fkey"
            columns: ["session_line_item_id"]
            isOneToOne: false
            referencedRelation: "session_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      finished_goods_with_ttb_class: {
        Row: {
          batch_id: string | null
          best_by_date: string | null
          brand_id: string | null
          brand_name: string | null
          container_type: string | null
          created_at: string | null
          created_by: string | null
          expiration_date: string | null
          id: string | null
          lot_number: string | null
          notes: string | null
          production_date: string | null
          quantity: number | null
          selling_format_id: string | null
          selling_format_name: string | null
          session_line_item_id: string | null
          ttb_tax_class: string | null
          unit_count: number | null
          updated_at: string | null
          version: number | null
          volume_bbl: number | null
          volume_oz: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_session_line_item_id_fkey"
            columns: ["session_line_item_id"]
            isOneToOne: false
            referencedRelation: "session_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lots_with_quantities: {
        Row: {
          allocated_quantity: number | null
          created_at: string | null
          expiration_date: string | null
          id: string | null
          inventory_item_id: string | null
          landed_cost: number | null
          location: string | null
          lot_number: string | null
          notes: string | null
          po_receive_id: string | null
          quantity: number | null
          received_date: string | null
          received_quantity: number | null
          remaining_quantity: number | null
          unit: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_low_stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_po_receive_id_fkey"
            columns: ["po_receive_id"]
            isOneToOne: false
            referencedRelation: "po_receives"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_low_stock_items: {
        Row: {
          category: string | null
          current_qty: number | null
          id: string | null
          name: string | null
          reorder_point: number | null
          unit: string | null
        }
        Relationships: []
      }
      inventory_summary_by_category: {
        Row: {
          category: string | null
          item_count: number | null
          total_value: number | null
        }
        Relationships: []
      }
      keg_aging_report: {
        Row: {
          aging_status: string | null
          customer_id: string | null
          customer_name: string | null
          days_out: number | null
          deposit_amount: number | null
          deposit_at_risk: number | null
          keg_owner_id: string | null
          keg_owner_name: string | null
          keg_type_name: string | null
          kegs_out: number | null
          selling_format_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balance_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_revenue_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_with_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      keg_inventory: {
        Row: {
          batch_id: string | null
          finished_good_id: string | null
          id: string | null
          keg_owner_id: string | null
          location_id: string | null
          quantity: number | null
          selling_format_id: string | null
          state: Database["public"]["Enums"]["keg_state"] | null
        }
        Relationships: []
      }
      keg_inventory_summary: {
        Row: {
          cleaning_count: number | null
          dirty_count: number | null
          empty_count: number | null
          filled_count: number | null
          keg_type_name: string | null
          maintenance_count: number | null
          retired_count: number | null
          selling_format_id: string | null
          shipped_count: number | null
          total_count: number | null
          volume_bbl: number | null
        }
        Relationships: []
      }
      keg_inventory_with_details: {
        Row: {
          batch_id: string | null
          batch_code: string | null
          finished_good_id: string | null
          finished_good_name: string | null
          id: string | null
          keg_owner_code: string | null
          keg_owner_id: string | null
          keg_owner_name: string | null
          keg_type_name: string | null
          location_id: string | null
          location_name: string | null
          quantity: number | null
          selling_format_id: string | null
          state: Database["public"]["Enums"]["keg_state"] | null
          volume_bbl: number | null
        }
        Relationships: []
      }
      keg_transactions_with_details: {
        Row: {
          batch_id: string | null
          batch_code: string | null
          created_at: string | null
          created_by_name: string | null
          customer_id: string | null
          customer_name: string | null
          finished_good_brand: string | null
          finished_good_id: string | null
          finished_good_lot: string | null
          finished_good_name: string | null
          from_location_id: string | null
          from_location_name: string | null
          from_state: Database["public"]["Enums"]["keg_state"] | null
          id: string | null
          keg_owner_code: string | null
          keg_owner_id: string | null
          keg_owner_name: string | null
          keg_type_name: string | null
          location_name: string | null
          notes: string | null
          order_id: string | null
          order_number: string | null
          packaging_session_id: string | null
          quantity: number | null
          selling_format_id: string | null
          to_location_id: string | null
          to_location_name: string | null
          to_state: Database["public"]["Enums"]["keg_state"] | null
          transaction_type:
            | Database["public"]["Enums"]["keg_transaction_type"]
            | null
          volume_bbl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "keg_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balance_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_revenue_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_with_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods_with_ttb_class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_packaging_session_id_fkey"
            columns: ["packaging_session_id"]
            isOneToOne: false
            referencedRelation: "packaging_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_packaging_session_id_fkey"
            columns: ["packaging_session_id"]
            isOneToOne: false
            referencedRelation: "packaging_sessions_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keg_transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      keg_turnover_metrics: {
        Row: {
          annual_turnover_rate: number | null
          avg_cycle_days: number | null
          completed_cycles: number | null
          keg_owner_id: string | null
          keg_owner_name: string | null
          keg_type_name: string | null
          max_cycle_days: number | null
          min_cycle_days: number | null
          selling_format_id: string | null
          volume_bbl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keg_transactions_keg_owner_id_fkey"
            columns: ["keg_owner_id"]
            isOneToOne: false
            referencedRelation: "keg_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      location_transfers_with_details: {
        Row: {
          created_at: string | null
          delivery_id: string | null
          delivery_number: string | null
          from_bin_id: string | null
          from_bin_name: string | null
          from_location_name: string | null
          id: string | null
          lines_count: number | null
          notes: string | null
          receive_date: string | null
          received_by: string | null
          remainder_of: string | null
          ship_date: string | null
          shipped_by: string | null
          status: string | null
          to_bin_id: string | null
          to_bin_name: string | null
          to_location_name: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_transfers_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_from_bin_id_fkey"
            columns: ["from_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_from_bin_id_fkey"
            columns: ["from_bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_remainder_of_fkey"
            columns: ["remainder_of"]
            isOneToOne: false
            referencedRelation: "location_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_remainder_of_fkey"
            columns: ["remainder_of"]
            isOneToOne: false
            referencedRelation: "location_transfers_with_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_to_bin_id_fkey"
            columns: ["to_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_to_bin_id_fkey"
            columns: ["to_bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      locations_with_pos: {
        Row: {
          address: Json | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          is_primary: boolean | null
          location_type: string | null
          name: string | null
          pos_bin_id: string | null
          pos_bin_name: string | null
          pos_bin_type: string | null
          square_location_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_pos_bin_id_fkey"
            columns: ["pos_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_pos_bin_id_fkey"
            columns: ["pos_bin_id"]
            isOneToOne: false
            referencedRelation: "bins_with_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      my_notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          is_read: boolean | null
          message: string | null
          metadata: Json | null
          priority: string | null
          title: string | null
          type: string | null
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          is_read?: never
          message?: string | null
          metadata?: Json | null
          priority?: string | null
          title?: string | null
          type?: string | null
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          is_read?: never
          message?: string | null
          metadata?: Json | null
          priority?: string | null
          title?: string | null
          type?: string | null
        }
        Relationships: []
      }
      my_unread_notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          message: string | null
          metadata: Json | null
          priority: string | null
          title: string | null
          type: string | null
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          message?: string | null
          metadata?: Json | null
          priority?: string | null
          title?: string | null
          type?: string | null
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          message?: string | null
          metadata?: Json | null
          priority?: string | null
          title?: string | null
          type?: string | null
        }
        Relationships: []
      }
      order_demand_by_product: {
        Row: {
          brand_id: string | null
          demand_week: string | null
          earliest_due_date: string | null
          latest_due_date: string | null
          order_count: number | null
          order_ids: string[] | null
          order_statuses: string[] | null
          selling_format_id: string | null
          total_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items_with_details: {
        Row: {
          batch_id: string | null
          brand_abv: number | null
          brand_id: string | null
          brand_name: string | null
          container_name: string | null
          container_type: string | null
          created_at: string | null
          id: string | null
          line_total: number | null
          notes: string | null
          order_id: string | null
          package_id: string | null
          quantity: number | null
          selling_format_id: string | null
          selling_format_name: string | null
          unit_count: number | null
          unit_price: number | null
          volume_oz: number | null
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "order_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
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
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_inventory_summary"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "keg_turnover_metrics"
            referencedColumns: ["selling_format_id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "packaging_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "pricing_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_selling_format_id_fkey"
            columns: ["selling_format_id"]
            isOneToOne: false
            referencedRelation: "selling_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_counts: {
        Row: {
          count: number | null
          status: string | null
        }
        Relationships: []
      }
      order_totals: {
        Row: {
          order_id: string | null
          total_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
            referencedColumns: ["id"]
          },
        ]
      }
      orders_with_totals: {
        Row: {
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          fulfilled_date: string | null
          id: string | null
          line_count: number | null
          notes: string | null
          order_date: string | null
          order_number: string | null
          order_total: number | null
          requested_date: string | null
          scheduled_date: string | null
          shipping_address: Json | null
          status: string | null
          total_units: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balance_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_keg_balances"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_revenue_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_with_order_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_formats: {
        Row: {
          container_active: boolean | null
          container_id: string | null
          container_name: string | null
          container_type: string | null
          deposit_amount: number | null
          id: string | null
          is_active: boolean | null
          name: string | null
          position: number | null
          unit_count: number | null
          volume_bbl: number | null
          volume_oz: number | null
        }
        Relationships: [
          {
            foreignKeyName: "selling_formats_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_sessions_with_summary: {
        Row: {
          brands: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          line_count: number | null
          notes: string | null
          session_date: string | null
          status: string | null
          total_actual: number | null
          total_planned: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      pick_list_details: {
        Row: {
          assigned_to: string | null
          assigned_to_name: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          customer_name: string | null
          generated_at: string | null
          id: string | null
          items_picked: number | null
          notes: string | null
          order_id: string | null
          order_number: string | null
          started_at: string | null
          status: string | null
          total_items: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pick_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_with_totals"
            referencedColumns: ["id"]
          },
        ]
      }
      po_line_items_with_quantities: {
        Row: {
          catalog_id: string | null
          catalog_type: string | null
          created_at: string | null
          id: string | null
          ordered_quantity: number | null
          outstanding_quantity: number | null
          po_id: string | null
          quantity: number | null
          received_quantity: number | null
          unit: string | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "po_line_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_formats: {
        Row: {
          container_type: string | null
          format_source: string | null
          id: string | null
          name: string | null
          sort_group: number | null
        }
        Relationships: []
      }
      product_mix_by_brand: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          total_quantity: number | null
          total_revenue: number | null
        }
        Relationships: []
      }
      qbo_sync_status: {
        Row: {
          entity_id: string | null
          entity_type: string | null
          last_error: string | null
          last_sync_attempted_at: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          qbo_entity_id: string | null
          qbo_entity_type: string | null
        }
        Relationships: []
      }
      recent_revisions: {
        Row: {
          change_reason: string | null
          changed_at: string | null
          changed_by: string | null
          entity_display_name: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          new_status: string | null
          old_status: string | null
          operation: string | null
          revision_number: number | null
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string | null
          changed_by?: string | null
          entity_display_name?: never
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          new_status?: never
          old_status?: never
          operation?: string | null
          revision_number?: number | null
        }
        Update: {
          change_reason?: string | null
          changed_at?: string | null
          changed_by?: string | null
          entity_display_name?: never
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          new_status?: never
          old_status?: never
          operation?: string | null
          revision_number?: number | null
        }
        Relationships: []
      }
      recent_vessel_cleanings: {
        Row: {
          chemicals_used: Json | null
          cleaned_at: string | null
          cleaned_by: string | null
          cleaned_by_name: string | null
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
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "vessel_cleanings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
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
      recipe_ingredients_normalized: {
        Row: {
          catalog_id: string | null
          catalog_name: string | null
          catalog_type: string | null
          quantity: number | null
          recipe_id: string | null
          unit: string | null
        }
        Relationships: []
      }
      recipe_variants_with_costs: {
        Row: {
          created_at: string | null
          description: string | null
          est_cost_per_bbl: number | null
          est_total_cost: number | null
          hot_side_cost_per_bbl: number | null
          id: string | null
          name: string | null
          planned_volume_bbl: number | null
          position: number | null
          recipe_id: string | null
          updated_at: string | null
          variant_addition_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_cogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes_with_cogs: {
        Row: {
          addition_cost: number | null
          adjunct_cost: number | null
          batch_size_bbl: number | null
          brand_id: string | null
          cogs_per_bbl: number | null
          hop_cost: number | null
          id: string | null
          malt_cost: number | null
          name: string | null
          total_cogs: number | null
          total_grain_lbs: number | null
          total_hop_oz: number | null
          volume_bbl: number | null
          yeast_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
        ]
      }
      recipes_with_estimates: {
        Row: {
          batch_count: number | null
          batch_size_bbl: number | null
          batch_size_gallons: number | null
          boil_time_min: number | null
          brand_id: string | null
          brew_day_notes: string | null
          conditioning_days: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          development_notes: string | null
          est_abv: number | null
          est_cogs: number | null
          est_fg: number | null
          est_ibu: number | null
          est_og: number | null
          est_srm: number | null
          fermentation_days: number | null
          fermentation_schedule: Json | null
          id: string | null
          ingredients: Json | null
          instructions: Json | null
          is_active: boolean | null
          is_template: boolean | null
          mash_efficiency: number | null
          mash_schedule: Json | null
          mash_temp_f: number | null
          mash_water_volume_gal: number | null
          name: string | null
          notes: string | null
          preboil_volume_bbl: number | null
          pricing_tier_id: string | null
          sparge_water_volume_gal: number | null
          status: string | null
          style: string | null
          style_id: string | null
          style_name: string | null
          target_abv: number | null
          target_attenuation: number | null
          target_fg: number | null
          target_ibu: number | null
          target_ko_temp_f: number | null
          target_ko_volume_bbl: number | null
          target_mash_ph: number | null
          target_og: number | null
          target_pitching_rate: number | null
          target_srm: number | null
          target_water_profile_id: string | null
          tasting_notes: string | null
          updated_at: string | null
          volume_bbl: number | null
          water_profile_id: string | null
          water_to_grain_ratio: number | null
          whirlpool_rest_min: number | null
          whirlpool_temp_f: number | null
          whirlpool_time_min: number | null
          yeast_id: string | null
          yeast_nutrient_amount_g: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_mix_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "recipes_pricing_tier_id_fkey"
            columns: ["pricing_tier_id"]
            isOneToOne: false
            referencedRelation: "pricing_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "beer_styles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_target_water_profile_id_fkey"
            columns: ["target_water_profile_id"]
            isOneToOne: false
            referencedRelation: "water_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_water_profile_id_fkey"
            columns: ["water_profile_id"]
            isOneToOne: false
            referencedRelation: "water_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_yeast_id_fkey"
            columns: ["yeast_id"]
            isOneToOne: false
            referencedRelation: "yeasts"
            referencedColumns: ["id"]
          },
        ]
      }
      square_settings_safe: {
        Row: {
          created_at: string | null
          id: string | null
          is_enabled: boolean | null
          last_catalog_sync_at: string | null
          last_inventory_sync_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_enabled?: boolean | null
          last_catalog_sync_at?: string | null
          last_inventory_sync_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_enabled?: boolean | null
          last_catalog_sync_at?: string | null
          last_inventory_sync_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ttb_current_month_summary: {
        Row: {
          completed_this_month_bbl: number | null
          completed_this_month_count: number | null
          in_process_batch_count: number | null
          in_process_bbl: number | null
          report_month: number | null
          report_period: string | null
          report_year: number | null
        }
        Relationships: []
      }
      ttb_in_process_beer: {
        Row: {
          batch_id: string | null
          batch_name: string | null
          batch_code: string | null
          entered_status_at: string | null
          status: string | null
          ttb_tax_class: string | null
          updated_at: string | null
          volume_bbl: number | null
        }
        Insert: {
          batch_id?: string | null
          batch_name?: string | null
          batch_code?: string | null
          entered_status_at?: never
          status?: string | null
          ttb_tax_class?: never
          updated_at?: string | null
          volume_bbl?: number | null
        }
        Update: {
          batch_id?: string | null
          batch_name?: string | null
          batch_code?: string | null
          entered_status_at?: never
          status?: string | null
          ttb_tax_class?: never
          updated_at?: string | null
          volume_bbl?: number | null
        }
        Relationships: []
      }
      user_profiles_with_details: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          days_since_active: number | null
          display_name: string | null
          email: string | null
          id: string | null
          invited_at: string | null
          invited_by: string | null
          invited_by_name: string | null
          last_active_at: string | null
          role_display: string | null
          roles: string[] | null
          status: string | null
          status_display: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      vessel_batch_drift_check: {
        Row: {
          expected_batch_id: string | null
          expected_batch_code: string | null
          last_inbound_at: string | null
          last_outbound_at: string | null
          stored_batch_id: string | null
          stored_batch_code: string | null
          vessel_id: string | null
          vessel_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["stored_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["stored_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["stored_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["stored_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["stored_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["stored_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      vessel_transfers_with_details: {
        Row: {
          batch_id: string | null
          batch_code: string | null
          created_at: string | null
          from_vessel_id: string | null
          from_vessel_name: string | null
          id: string | null
          notes: string | null
          to_vessel_id: string | null
          to_vessel_name: string | null
          transferred_at: string | null
          transferred_by: string | null
          volume_bbl: number | null
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessel_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
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
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "vessel_transfers_from_vessel_id_fkey"
            columns: ["from_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
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
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "vessel_transfers_to_vessel_id_fkey"
            columns: ["to_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
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
      vessels_with_batch: {
        Row: {
          batch_id: string | null
          batch_name: string | null
          batch_code: string | null
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
            referencedRelation: "batches_in_production_by_brand"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "batches_with_remaining_volume"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "ttb_in_process_beer"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_current_batch_id_fkey"
            columns: ["current_batch_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      yeast_lineage_summary: {
        Row: {
          batches_used: number | null
          cost_per_batch: number | null
          max_generations: number | null
          original_cost: number | null
          root_id: string | null
          strain_name: string | null
          total_pitches_in_lineage: number | null
        }
        Relationships: []
      }
      yeast_pitches_with_remaining: {
        Row: {
          batches_pitched: number | null
          cell_count_thousand: number | null
          cell_density_thousand: number | null
          cost: number | null
          cost_per_batch: number | null
          created_at: string | null
          created_by: string | null
          current_viability: number | null
          days_old: number | null
          estimated_viability: number | null
          generation: number | null
          harvest_date: string | null
          id: string | null
          initial_viability: number | null
          location_id: string | null
          location_name: string | null
          notes: string | null
          parent_pitch_id: string | null
          quantity_lbs: number | null
          quantity_remaining_lbs: number | null
          received_date: string | null
          source_type: string | null
          status: string | null
          strain_attenuation: number | null
          strain_code: string | null
          strain_form: string | null
          strain_id: string | null
          strain_manufacturer: string | null
          strain_name: string | null
          strain_type: string | null
          updated_at: string | null
          use_by_date: string | null
          vessel_id: string | null
          vessel_name: string | null
          vessel_vessel_type: Database["public"]["Enums"]["vessel_type"] | null
          viability_status: string | null
          volume_ml: number | null
        }
        Relationships: [
          {
            foreignKeyName: "yeast_pitches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations_with_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_parent_pitch_id_fkey"
            columns: ["parent_pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_parent_pitch_id_fkey"
            columns: ["parent_pitch_id"]
            isOneToOne: false
            referencedRelation: "yeast_pitches_with_remaining"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_strain_id_fkey"
            columns: ["strain_id"]
            isOneToOne: false
            referencedRelation: "yeasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "available_vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "batches_with_brew_info"
            referencedColumns: ["current_vessel_id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessel_batch_drift_check"
            referencedColumns: ["vessel_id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yeast_pitches_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      analyze_batch_performance: { Args: { p_batch_id: string }; Returns: Json }
      analyze_recipe_style_compliance: {
        Args: { p_recipe_id: string }
        Returns: Json
      }
      archive_batch: {
        Args: {
          p_batch_id: string
          p_loss_volume_bbl?: number
          p_notes?: string
          p_reason: string
        }
        Returns: Json
      }
      calculate_ingredient_demand: {
        Args: {
          p_horizon_weeks?: number
          p_include_fermenting?: boolean
          p_include_planned?: boolean
        }
        Returns: {
          batch_count: number
          catalog_id: string
          catalog_name: string
          catalog_type: string
          earliest_required_by: string
          total_required: number
          unit: string
        }[]
      }
      calculate_ingredient_shortfalls: {
        Args: { p_horizon_weeks?: number }
        Returns: {
          available_qty: number
          batch_count: number
          catalog_id: string
          catalog_name: string
          catalog_type: string
          is_urgent: boolean
          lead_time_days: number
          min_order_qty: number
          order_by_date: string
          preferred_supplier_id: string
          preferred_supplier_name: string
          required_by_date: string
          shortfall_qty: number
          total_required: number
          unit: string
          unit_price: number
        }[]
      }
      calculate_landed_cost: {
        Args: { p_po_id: string }
        Returns: {
          allocated_shipping: number
          catalog_type: string
          landed_cost_per_unit: number
          line_item_id: string
          lot_id: string
          quantity: number
          unit_price: number
        }[]
      }
      calculate_production_shortfalls: {
        Args: { p_horizon_weeks?: number; p_include_drafts?: boolean }
        Returns: {
          available_quantity: number
          brand_id: string
          brand_name: string
          demand_quantity: number
          demand_week: string
          in_production_bbl: number
          in_production_units: number
          is_urgent: boolean
          lead_time_days: number
          recipe_id: string
          recipe_name: string
          recommended_brew_start: string
          selling_format_id: string
          selling_format_name: string
          shortfall_quantity: number
        }[]
      }
      calculate_units_per_bbl: {
        Args: { p_units_per_case: number; p_volume_oz: number }
        Returns: number
      }
      cancel_batch: {
        Args: {
          p_batch_id: string
          p_loss_volume_bbl?: number
          p_notes?: string
          p_reason: string
        }
        Returns: Json
      }
      check_low_inventory: { Args: never; Returns: number }
      cleanup_old_notifications: {
        Args: { p_days_old?: number }
        Returns: number
      }
      convert_to_lbs: {
        Args: { p_amount: number; p_unit: string }
        Returns: number
      }
      create_finished_goods_from_packaging: {
        Args: { p_session_id: string }
        Returns: number
      }
      create_keg_ship_transactions_from_order: {
        Args: { p_order_id: string }
        Returns: number
      }
      create_notification: {
        Args: {
          p_action_url?: string
          p_entity_id?: string
          p_entity_type?: string
          p_message?: string
          p_metadata?: Json
          p_priority?: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      dismiss_notification: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      dismiss_notifications_bulk: {
        Args: { p_notification_ids: string[] }
        Returns: number
      }
      dispatch_email_notification: {
        Args: {
          p_action_url: string
          p_message: string
          p_metadata: Json
          p_priority: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      generate_lot_number: { Args: { p_date: string }; Returns: string }
      generate_pick_list: { Args: { p_order_id: string }; Returns: string }
      get_ai_schema_context: { Args: { p_domain?: string }; Returns: Json }
      get_enum_default: { Args: { p_enum_type: string }; Returns: string }
      get_enum_label: {
        Args: { p_enum_type: string; p_value: string }
        Returns: string
      }
      get_enum_types: {
        Args: never
        Returns: {
          enum_type: string
          has_colors: boolean
          has_metadata: boolean
          value_count: number
        }[]
      }
      get_enum_values: {
        Args: { p_active_only?: boolean; p_enum_type: string }
        Returns: {
          color: string
          description: string
          icon: string
          label: string
          metadata: Json
          sort_order: number
          value: string
        }[]
      }
      get_inventory_overview: { Args: never; Returns: Json }
      get_inventory_trends: {
        Args: { p_days?: number }
        Returns: {
          date: string
          lots_created: number
          lots_depleted: number
          total_lot_activity: number
        }[]
      }
      get_price_for_customer: {
        Args: {
          p_brand_id?: string
          p_customer_id: string
          p_effective_date?: string
          p_format_id: string
          p_style_id?: string
        }
        Returns: {
          is_brand_specific: boolean
          is_style_specific: boolean
          price: number
          tier_name: string
        }[]
      }
      get_production_trends: {
        Args: { p_days?: number }
        Returns: {
          batches_completed: number
          batches_started: number
          date: string
          volume_bbl: number
        }[]
      }
      get_recipe_summary: { Args: { p_recipe_id: string }; Returns: Json }
      get_roles_for_permission: {
        Args: { p_permission: string }
        Returns: string[]
      }
      get_sales_trends: {
        Args: { p_days?: number }
        Returns: {
          date: string
          fulfilled_count: number
          order_count: number
          revenue: number
        }[]
      }
      get_system_setting: { Args: { setting_key: string }; Returns: Json }
      get_system_setting_text: {
        Args: { setting_key: string }
        Returns: string
      }
      get_ttb_inventory_summary: {
        Args: { p_month: number; p_year: number }
        Returns: {
          beginning_inventory_bbl: number
          ending_inventory_bbl: number
          in_process_beginning_bbl: number
          in_process_ending_bbl: number
          ttb_tax_class: string
        }[]
      }
      get_ttb_production_summary: {
        Args: { p_month: number; p_year: number }
        Returns: {
          beer_packaged_bbl: number
          beer_produced_bbl: number
          finished_goods_count: number
          ttb_tax_class: string
        }[]
      }
      get_ttb_removals_summary: {
        Args: { p_month: number; p_year: number }
        Returns: {
          adjustments_bbl: number
          destroyed_bbl: number
          losses_bbl: number
          tax_free_samples_bbl: number
          taxpaid_domestic_bbl: number
          taxpaid_export_bbl: number
          ttb_tax_class: string
        }[]
      }
      get_ttb_report: {
        Args: { p_month: number; p_year: number }
        Returns: {
          adjustments_bbl: number
          beer_produced_bbl: number
          beer_received_bbl: number
          beginning_inventory_bbl: number
          destroyed_bbl: number
          ending_inventory_bbl: number
          in_process_beginning_bbl: number
          in_process_ending_bbl: number
          losses_bbl: number
          report_month: number
          report_period: string
          report_year: number
          tax_free_samples_bbl: number
          taxpaid_domestic_bbl: number
          taxpaid_export_bbl: number
          total_available_bbl: number
          total_removals_bbl: number
          ttb_tax_class: string
        }[]
      }
      get_ttb_tax_class: { Args: { container_type: string }; Returns: string }
      get_user_role: { Args: { p_user_id?: string }; Returns: string }
      is_admin: { Args: { p_user_id?: string }; Returns: boolean }
      is_admin_rls: { Args: { p_user_id: string }; Returns: boolean }
      is_sensitive_setting: { Args: { setting_key: string }; Returns: boolean }
      is_valid_enum: {
        Args: { p_enum_type: string; p_value: string }
        Returns: boolean
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      mark_notifications_read_bulk: {
        Args: { p_notification_ids: string[] }
        Returns: number
      }
      notify_all_users: {
        Args: {
          p_action_url?: string
          p_entity_id?: string
          p_entity_type?: string
          p_message?: string
          p_metadata?: Json
          p_priority?: string
          p_title: string
          p_type: string
        }
        Returns: number
      }
      record_keg_transaction: {
        Args: {
          p_batch_id?: string
          p_created_by_name?: string
          p_customer_id?: string
          p_finished_good_id?: string
          p_from_location_id?: string
          p_from_state: Database["public"]["Enums"]["keg_state"]
          p_notes?: string
          p_order_id?: string
          p_packaging_session_id?: string
          p_quantity: number
          p_selling_format_id: string
          p_to_location_id?: string
          p_to_state: Database["public"]["Enums"]["keg_state"]
          p_transaction_type: Database["public"]["Enums"]["keg_transaction_type"]
        }
        Returns: string
      }
      ship_transfer_partial: {
        Args: { p_line_quantities: Json; p_transfer_id: string }
        Returns: string
      }
      suggest_recipe_improvements: {
        Args: { p_recipe_id: string }
        Returns: Json
      }
      update_last_active: { Args: never; Returns: undefined }
      user_has_brewery_access: {
        Args: { brewery_id: string }
        Returns: boolean
      }
      user_has_permission: { Args: { p_permission: string }; Returns: boolean }
      user_has_role: { Args: { p_role: string }; Returns: boolean }
      validate_user_roles: { Args: { p_roles: string[] }; Returns: boolean }
    }
    Enums: {
      cleaning_type:
        | "cip"
        | "caustic"
        | "acid"
        | "sanitize"
        | "manual"
        | "rinse"
      keg_state:
        | "empty"
        | "filled"
        | "shipped"
        | "returned_dirty"
        | "cleaning"
        | "maintenance"
        | "retired"
      keg_transaction_type:
        | "fill"
        | "ship"
        | "return"
        | "clean"
        | "receive"
        | "adjust"
        | "retire"
        | "maintain"
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
        | "brink"
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
      keg_state: [
        "empty",
        "filled",
        "shipped",
        "returned_dirty",
        "cleaning",
        "maintenance",
        "retired",
      ],
      keg_transaction_type: [
        "fill",
        "ship",
        "return",
        "clean",
        "receive",
        "adjust",
        "retire",
        "maintain",
      ],
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
        "brink",
      ],
    },
  },
} as const
