export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      incident_types: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
      }
      incident_actions: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
      }
      responded_by: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
      }
      facilities: {
        Row: {
          id: string
          name: string
          provider: string
          type: string
          address: string
          suburb: string
          state: string
          postcode: string
          phone: string
          star_rating: number
          quality_measures: Json
          services: string[]
          total_beds: number
          available_beds: number
          daily_price: Json
          refundable_deposit: Json
          description: string
          last_audit_date: string
          compliance_status: string
          latitude: number
          longitude: number
          funding: number
          created_at?: string
          updated_at?: string
        }
        Insert: {
          id?: string
          name: string
          provider: string
          type: string
          address: string
          suburb: string
          state: string
          postcode: string
          phone: string
          star_rating: number
          quality_measures?: Json
          services?: string[]
          total_beds: number
          available_beds: number
          daily_price?: Json
          refundable_deposit?: Json
          description: string
          last_audit_date: string
          compliance_status: string
          latitude: number
          longitude: number
          funding?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          // ... other fields
        }
      }
      incidents: {
        Row: {
          id: string
          reference_no: string
          date_received: string
          time: string
          /** Gmail/import received clock (HH:mm); source of truth for Date Received time in the UI */
          email_received_time?: string | null
          type_id: string | null
          driver_id: string | null
          team_leader_id: string | null
          response: string
          reference_text: string
          action_id: string | null
          status: string
          email_sender?: string | null
          email_subject?: string | null
          location_street?: string
          location_suburb?: string
          sender?: string
          marked?: string
          source?: string
          date_response?: string | null
          time_response?: string | null
          user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Insert: {
          id?: string
          reference_no: string
          date_received: string
          time: string
          email_received_time?: string | null
          type_id?: string | null
          driver_id?: string | null
          team_leader_id?: string | null
          response: string
          reference_text: string
          action_id?: string | null
          status?: string
          email_sender?: string | null
          email_subject?: string | null
          location_street?: string
          location_suburb?: string
          sender?: string
          marked?: string
          source?: string
          date_response?: string | null
          time_response?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string
          reference_no?: string
          date_received?: string
          time?: string
          email_received_time?: string | null
          type_id?: string | null
          driver_id?: string | null
          team_leader_id?: string | null
          response?: string
          reference_text?: string
          action_id?: string | null
          status?: string
          email_sender?: string | null
          email_subject?: string | null
          location_street?: string
          location_suburb?: string
          sender?: string
          marked?: string
          date_response?: string | null
          time_response?: string | null
          updated_at?: string
        }
      }
    }
  }
}
