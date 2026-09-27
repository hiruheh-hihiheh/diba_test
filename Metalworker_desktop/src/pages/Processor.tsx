// src/pages/Processor.tsx
// Processor user management. The implementation now lives in UsersPage, shared
// with Labour users, because the two pages were identical apart from the
// username rule and a few labels.

import UsersPage from "./UsersPage";
import { UserCog } from "lucide-react";

export default function Processor() {
  return (
    <UsersPage
      role="processor"
      noun="processor user"
      addLabel="Add Processor"
      accent="primary"
      icon={<UserCog size={24} />}
    />
  );
}
