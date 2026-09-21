import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, space } from "../theme";

type Props = {
  title: string;
  onBack?: () => void;
};

export function TopBar({ title, onBack }: Props) {
  return (
    <View style={styles.row}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <Text style={styles.chevron}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.back} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backPressed: { backgroundColor: colors.surfaceAlt },
  chevron: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 34,
    marginTop: -4,
    fontWeight: "600",
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
});
