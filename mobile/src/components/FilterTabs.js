import React, { useRef, useEffect } from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

export default function FilterTabs({ tabs, activeKey, onSelect, theme = 'character' }) {
  const scrollRef = useRef(null);
  const colors = Colors[theme] || Colors.character;

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => onSelect(tab.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {tab.label}
              {tab.count !== undefined ? ` ${tab.count}` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 0, marginBottom: 16 },
  content: { gap: 8, paddingRight: 16 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.common.border,
    backgroundColor: Colors.character.card,
  },
  tabText: { fontSize: 14, color: Colors.common.textLight, fontWeight: '500' },
  tabTextActive: { color: '#fff', fontWeight: '600' },
});
