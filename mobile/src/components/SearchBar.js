import React from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

export default function SearchBar({ value, onChangeText, onClear, placeholder }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>🔍</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || '搜索...'}
        placeholderTextColor={Colors.common.textLight}
      />
      {value ? (
        <TouchableOpacity style={styles.clear} onPress={onClear}>
          <Text style={styles.clearText}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.character.card,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: Colors.common.border,
    paddingHorizontal: 12,
    height: 42,
  },
  icon: { fontSize: 14, marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: Colors.common.text, padding: 0 },
  clear: { padding: 4 },
  clearText: { fontSize: 16, color: Colors.common.textLight },
});
