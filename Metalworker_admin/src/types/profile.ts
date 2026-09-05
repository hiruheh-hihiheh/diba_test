export type UserRole = "worker" | "admin";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
}