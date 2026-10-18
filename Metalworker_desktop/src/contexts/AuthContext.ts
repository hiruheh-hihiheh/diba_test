import { createContext } from "react";
import type { AuthContextType } from "../hooks/AuthProvider";

export const AuthContext = createContext<AuthContextType | null>(null);
