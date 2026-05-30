/**
 * Zero-dependency Haptics utility using standard Vibration API
 */
export const Haptics = {
  vibrate: (pattern: number | number[]) => {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (err) {
        console.warn("Haptic vibration not supported or blocked by user gesture restrictions:", err);
      }
    }
  },

  // Light tap - perfect for normal chess piece moves, selections, navigation buttons
  light: () => {
    Haptics.vibrate(12);
  },

  // Medium tap - perfect for captures, options toggling, dialog triggers
  medium: () => {
    Haptics.vibrate(28);
  },

  // Heavy tap - check, checkmate, resign, game finished
  heavy: () => {
    Haptics.vibrate(50);
  },

  // Error feedback - illegal moves
  error: () => {
    Haptics.vibrate([40, 40, 40]);
  },
};
