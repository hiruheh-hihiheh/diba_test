// src/pages/GroupBills.tsx
// Bill groups. Implementation lives in PhotoGroupsPage, shared with drawing
// groups; only the service functions, icon and wording differ.

import { FileText } from "lucide-react";
import PhotoGroupsPage, {
  type PhotoGroupsConfig,
  type PhotoGroup,
  type GroupPhoto,
} from "./PhotoGroupsPage";
import {
  fetchBillGroups,
  createBillGroup,
  updateBillGroup,
  deleteBillGroup,
  fetchBillGroupPhotos,
  addBillGroupPhoto,
  removeBillGroupPhoto,
} from "../services/billGroups";
import type { BillGroup, BillGroupPhoto } from "../types/billGroup";

const config: PhotoGroupsConfig = {
  heading: "Group Bills",
  recordLabel: "Bill Group",
  itemNoun: "bill",
  addLabel: "Add Group",
  icon: <FileText size={20} />,
  accent: "warning",
  purpose:
    "Group bills by batch or date, then upload the scans. Create a group first, then open it to add its bills.",
};

export default function GroupBillsPage() {
  return (
    <PhotoGroupsPage<BillGroup, BillGroupPhoto>
      config={config}
      api={{
        list: fetchBillGroups,
        create: (input) => createBillGroup(input),
        update: (id, input) => updateBillGroup(id, input),
        remove: deleteBillGroup,
        listPhotos: fetchBillGroupPhotos,
        addPhoto: addBillGroupPhoto,
        removePhoto: removeBillGroupPhoto,
      }}
    />
  );
}

export type { PhotoGroup, GroupPhoto };
