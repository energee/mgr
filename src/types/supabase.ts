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
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
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
          volume_bbl: number | null
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
          volume_bbl?: number | null
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
          volume_bbl?: number | null
        }
        Relationships: [
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
            referencedRelation: "recipes_with_estimates"
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
        }
        Insert: {
          bin_id: string
          created_at?: string | null
          finished_good_id: string
          id?: string
          quantity?: number
          updated_at?: string | null
        }
        Update: {
          bin_id?: string
          created_at?: string | null
          finished_good_id?: string
          id?: string
          quantity?: number
          updated_at?: string | null
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
          {
            foreignKeyName: "brew_logs_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
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
          package_type_id: string
          production_date: string | null
          quantity: number
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
          package_type_id: string
          production_date?: string | null
          quantity: number
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
          package_type_id?: string
          production_date?: string | null
          quantity?: number
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
            foreignKeyName: "finished_goods_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
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
            foreignKeyName: "inventory_lots_po_receive_id_fkey"
            columns: ["po_receive_id"]
            isOneToOne: false
            referencedRelation: "po_receives"
            referencedColumns: ["id"]
          },
        ]
      }
      location_transfers: {
        Row: {
          created_at: string | null
          from_bin_id: string
          id: string
          notes: string | null
          receive_date: string | null
          received_by: string | null
          ship_date: string | null
          shipped_by: string | null
          status: string
          to_bin_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          from_bin_id: string
          id?: string
          notes?: string | null
          receive_date?: string | null
          received_by?: string | null
          ship_date?: string | null
          shipped_by?: string | null
          status?: string
          to_bin_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          from_bin_id?: string
          id?: string
          notes?: string | null
          receive_date?: string | null
          received_by?: string | null
          ship_date?: string | null
          shipped_by?: string | null
          status?: string
          to_bin_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_transfers_from_bin_id_fkey"
            columns: ["from_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_transfers_to_bin_id_fkey"
            columns: ["to_bin_id"]
            isOneToOne: false
            referencedRelation: "bins"
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
      order_items: {
        Row: {
          batch_id: string | null
          brand_id: string | null
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
          brand_id?: string | null
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
          brand_id?: string | null
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
          inner_pack_size: number | null
          inner_packs_per_case: number | null
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
          inner_pack_size?: number | null
          inner_packs_per_case?: number | null
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
          inner_pack_size?: number | null
          inner_packs_per_case?: number | null
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
            referencedRelation: "vessels_with_batch"
            referencedColumns: ["batch_id"]
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
      packaging_sessions: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          session_date: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          session_date?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
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
      recipe_additions: {
        Row: {
          additive_id: string
          amount: number
          created_at: string | null
          id: string
          is_default: boolean | null
          position: number | null
          recipe_id: string | null
          target: string | null
          timing: string
          unit: string
        }
        Insert: {
          additive_id: string
          amount: number
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          position?: number | null
          recipe_id?: string | null
          target?: string | null
          timing: string
          unit: string
        }
        Update: {
          additive_id?: string
          amount?: number
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          position?: number | null
          recipe_id?: string | null
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
            referencedRelation: "recipes"
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
          mash_efficiency: number | null
          mash_schedule: Json | null
          mash_temp_f: number | null
          mash_water_volume_gal: number | null
          name: string
          notes: string | null
          preboil_volume_bbl: number | null
          sparge_water_volume_gal: number | null
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
          tasting_notes: string | null
          updated_at: string | null
          use_default_additions: boolean | null
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
          mash_efficiency?: number | null
          mash_schedule?: Json | null
          mash_temp_f?: number | null
          mash_water_volume_gal?: number | null
          name: string
          notes?: string | null
          preboil_volume_bbl?: number | null
          sparge_water_volume_gal?: number | null
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
          tasting_notes?: string | null
          updated_at?: string | null
          use_default_additions?: boolean | null
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
          mash_efficiency?: number | null
          mash_schedule?: Json | null
          mash_temp_f?: number | null
          mash_water_volume_gal?: number | null
          name?: string
          notes?: string | null
          preboil_volume_bbl?: number | null
          sparge_water_volume_gal?: number | null
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
          tasting_notes?: string | null
          updated_at?: string | null
          use_default_additions?: boolean | null
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
            foreignKeyName: "recipes_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "beer_styles"
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
      session_line_items: {
        Row: {
          actual_quantity: number | null
          brand_id: string
          created_at: string | null
          id: string
          package_type_id: string
          planned_quantity: number | null
          session_id: string
          source_batches: Json | null
        }
        Insert: {
          actual_quantity?: number | null
          brand_id: string
          created_at?: string | null
          id?: string
          package_type_id: string
          planned_quantity?: number | null
          session_id: string
          source_batches?: Json | null
        }
        Update: {
          actual_quantity?: number | null
          brand_id?: string
          created_at?: string | null
          id?: string
          package_type_id?: string
          planned_quantity?: number | null
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
            foreignKeyName: "session_line_items_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_line_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "packaging_sessions"
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
      transfer_lines: {
        Row: {
          created_at: string | null
          finished_good_id: string
          id: string
          quantity: number
          transfer_id: string
        }
        Insert: {
          created_at?: string | null
          finished_good_id: string
          id?: string
          quantity: number
          transfer_id: string
        }
        Update: {
          created_at?: string | null
          finished_good_id?: string
          id?: string
          quantity?: number
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
            foreignKeyName: "transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "location_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
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
      yeasts: {
        Row: {
          alcohol_tolerance: number | null
          attenuation_max: number | null
          attenuation_min: number | null
          attenuation_typical: number | null
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
          volume_bbl: number | null
          volume_from_brews_bbl: number | null
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
          volume_bbl?: number | null
          volume_from_brews_bbl?: never
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
          volume_bbl?: number | null
          volume_from_brews_bbl?: never
        }
        Relationships: [
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
            referencedRelation: "recipes_with_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      batches_with_remaining_volume: {
        Row: {
          actual_abv: number | null
          actual_fg: number | null
          batch_number: string | null
          created_at: string | null
          fermenter: string | null
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
            referencedRelation: "recipes"
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
      brew_log_metrics: {
        Row: {
          batch_count: number | null
          brew_date: string | null
          id: string | null
          phases_completed: Json | null
          recipe_id: string | null
          recipe_name: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brew_logs_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brew_logs_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes_with_estimates"
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
          created_at: string | null
          created_by: string | null
          expiration_date: string | null
          id: string | null
          lot_number: string | null
          notes: string | null
          package_type_id: string | null
          production_date: string | null
          quantity: number | null
          reserved_quantity: number | null
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
            foreignKeyName: "finished_goods_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
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
            foreignKeyName: "inventory_lots_po_receive_id_fkey"
            columns: ["po_receive_id"]
            isOneToOne: false
            referencedRelation: "po_receives"
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
          container_type: string | null
          created_at: string | null
          id: string | null
          line_total: number | null
          notes: string | null
          order_id: string | null
          package_id: string | null
          package_type_id: string | null
          package_type_name: string | null
          quantity: number | null
          unit_price: number | null
          units_per_case: number | null
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
            foreignKeyName: "order_items_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
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
            referencedRelation: "customers"
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
      recipes_with_estimates: {
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
          mash_efficiency: number | null
          mash_schedule: Json | null
          mash_temp_f: number | null
          mash_water_volume_gal: number | null
          name: string | null
          notes: string | null
          preboil_volume_bbl: number | null
          sparge_water_volume_gal: number | null
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
          tasting_notes: string | null
          updated_at: string | null
          use_default_additions: boolean | null
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
            foreignKeyName: "recipes_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "beer_styles"
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
      vessels_with_batch: {
        Row: {
          batch_id: string | null
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
        ]
      }
    }
    Functions: {
      analyze_batch_performance: { Args: { p_batch_id: string }; Returns: Json }
      analyze_recipe_style_compliance: {
        Args: { p_recipe_id: string }
        Returns: Json
      }
      get_ai_schema_context: { Args: { p_domain?: string }; Returns: Json }
      get_inventory_overview: { Args: never; Returns: Json }
      get_recipe_summary: { Args: { p_recipe_id: string }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      suggest_recipe_improvements: {
        Args: { p_recipe_id: string }
        Returns: Json
      }
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
