// src/components/bills/LogoThumbnail.tsx
//
// A logo's picture, for the library, the pickers and the bill detail.
//
// THE ASPECT RATIO IS THE WHOLE POINT, SO IT IS NEVER GIVEN UP
// `contentFit="contain"` fits the image inside the box and leaves the remainder
// empty; `cover` would crop and `fill` would stretch. This is the same rule the PDF
// renderer follows, so what the admin sees here is what prints. A stretched preview
// would make a correct logo look wrong, and the admin would "fix" a logo that was
// already fine.
//
// A TRANSPARENT LOGO STAYS TRANSPARENT
// Nothing here composites the image onto an opaque plate. A PNG with an alpha
// channel shows the surface colour through it, which is what the invoice does too
// — a logo that looked right on white must not gain a white box here and then be
// judged from that.

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useLogoImageUrls } from "./useLogoImageUrls";

/** One logo's picture, fitted to a box without ever distorting it. */
export function LogoThumbnail({
  logoId,
  size = 56,
  rounded = true,
}: {
  logoId: string;
  size?: number;
  rounded?: boolean;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const urls = useLogoImageUrls([logoId]);
  const url = urls.get(logoId);

  const box = {
    width: size,
    height: size,
    borderRadius: rounded ? Math.max(4, Math.round(size * 0.14)) : 0,
  };

  if (!url) {
    /* A neutral placeholder rather than a spinner that never resolves: the fetch is
       fast, and a permanent-looking empty box reads as a broken image. */
    return (
      <View
        style={[styles.placeholder, box]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.placeholderGlyph, { fontSize: Math.round(size * 0.34) }]}>🖼</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={[styles.image, box]}
      contentFit="contain"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      /* Logos are small and the library is short. Caching lets a scrolled-back-into
         logo paint instantly instead of flashing the placeholder on every pass. */
      cachePolicy="memory-disk"
      transition={120}
    />
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    image: {
      backgroundColor: theme.colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    placeholder: {
      backgroundColor: theme.colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    placeholderGlyph: { opacity: 0.35 },
  });

export default LogoThumbnail;