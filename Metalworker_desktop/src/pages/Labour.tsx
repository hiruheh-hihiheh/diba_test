// src/pages/Labour.tsx
// Labour user management. The implementation now lives in UsersPage, shared
// with Processor users, because the two pages were identical apart from the
// username rule and a few labels.

import UsersPage from "./UsersPage";
import { Users } from "lucide-react";

export default function Labour() {
  return (
    <UsersPage
      role="worker"
      noun="labour user"
      addLabel="Add Labour"
      accent="purple"
      icon={<Users size={24} />}
    />
  );
}
