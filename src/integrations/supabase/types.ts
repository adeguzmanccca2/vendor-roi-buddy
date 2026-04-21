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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      leads: {
        Row: {
          body_style: string | null
          created_at: string
          customer_email: string | null
          customer_first_name: string | null
          customer_full_name: string | null
          customer_last_name: string | null
          customer_phone: string | null
          dedup_hash: string | null
          dol: number | null
          id: string
          last_price: number | null
          lead_date: string | null
          lead_status: string
          lotlinx_vdp: number | null
          manual_override: boolean
          net_new_shoppers: number | null
          normalized_email: string | null
          normalized_phone: string | null
          notes: string | null
          organization_id: string
          pct_sales_opps_since_campaign: number | null
          raw_upload_id: string | null
          source_label: string | null
          total_vdp: number | null
          updated_at: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_of_interest: string | null
          vehicle_trim: string | null
          vehicle_year: number | null
          vendor_id: string | null
          vin: string | null
        }
        Insert: {
          body_style?: string | null
          created_at?: string
          customer_email?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_last_name?: string | null
          customer_phone?: string | null
          dedup_hash?: string | null
          dol?: number | null
          id?: string
          last_price?: number | null
          lead_date?: string | null
          lead_status?: string
          lotlinx_vdp?: number | null
          manual_override?: boolean
          net_new_shoppers?: number | null
          normalized_email?: string | null
          normalized_phone?: string | null
          notes?: string | null
          organization_id: string
          pct_sales_opps_since_campaign?: number | null
          raw_upload_id?: string | null
          source_label?: string | null
          total_vdp?: number | null
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_of_interest?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vendor_id?: string | null
          vin?: string | null
        }
        Update: {
          body_style?: string | null
          created_at?: string
          customer_email?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_last_name?: string | null
          customer_phone?: string | null
          dedup_hash?: string | null
          dol?: number | null
          id?: string
          last_price?: number | null
          lead_date?: string | null
          lead_status?: string
          lotlinx_vdp?: number | null
          manual_override?: boolean
          net_new_shoppers?: number | null
          normalized_email?: string | null
          normalized_phone?: string | null
          notes?: string | null
          organization_id?: string
          pct_sales_opps_since_campaign?: number | null
          raw_upload_id?: string | null
          source_label?: string | null
          total_vdp?: number | null
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_of_interest?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vendor_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          organization_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_inventory_uploads: {
        Row: {
          column_mapping: Json | null
          created_at: string
          filename: string | null
          id: string
          inserted_count: number
          notes: string | null
          organization_id: string
          raw_rows: Json | null
          row_count: number
          updated_count: number
          uploaded_by: string
          vendor_id: string
        }
        Insert: {
          column_mapping?: Json | null
          created_at?: string
          filename?: string | null
          id?: string
          inserted_count?: number
          notes?: string | null
          organization_id: string
          raw_rows?: Json | null
          row_count?: number
          updated_count?: number
          uploaded_by: string
          vendor_id: string
        }
        Update: {
          column_mapping?: Json | null
          created_at?: string
          filename?: string | null
          id?: string
          inserted_count?: number
          notes?: string | null
          organization_id?: string
          raw_rows?: Json | null
          row_count?: number
          updated_count?: number
          uploaded_by?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_inventory_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_inventory_uploads_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_lead_uploads: {
        Row: {
          column_mapping: Json | null
          created_at: string
          duplicate_count: number
          filename: string | null
          id: string
          inserted_count: number
          notes: string | null
          organization_id: string
          raw_rows: Json | null
          row_count: number
          uploaded_by: string
          vendor_id: string | null
        }
        Insert: {
          column_mapping?: Json | null
          created_at?: string
          duplicate_count?: number
          filename?: string | null
          id?: string
          inserted_count?: number
          notes?: string | null
          organization_id: string
          raw_rows?: Json | null
          row_count?: number
          uploaded_by: string
          vendor_id?: string | null
        }
        Update: {
          column_mapping?: Json | null
          created_at?: string
          duplicate_count?: number
          filename?: string | null
          id?: string
          inserted_count?: number
          notes?: string | null
          organization_id?: string
          raw_rows?: Json | null
          row_count?: number
          uploaded_by?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_lead_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_lead_uploads_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_sales_uploads: {
        Row: {
          attributed_count: number
          column_mapping: Json | null
          created_at: string
          duplicate_count: number
          filename: string | null
          id: string
          inserted_count: number
          notes: string | null
          organization_id: string
          raw_rows: Json | null
          row_count: number
          uploaded_by: string
        }
        Insert: {
          attributed_count?: number
          column_mapping?: Json | null
          created_at?: string
          duplicate_count?: number
          filename?: string | null
          id?: string
          inserted_count?: number
          notes?: string | null
          organization_id: string
          raw_rows?: Json | null
          row_count?: number
          uploaded_by: string
        }
        Update: {
          attributed_count?: number
          column_mapping?: Json | null
          created_at?: string
          duplicate_count?: number
          filename?: string | null
          id?: string
          inserted_count?: number
          notes?: string | null
          organization_id?: string
          raw_rows?: Json | null
          row_count?: number
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_sales_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          attribution_confidence: number | null
          attribution_status: string
          back_gross: number | null
          created_at: string
          customer_email: string | null
          customer_first_name: string | null
          customer_full_name: string | null
          customer_last_name: string | null
          customer_phone: string | null
          deal_number: string | null
          dedup_hash: string | null
          front_gross: number | null
          gross_revenue: number | null
          id: string
          lead_id: string | null
          manual_override: boolean
          normalized_email: string | null
          normalized_phone: string | null
          notes: string | null
          organization_id: string
          raw_upload_id: string | null
          sale_date: string | null
          salesperson: string | null
          stock_number: string | null
          total_gross: number | null
          updated_at: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_of_interest: string | null
          vehicle_year: number | null
          vendor_id: string | null
        }
        Insert: {
          attribution_confidence?: number | null
          attribution_status?: string
          back_gross?: number | null
          created_at?: string
          customer_email?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_last_name?: string | null
          customer_phone?: string | null
          deal_number?: string | null
          dedup_hash?: string | null
          front_gross?: number | null
          gross_revenue?: number | null
          id?: string
          lead_id?: string | null
          manual_override?: boolean
          normalized_email?: string | null
          normalized_phone?: string | null
          notes?: string | null
          organization_id: string
          raw_upload_id?: string | null
          sale_date?: string | null
          salesperson?: string | null
          stock_number?: string | null
          total_gross?: number | null
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_of_interest?: string | null
          vehicle_year?: number | null
          vendor_id?: string | null
        }
        Update: {
          attribution_confidence?: number | null
          attribution_status?: string
          back_gross?: number | null
          created_at?: string
          customer_email?: string | null
          customer_first_name?: string | null
          customer_full_name?: string | null
          customer_last_name?: string | null
          customer_phone?: string | null
          deal_number?: string | null
          dedup_hash?: string | null
          front_gross?: number | null
          gross_revenue?: number | null
          id?: string
          lead_id?: string | null
          manual_override?: boolean
          normalized_email?: string | null
          normalized_phone?: string | null
          notes?: string | null
          organization_id?: string
          raw_upload_id?: string | null
          sale_date?: string | null
          salesperson?: string | null
          stock_number?: string | null
          total_gross?: number | null
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_of_interest?: string | null
          vehicle_year?: number | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      source_mapping_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          match_type: string
          notes: string | null
          organization_id: string
          pattern: string
          priority: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          match_type?: string
          notes?: string | null
          organization_id: string
          pattern: string
          priority?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          match_type?: string
          notes?: string | null
          organization_id?: string
          pattern?: string
          priority?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_mapping_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_mapping_rules_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_inventory: {
        Row: {
          created_at: string
          id: string
          listed_at: string | null
          mileage: number | null
          notes: string | null
          organization_id: string
          price: number | null
          raw_upload_id: string | null
          removed_at: string | null
          status: string
          stock_number: string | null
          updated_at: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_trim: string | null
          vehicle_year: number | null
          vendor_id: string
          vin: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          listed_at?: string | null
          mileage?: number | null
          notes?: string | null
          organization_id: string
          price?: number | null
          raw_upload_id?: string | null
          removed_at?: string | null
          status?: string
          stock_number?: string | null
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vendor_id: string
          vin?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          listed_at?: string | null
          mileage?: number | null
          notes?: string | null
          organization_id?: string
          price?: number | null
          raw_upload_id?: string | null
          removed_at?: string | null
          status?: string
          stock_number?: string | null
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vendor_id?: string
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_inventory_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          monthly_cost: number | null
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
          vendor_type: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_cost?: number | null
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          vendor_type?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_cost?: number | null
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          vendor_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_source_mapping_for_org: {
        Args: { _org_id: string }
        Returns: {
          total_unmapped: number
          updated_count: number
        }[]
      }
      attribute_sales_for_org: {
        Args: { _org_id: string }
        Returns: {
          matched: number
          total_unmatched: number
        }[]
      }
      get_user_org: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "client"
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
      app_role: ["admin", "client"],
    },
  },
} as const
