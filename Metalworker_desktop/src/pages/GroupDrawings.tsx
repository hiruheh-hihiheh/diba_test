// src/pages/GroupDrawings.tsx
// Drawing groups. Implementation lives in PhotoGroupsPage, shared with bill
// groups; only the service functions, icon and wording differ.

import { PenTool } from "lucide-react";
import PhotoGroupsPage, { type PhotoGroupsConfig } from "./PhotoGroupsPage";
import {
  fetchDrawingGroups,
  createDrawingGroup,
  updateDrawingGroup,
  deleteDrawingGroup,
  fetchDrawingGroupPhotos,
  addDrawingGroupPhoto,
  removeDrawingGroupPhoto,
} from "../services/drawingGroups";
import type { DrawingGroup, DrawingGroupPhoto } from "../types/drawingGroup";

const config: PhotoGroupsConfig = {
  heading: "Group Drawings",
  recordLabel: "Drawing Group",
  itemNoun: "drawing",
  addLabel: "Add Group",
  icon: <PenTool size={20} />,
  accent: "success",
  purpose:
    "Group drawings by batch or date, then upload the scans. Create a group first, then open it to add its drawings.",
};

export default function GroupDrawingsPage() {
  return (
    <PhotoGroupsPage<DrawingGroup, DrawingGroupPhoto>
      config={config}
      api={{
        list: fetchDrawingGroups,
        create: (input) => createDrawingGroup(input),
        update: (id, input) => updateDrawingGroup(id, input),
        remove: deleteDrawingGroup,
        listPhotos: fetchDrawingGroupPhotos,
        addPhoto: addDrawingGroupPhoto,
        removePhoto: removeDrawingGroupPhoto,
      }}
    />
  );
}
