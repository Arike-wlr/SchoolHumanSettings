import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

export default function Button({
  title, onPress, variant = 'primary', size = 'md',
  style, textStyle, disabled,
}) {
  const btnStyle = [
    styles.base,
    styles[variant],
    styles[`size_${size}`],
    disabled && styles.disabled,
    style,
  ];
  const txtStyle = [
    styles.text,
    styles[`text_${variant}`],
    styles[`textSize_${size}`],
    disabled && styles.textDisabled,
    textStyle,
  ];

  return (
    <TouchableOpacity style={btnStyle} onPress={onPress} disabled={disabled} activeOpacity={0.7}>
      <Text style={txtStyle}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    flexDirection: 'row',
  },
  primary: { backgroundColor: Colors.character.primary },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.character.primaryLight,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.common.border,
  },
  danger: { backgroundColor: Colors.common.danger },
  size_sm: { paddingHorizontal: 12, paddingVertical: 6 },
  size_md: { paddingHorizontal: 18, paddingVertical: 10 },
  size_lg: { paddingHorizontal: 24, paddingVertical: 14 },
  disabled: { opacity: 0.5 },
  text: { fontWeight: '600', letterSpacing: 0.3 },
  text_primary: { color: '#fff' },
  text_outline: { color: Colors.character.primary },
  text_ghost: { color: Colors.common.textLight },
  text_danger: { color: '#fff' },
  textSize_sm: { fontSize: 13 },
  textSize_md: { fontSize: 15 },
  textSize_lg: { fontSize: 17 },
  textDisabled: { opacity: 0.7 },
});
