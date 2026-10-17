// src/components/ui/Icon.tsx
//
// A small, dependency-free line-icon set.
//
// The app previously used emoji for every icon, which renders differently on
// each device, carries its own colors and cannot follow the theme. These icons
// are drawn from plain Views on a 24×24 grid with a single configurable stroke
// color, so they are crisp at every Android density, tint with the palette and
// read as one family.
//
// Only shapes that survive the "one color, one stroke weight" constraint are
// used: bars, rings, dots and rotated strokes. No fonts, no SVG, no new
// packages.
import React, { useMemo } from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export type IconName =
  | "home"
  | "grid"
  | "briefcase"
  | "receipt"
  | "folder"
  | "folderPlus"
  | "more"
  | "truck"
  | "box"
  | "building"
  | "layers"
  | "pencil"
  | "tag"
  | "image"
  | "sun"
  | "moon"
  | "logout"
  | "plus"
  | "users"
  | "hammer"
  | "file"
  | "chevronRight"
  | "chevronLeft"
  | "arrowLeft"
  | "arrowRight"
  | "search"
  | "close"
  | "check"
  | "checkCircle"
  | "xCircle"
  | "info"
  | "alert"
  | "filter"
  | "refresh"
  | "trash"
  | "download"
  | "upload"
  | "eye"
  | "eyeOff"
  | "lock"
  | "calendar"
  | "clock"
  | "settings"
  | "list"
  | "menu"
  | "share"
  | "dots";

interface IconProps {
  name: IconName;
  /** Edge length in points. All geometry scales from a 24pt grid. */
  size?: number;
  color: string;
  /** Stroke weight in 24-grid units. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

function renderIcon(name: IconName, u: number, color: string, sw: number) {
  /** A straight stroke. `rotate` is clockwise in degrees around its center. */
  const line = (
    x: number,
    y: number,
    w: number,
    h = sw,
    rotate = 0,
    key?: string | number
  ) => (
    <View
      key={key}
      style={{
        position: "absolute",
        left: x * u,
        top: y * u,
        width: w * u,
        height: Math.max(h * u, StyleSheet.hairlineWidth),
        borderRadius: (h / 2) * u,
        backgroundColor: color,
        transform: rotate ? [{ rotate: `${rotate}deg` }] : undefined,
      }}
    />
  );

  /** An outlined rectangle / ellipse. Radius defaults to a snug pill. */
  const ring = (
    x: number,
    y: number,
    w: number,
    h: number,
    r?: number,
    rotate = 0,
    extra?: ViewStyle,
    key?: string | number
  ) => (
    <View
      key={key}
      style={[
        {
          position: "absolute",
          left: x * u,
          top: y * u,
          width: w * u,
          height: h * u,
          borderRadius: (r ?? Math.min(w, h) / 2) * u,
          borderWidth: sw * u,
          borderColor: color,
          transform: rotate ? [{ rotate: `${rotate}deg` }] : undefined,
        },
        extra,
      ]}
    />
  );

  const dot = (x: number, y: number, d: number, key?: string | number) => (
    <View
      key={key}
      style={{
        position: "absolute",
        left: x * u,
        top: y * u,
        width: d * u,
        height: d * u,
        borderRadius: (d / 2) * u,
        backgroundColor: color,
        borderColor: color,
      }}
    />
  );

  const xMark = (cx: number, cy: number, span: number, stroke = sw) => (
    <>
      {line(cx - span / 2, cy - stroke / 2, span, stroke, 45, "x1")}
      {line(cx - span / 2, cy - stroke / 2, span, stroke, -45, "x2")}
    </>
  );

  const checkMark = (cx: number, cy: number, span: number, stroke = sw) => (
    <>
      {line(cx - span * 0.34, cy + stroke * 0.05, span * 0.42, stroke, 45, "c1")}
      {line(cx - span * 0.08, cy - stroke * 0.06, span * 0.76, stroke, -45, "c2")}
    </>
  );

