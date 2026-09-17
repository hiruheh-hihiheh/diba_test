// src/components/folders/DraggableItem.tsx
// Wraps any child to make it draggable via long-press + pan.

import React, { useCallback } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useDragDrop, type DragData } from "./DragDropProvider";

interface DraggableItemProps {
  data: DragData;
  children: React.ReactNode;
  disabled?: boolean;
}

export function DraggableItem({
  data,
  children,
  disabled = false,
}: DraggableItemProps) {
  const { dragX, dragY, startDrag, updateHover, endDrag, cancelDrag } =
    useDragDrop();

  const isActive = useSharedValue(false);
  const itemOpacity = useSharedValue(1);

  /* ── JS-thread callbacks (called via runOnJS) ── */

  const handleStart = useCallback(() => {
    startDrag(data);
  }, [data, startDrag]);

  const handleUpdate = useCallback(
    (absX: number, absY: number) => {
      updateHover(absX, absY);
    },
    [updateHover]
  );

  const handleEnd = useCallback(
    (absX: number, absY: number) => {
      endDrag(absX, absY);
    },
    [endDrag]
  );

  const handleCancel = useCallback(() => {
    cancelDrag();
  }, [cancelDrag]);

  /* ── Gesture ── */

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .enabled(!disabled)
    .onStart((e) => {
      "worklet";
      isActive.value = true;
      itemOpacity.value = withTiming(0.3, { duration: 150 });
      dragX.value = e.absoluteX;
      dragY.value = e.absoluteY;
      runOnJS(handleStart)();
    })
    .onUpdate((e) => {
      "worklet";
      dragX.value = e.absoluteX;
      dragY.value = e.absoluteY;
      runOnJS(handleUpdate)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      "worklet";
      isActive.value = false;
      itemOpacity.value = withTiming(1, { duration: 200 });
      runOnJS(handleEnd)(e.absoluteX, e.absoluteY);
    })
    .onFinalize(() => {
      "worklet";
      if (isActive.value) {
        isActive.value = false;
        itemOpacity.value = withTiming(1, { duration: 200 });
        runOnJS(handleCancel)();
      }
    });

  /* ── Animated style (dims original while dragging) ── */

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: itemOpacity.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}
