// src/components/folders/DragDropProvider.tsx
// Manages drag-and-drop state, drop zone registry, and renders floating ghost overlay.

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { FolderItemType } from "../../types/folder";

/* ─── Public types ─── */

export interface DragData {
  type: FolderItemType;
  id: string;
  label: string;
  /** Set when dragging an existing folder-item row (used for reorder) */
  folderItemId?: string;
}

interface DropZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragDropContextType {
  // State
  isDragging: boolean;
  dragData: DragData | null;
  activeDropZone: string | null;
  // Shared values for the UI-thread overlay
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  // Drop zone management
  registerDropZone: (id: string, rect: DropZoneRect) => void;
  unregisterDropZone: (id: string) => void;
  // Drag lifecycle (called from DraggableItem)
  startDrag: (data: DragData) => void;
  updateHover: (absX: number, absY: number) => void;
  endDrag: (absX: number, absY: number) => void;
  cancelDrag: () => void;
}

const DragDropContext = createContext<DragDropContextType | null>(null);

export function useDragDrop() {
  const ctx = useContext(DragDropContext);
  if (!ctx) throw new Error("useDragDrop must be used within DragDropProvider");
  return ctx;
}

/* ─── Badge config (shared with FolderContents) ─── */

const getTypeColors = (theme: AppTheme): Record<FolderItemType, string> => ({
  owner_stock: theme.colors.primary,
  company_stock: "#8B5CF6",
  bill_group: theme.colors.warning,
  drawing_group: theme.colors.success,
  job: theme.colors.danger,
});

const TYPE_LABELS: Record<FolderItemType, string> = {
  owner_stock: "Owner",
  company_stock: "Company",
  bill_group: "Bill",
  drawing_group: "Drawing",
  job: "Job",
};

/* ─── Constants ─── */

const GHOST_WIDTH = 200;
const GHOST_HALF_W = GHOST_WIDTH / 2;
const GHOST_HALF_H = 24;

/* ─── Provider ─── */

interface DragDropProviderProps {
  children: React.ReactNode;
  onDrop: (data: DragData, zoneId: string, absX: number, absY: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function DragDropProvider({
  children,
  onDrop,
  onDragStart,
  onDragEnd,
}: DragDropProviderProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  /* ── React state ── */
  const [isDragging, setIsDragging] = useState(false);
  const [dragData, setDragData] = useState<DragData | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);

  /* ── Refs ── */
  const dropZonesRef = useRef<Map<string, DropZoneRect>>(new Map());
  const dragDataRef = useRef<DragData | null>(null);
  const containerRef = useRef<View>(null);

  /* ── Shared values ── */
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragOpacity = useSharedValue(0);
  const dragScale = useSharedValue(0.9);
  const containerOffsetX = useSharedValue(0);
  const containerOffsetY = useSharedValue(0);

  /* ── Container measurement ── */
  const measureContainer = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      containerOffsetX.value = x;
      containerOffsetY.value = y;
    });
  }, [containerOffsetX, containerOffsetY]);

  /* ── Drop zone helpers ── */
  const registerDropZone = useCallback((id: string, rect: DropZoneRect) => {
    dropZonesRef.current.set(id, rect);
  }, []);

  const unregisterDropZone = useCallback((id: string) => {
    dropZonesRef.current.delete(id);
  }, []);

  const findDropZone = useCallback(
    (absX: number, absY: number): string | null => {
      for (const [id, rect] of dropZonesRef.current.entries()) {
        if (
          absX >= rect.x &&
          absX <= rect.x + rect.width &&
          absY >= rect.y &&
          absY <= rect.y + rect.height
        ) {
          return id;
        }
      }
      return null;
    },
    []
  );

  /* ── Drag lifecycle ── */
  const startDrag = useCallback(
    (data: DragData) => {
      dragDataRef.current = data;
      setDragData(data);
      setIsDragging(true);
      dragOpacity.value = withTiming(1, { duration: 150 });
      dragScale.value = withSpring(1.05);
      onDragStart?.();
    },
    [dragOpacity, dragScale, onDragStart]
  );

  const updateHover = useCallback(
    (absX: number, absY: number) => {
      const zone = findDropZone(absX, absY);
      setActiveDropZone((prev) => (prev === zone ? prev : zone));
    },
    [findDropZone]
  );

  const endDrag = useCallback(
    (absX: number, absY: number) => {
      const zone = findDropZone(absX, absY);
      const data = dragDataRef.current;
      if (zone && data) {
        onDrop(data, zone, absX, absY);
      }
      dragDataRef.current = null;
      setIsDragging(false);
      setDragData(null);
      setActiveDropZone(null);
      dragOpacity.value = withTiming(0, { duration: 120 });
      dragScale.value = 0.9;
      onDragEnd?.();
    },
    [findDropZone, onDrop, dragOpacity, dragScale, onDragEnd]
  );

  const cancelDrag = useCallback(() => {
    dragDataRef.current = null;
    setIsDragging(false);
    setDragData(null);
    setActiveDropZone(null);
    dragOpacity.value = withTiming(0, { duration: 120 });
    dragScale.value = 0.9;
    onDragEnd?.();
  }, [dragOpacity, dragScale, onDragEnd]);

  /* ── Animated overlay style ── */
  const overlayStyle = useAnimatedStyle(() => ({
    left: dragX.value - containerOffsetX.value - GHOST_HALF_W,
    top: dragY.value - containerOffsetY.value - GHOST_HALF_H,
    opacity: dragOpacity.value,
    transform: [{ scale: dragScale.value }],
  }));

  /* ── Context value ── */
  const contextValue: DragDropContextType = {
    isDragging,
    dragData,
    activeDropZone,
    dragX,
    dragY,
    registerDropZone,
    unregisterDropZone,
    startDrag,
    updateHover,
    endDrag,
    cancelDrag,
  };

  return (
    <DragDropContext.Provider value={contextValue}>
      <View
        ref={containerRef}
        style={styles.container}
        onLayout={measureContainer}
        collapsable={false}
      >
        {children}

        {/* ── Floating ghost overlay ── */}
        <Animated.View
          style={[styles.overlayAnchor, overlayStyle]}
          pointerEvents="none"
        >
          {dragData && (
            <View style={styles.ghost}>
              <View
                style={[
                  styles.ghostBadge,
                  { backgroundColor: getTypeColors(theme)[dragData.type] + "30" },
                ]}
              >
                <Text
                  style={[
                    styles.ghostBadgeText,
                    { color: getTypeColors(theme)[dragData.type] },
                  ]}
                >
                  {TYPE_LABELS[dragData.type]}
                </Text>
              </View>
              <Text style={styles.ghostLabel} numberOfLines={1}>
                {dragData.label}
              </Text>
            </View>
          )}
        </Animated.View>
      </View>
    </DragDropContext.Provider>
  );
}

/* ─── Styles ─── */

const createStyles = (theme: AppTheme) => StyleSheet.create({
  container: {
    flex: 1,
    overflow: "visible" as any,
  },
  overlayAnchor: {
    position: "absolute",
    width: GHOST_WIDTH,
    zIndex: 9999,
  },
  ghost: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 14,
  },
  ghostBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ghostBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  ghostLabel: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
});
