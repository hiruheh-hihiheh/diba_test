// src/components/folders/FolderDropTarget.tsx
// Registers a view as a valid drop zone and highlights when a dragged item hovers.

import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useDragDrop } from "./DragDropProvider";
import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface FolderDropTargetProps {
  zoneId: string;
  children: React.ReactNode;
}

export function FolderDropTarget({ zoneId, children }: FolderDropTargetProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const { registerDropZone, unregisterDropZone, activeDropZone, isDragging } =
    useDragDrop();
  const viewRef = useRef<View>(null);

  const isHovered = activeDropZone === zoneId && isDragging;

  /* ── Measure and register this view's screen-relative bounds ── */
  const measureAndRegister = useCallback(() => {
    if (viewRef.current) {
      viewRef.current.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) {
          registerDropZone(zoneId, { x, y, width, height });
        }
      });
    }
  }, [zoneId, registerDropZone]);

  /* Re-measure whenever dragging starts (positions may have changed due to scroll) */
  useEffect(() => {
    if (isDragging) {
      const timer = setTimeout(measureAndRegister, 30);
      return () => clearTimeout(timer);
    }
  }, [isDragging, measureAndRegister]);

  /* Cleanup on unmount */
  useEffect(() => {
    return () => unregisterDropZone(zoneId);
  }, [zoneId, unregisterDropZone]);

  return (
    <View
      ref={viewRef}
      onLayout={measureAndRegister}
      collapsable={false}
    >
      {children}

      {/* Hover overlay */}
      {isHovered && (
        <View style={styles.hoverOverlay}>
          <Text style={styles.hoverText}>⬇ Drop Here</Text>
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  hoverOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.primary + "18",
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  hoverText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: "700",
    backgroundColor: theme.colors.surface + "DD",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: "hidden",
  },
});
