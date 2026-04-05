// ---------------------------------------------------------------------------
// Lot Editor — Data types
// ---------------------------------------------------------------------------

export type SpotType = "BOBTAIL" | "TRUCK_TRAILER";

export type EditorSpot = {
  id: string;
  label: string;
  type: SpotType;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
};

export type SpotGroup = {
  id: string;
  name: string;
  type: SpotType;
  spotIds: string[];
  spacing: number; // distance between consecutive spot centers
  angle: number;   // rotation angle of spots in the group
};

export type EditorTool = "select" | "create-group";

export type EditorState = {
  spots: Record<string, EditorSpot>;
  groups: SpotGroup[];
  selectedGroupIds: string[];
  selectedSpotId: string | null;
  tool: EditorTool;
  overlaps: Set<string>; // spot IDs with collision
  errorFlash: string | null; // brief error message to display
  nextTruckNum: number;
  nextBobtailNum: number;
  nextGroupNum: number;
  undoStack: Array<{
    spots: Record<string, EditorSpot>;
    groups: SpotGroup[];
    nextTruckNum: number;
    nextBobtailNum: number;
    nextGroupNum: number;
  }>;
};

export type EditorAction =
  | { type: "SELECT_GROUP"; groupId: string; additive?: boolean }
  | { type: "SELECT_GROUPS"; groupIds: string[] }
  | { type: "SELECT_SPOT"; spotId: string }
  | { type: "DESELECT_ALL" }
  | { type: "SET_TOOL"; tool: EditorTool }
  | { type: "MOVE_GROUPS"; groupIds: string[]; dx: number; dy: number }
  | { type: "ADD_SPOT"; groupId: string; position: "start" | "end" }
  | { type: "REMOVE_SPOT"; spotId: string }
  | { type: "CREATE_GROUP"; spotType: SpotType; cx: number; cy: number; angle: number }
  | { type: "DELETE_GROUP"; groupId: string }
  | { type: "RENAME_GROUP"; groupId: string; name: string }
  | { type: "ROTATE_GROUP"; groupId: string; angle: number }
  | { type: "CLEAR_ERROR" }
  | { type: "UNDO" }
  | { type: "LOAD_STATE"; state: Pick<EditorState, "spots" | "groups" | "nextTruckNum" | "nextBobtailNum" | "nextGroupNum"> };