  switch (name) {
    case "home":
      return (
        <>
          {line(2.1, 6.3, 8.3, sw, -44, "r1")}
          {line(13.6, 6.3, 8.3, sw, 44, "r2")}
          {ring(4.4, 10.2, 15.2, 10.2, 2.4, 0, undefined, "body")}
        </>
      );

    case "grid":
      return (
        <>
          {ring(3, 3, 7.4, 7.4, 2.4, 0, undefined, "g1")}
          {ring(13.6, 3, 7.4, 7.4, 2.4, 0, undefined, "g2")}
          {ring(3, 13.6, 7.4, 7.4, 2.4, 0, undefined, "g3")}
          {ring(13.6, 13.6, 7.4, 7.4, 2.4, 0, undefined, "g4")}
        </>
      );

    case "briefcase":
      return (
        <>
          {ring(8.6, 3.6, 6.8, 6.2, 2, 0, { borderBottomWidth: 0 }, "handle")}
          {ring(3, 7.2, 18, 13, 3, 0, undefined, "body")}
          {line(10, 12.4, 4, 1.7, 0, "clasp")}
        </>
      );

    case "receipt":
      return (
        <>
          {ring(5, 3, 14, 18, 2.4, 0, undefined, "body")}
          {line(8.6, 8, 6.8, 1.6, 0, "l1")}
          {line(8.6, 11.6, 6.8, 1.6, 0, "l2")}
          {line(8.6, 15.2, 4.2, 1.6, 0, "l3")}
        </>
      );

    case "folder":
      return (
        <>
          {line(3.4, 5.2, 7, 3.4, 0, "tab")}
          {ring(3, 6.8, 18, 13.4, 3, 0, undefined, "body")}
        </>
      );

    case "folderPlus":
      return (
        <>
          {line(3.4, 5.2, 7, 3.4, 0, "tab")}
          {ring(3, 6.8, 18, 13.4, 3, 0, undefined, "body")}
          {line(11.1, 10.4, 1.8, 6.4, 0, "p1")}
          {line(8.8, 12.7, 6.4, 1.8, 0, "p2")}
        </>
      );

    case "more":
      return (
        <>
          {dot(4.6, 10.8, 2.4, "d1")}
          {dot(10.8, 10.8, 2.4, "d2")}
          {dot(17, 10.8, 2.4, "d3")}
        </>
      );

    case "dots":
      return (
        <>
          {dot(10.8, 3.6, 2.6, "d1")}
          {dot(10.8, 10.7, 2.6, "d2")}
          {dot(10.8, 17.8, 2.6, "d3")}
        </>
      );

    case "truck":
      return (
        <>
          {ring(2.4, 6.6, 11.8, 9.4, 2, 0, undefined, "cargo")}
          {ring(14.2, 10, 7.4, 6, 2, 0, undefined, "cab")}
          {line(2.4, 15.8, 19.2, 1.7, 0, "chassis")}
          {ring(5.4, 17.4, 4.2, 4.2, 2.1, 0, undefined, "w1")}
          {ring(15.2, 17.4, 4.2, 4.2, 2.1, 0, undefined, "w2")}
        </>
      );

    case "box":
      return (
        <>
          {ring(3.5, 3.8, 17, 16.4, 2.6, 0, undefined, "body")}
          {line(3.5, 9.2, 17, 1.7, 0, "band")}
          {line(11.2, 3.8, 1.7, 5.4, 0, "seam")}
        </>
      );

    case "building":
      return (
        <>
          {ring(4.8, 2.8, 14.4, 18.4, 2, 0, undefined, "body")}
          {dot(7.8, 7, 1.8, "w1")}
          {dot(11.1, 7, 1.8, "w2")}
          {dot(14.4, 7, 1.8, "w3")}
          {dot(7.8, 11, 1.8, "w4")}
          {dot(11.1, 11, 1.8, "w5")}
          {dot(14.4, 11, 1.8, "w6")}
          {line(9.4, 16.4, 5.2, 4.8, 0, "door")}
        </>
      );

    case "layers":
      return (
        <>
          {ring(3, 3.2, 18, 5.8, 2.9, 0, undefined, "l1")}
          {ring(3, 9.1, 18, 5.8, 2.9, 0, undefined, "l2")}
          {ring(3, 15, 18, 5.8, 2.9, 0, undefined, "l3")}
        </>
      );

    case "pencil":
      return (
        <>
          {line(6.6, 10, 11.4, 3.4, -45, "shaft")}
          {dot(5.6, 15.2, 4.2, "nib")}
          {line(16.2, 3, 3.4, 4.6, 45, "ferrule")}
        </>
      );

    case "tag":
      return (
        <>
          {ring(6.6, 6.6, 11.2, 11.2, 2.2, 45, undefined, "diamond")}
          {dot(8.2, 8.2, 2.1, "hole")}
        </>
      );

    case "image":
      return (
        <>
          {ring(3, 4.4, 18, 15.2, 2.6, 0, undefined, "frame")}
          {dot(6.9, 8, 2.2, "sun")}
          {line(5.4, 16.2, 7.2, 1.7, -34, "slope1")}
          {line(12.1, 14.4, 6.8, 1.7, 26, "slope2")}
        </>
      );

    case "sun":
      return (
        <>
          {ring(7, 7, 10, 10, 5, 0, undefined, "core")}
          {line(11.2, 1.8, 1.6, 3, 0, "n")}
          {line(11.2, 19.2, 1.6, 3, 0, "s")}
          {line(1.8, 11.2, 3, 1.6, 0, "w")}
          {line(19.2, 11.2, 3, 1.6, 0, "e")}
          {line(3.1, 3.9, 3, 1.6, 45, "nw")}
          {line(17.9, 3.9, 3, 1.6, -45, "ne")}
          {line(3.1, 18.5, 3, 1.6, -45, "sw")}
          {line(17.9, 18.5, 3, 1.6, 45, "se")}
        </>
      );

    case "moon":
      return (
        <>
          {ring(3.8, 3.8, 16.4, 16.4, 8.2, -32, {
            borderTopColor: "transparent",
            borderRightColor: "transparent",
          }, "crescent")}
          {dot(18.4, 6.4, 1.8, "star")}
        </>
      );

    case "logout":
      return (
        <>
          {line(4, 3.6, 1.8, 16.8, 0, "frame-v")}
          {line(4, 3.6, 8.4, 1.8, 0, "frame-t")}
          {line(4, 18.6, 8.4, 1.8, 0, "frame-b")}
          {line(10.6, 11.1, 9.6, 1.8, 0, "arrow")}
          {line(14.9, 7.5, 4.8, 1.8, 45, "head-t")}
          {line(14.9, 14.2, 4.8, 1.8, -45, "head-b")}
        </>
      );

    case "plus":
      return (
        <>
          {line(11.1, 4.6, 1.8, 14.8, 0, "v")}
          {line(4.6, 11.1, 14.8, 1.8, 0, "h")}
        </>
      );

    case "users":
      return (
        <>
          {ring(8.8, 3.4, 6.6, 6.6, 3.3, 0, undefined, "head")}
          {ring(4.6, 12.6, 15, 9.8, 7.5, 0, undefined, "body")}
          {ring(15.9, 6.2, 4.6, 4.6, 2.3, 0, undefined, "head2")}
        </>
      );

    case "hammer":
      return (
        <>
          {line(4.6, 4.4, 14.8, 4.4, 0, "head")}
          {line(10.6, 8.8, 2.8, 11, 0, "handle")}
        </>
      );

    case "file":
      return (
        <>
          {ring(5, 3, 14, 18, 2.4, 0, undefined, "body")}
          {line(8.4, 8, 7.2, 1.6, 0, "l1")}
          {line(8.4, 11.6, 7.2, 1.6, 0, "l2")}
          {line(8.4, 15.2, 4.6, 1.6, 0, "l3")}
        </>
      );

    case "chevronRight":
      return (
        <>
          {line(8.2, 8.3, 7.4, sw, 45, "u")}
          {line(8.2, 14.1, 7.4, sw, -45, "l")}
        </>
      );

    case "chevronLeft":
      return (
        <>
          {line(8.4, 8.3, 7.4, sw, -45, "u")}
          {line(8.4, 14.1, 7.4, sw, 45, "l")}
        </>
      );

    case "arrowLeft":
      return (
        <>
          {line(5, 11.1, 14.4, 1.8, 0, "shaft")}
          {line(3.9, 7.1, 8.2, 1.8, 45, "head-t")}
          {line(3.9, 14.9, 8.2, 1.8, -45, "head-b")}
        </>
      );

    case "arrowRight":
      return (
        <>
          {line(4.6, 11.1, 14.4, 1.8, 0, "shaft")}
          {line(11.9, 7.1, 8.2, 1.8, -45, "head-t")}
          {line(11.9, 14.9, 8.2, 1.8, 45, "head-b")}
        </>
      );

    case "search":
      return (
        <>
          {ring(3.6, 3.6, 12.4, 12.4, 6.2, 0, undefined, "lens")}
          {line(14.8, 16.2, 6.4, 1.9, 45, "handle")}
        </>
      );

    case "close":
      return xMark(12, 12, 15);

    case "check":
      return checkMark(12, 12, 15, 2.1);

    case "checkCircle":
      return (
        <>
          {ring(3.2, 3.2, 17.6, 17.6, 8.8, 0, undefined, "ring")}
          {checkMark(12, 12, 11, 1.8)}
        </>
      );

    case "xCircle":
      return (
        <>
          {ring(3.2, 3.2, 17.6, 17.6, 8.8, 0, undefined, "ring")}
          {xMark(12, 12, 8.4, 1.7)}
        </>
      );

    case "info":
      return (
        <>
          {ring(3.2, 3.2, 17.6, 17.6, 8.8, 0, undefined, "ring")}
          {dot(11, 7.2, 2, "dot")}
          {line(11.1, 10.8, 1.8, 6, 0, "bar")}
        </>
      );

    case "alert":
      return (
        <>
          {ring(3.4, 3.4, 17.2, 17.2, 8.6, 0, undefined, "ring")}
          {line(11.1, 7.4, 1.8, 6.2, 0, "bar")}
          {dot(11, 15.6, 2, "dot")}
        </>
      );

    case "filter":
      return (
        <>
          {line(4, 5.6, 16, 1.9, 0, "f1")}
          {line(6.4, 11, 11.2, 1.9, 0, "f2")}
          {line(9, 16.4, 6, 1.9, 0, "f3")}
        </>
      );

    case "refresh":
      return (
        <>
          {ring(4.2, 4.2, 15.6, 15.6, 7.8, 0, { borderTopColor: "transparent" }, "arc")}
          {line(14.6, 3.5, 5, 1.9, 0, "head-h")}
          {line(17.7, 3.6, 1.9, 4.8, 0, "head-v")}
        </>
      );

    case "trash":
      return (
        <>
          {line(4, 6.2, 16, 1.9, 0, "lid")}
          {line(9.2, 3.2, 5.6, 1.9, 0, "handle")}
          {ring(6, 8.6, 12, 11.4, 2, 0, { borderTopWidth: 0 }, "bin")}
          {line(9.6, 11.6, 1.4, 5.4, 0, "s1")}
          {line(13, 11.6, 1.4, 5.4, 0, "s2")}
        </>
      );

    case "download":
      return (
        <>
          {line(11.1, 3.4, 1.8, 9.4, 0, "stem")}
          {line(6.2, 11.6, 4.8, 1.9, 45, "h1")}
          {line(13.1, 11.6, 4.8, 1.9, -45, "h2")}
          {line(4.4, 18.6, 15.2, 1.9, 0, "base")}
        </>
      );

    case "upload":
      return (
        <>
          {line(11.1, 3.8, 1.8, 9.4, 0, "stem")}
          {line(6.2, 7.4, 4.8, 1.9, -45, "h1")}
          {line(13.1, 7.4, 4.8, 1.9, 45, "h2")}
          {line(4.4, 18.6, 15.2, 1.9, 0, "base")}
        </>
      );

    case "eye":
      return (
        <>
          {ring(2.6, 6.9, 18.8, 10.4, 5.2, 0, undefined, "eye")}
          {dot(10.3, 10.5, 3.4, "pupil")}
        </>
      );

    case "eyeOff":
      return (
        <>
          {ring(2.6, 6.9, 18.8, 10.4, 5.2, 0, undefined, "eye")}
          {dot(10.3, 10.5, 3.4, "pupil")}
          {line(4.2, 19.2, 15.6, 1.9, -45, "slash")}
        </>
      );

    case "lock":
      return (
        <>
          {ring(5, 10.4, 14, 10.4, 2.6, 0, undefined, "body")}
          {ring(8.4, 3.2, 7.2, 9.6, 3.6, 0, { borderBottomWidth: 0 }, "shackle")}
          {dot(11, 14.4, 2, "keyhole")}
          {line(11.1, 16.2, 1.8, 2.6, 0, "key-dot")}
        </>
      );

    case "calendar":
      return (
        <>
          {ring(3.4, 4.6, 17.2, 15.6, 2.6, 0, undefined, "frame")}
          {line(3.4, 9.2, 17.2, 1.7, 0, "rule")}
          {line(7.6, 2.6, 1.8, 4, 0, "leg1")}
          {line(14.6, 2.6, 1.8, 4, 0, "leg2")}
          {dot(7.8, 12.4, 1.7, "d1")}
          {dot(11.2, 12.4, 1.7, "d2")}
          {dot(14.6, 12.4, 1.7, "d3")}
        </>
      );

    case "clock":
      return (
        <>
          {ring(3.4, 3.4, 17.2, 17.2, 8.6, 0, undefined, "ring")}
          {line(11.1, 7, 1.8, 5.6, 0, "hour")}
          {line(11.1, 11.1, 5, 1.8, 0, "minute")}
        </>
      );

    case "settings":
      return (
        <>
          {line(4, 6.6, 16, 1.8, 0, "l1")}
          {line(4, 12, 16, 1.8, 0, "l2")}
          {line(4, 17.4, 16, 1.8, 0, "l3")}
          {dot(7, 5.1, 4.4, "k1")}
          {dot(13.4, 10.5, 4.4, "k2")}
          {dot(7.8, 15.9, 4.4, "k3")}
        </>
      );

    case "menu":
      return (
        <>
          {line(4, 6.4, 16, 1.9, 0, "m1")}
          {line(4, 11.2, 16, 1.9, 0, "m2")}
          {line(4, 16, 11, 1.9, 0, "m3")}
        </>
      );

    case "list":
      return (
        <>
          {dot(4.4, 5.1, 2, "d1")}
          {dot(4.4, 11, 2, "d2")}
          {dot(4.4, 16.9, 2, "d3")}
          {line(8.6, 5.9, 11, 1.8, 0, "r1")}
          {line(8.6, 11.8, 11, 1.8, 0, "r2")}
          {line(8.6, 17.7, 11, 1.8, 0, "r3")}
        </>
      );

    case "share":
      return (
        <>
          {dot(15.8, 3.4, 4.2, "p1")}
          {dot(4.2, 9.9, 4.2, "p2")}
          {dot(15.8, 16.4, 4.2, "p3")}
          {line(6.3, 10.1, 10.1, 1.7, -26, "e1")}
          {line(6.3, 13.5, 10.1, 1.7, 26, "e2")}
        </>
      );

    default:
      return null;
  }
}

export function Icon({ name, size = 20, color, strokeWidth = 1.8, style }: IconProps) {
  const u = size / 24;
  const geometry = useMemo(
    () => renderIcon(name, u, color, strokeWidth),
    [name, u, color, strokeWidth]
  );

  return (
    <View
      aria-hidden
      pointerEvents="none"
      style={[{ width: size, height: size }, style]}
    >
      {geometry}
    </View>
  );
}
