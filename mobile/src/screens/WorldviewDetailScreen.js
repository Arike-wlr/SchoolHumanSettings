import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import api from '../api';
import { Colors } from '../constants/colors';

export default function WorldviewDetailScreen() {
  const route = useRoute();
  const nav = useNavigation();
  const { id } = route.params;
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getWorldBuilding(id).then(setEntry).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={Colors.worldview.primary} /></View>;
  if (!entry) return <View style={styles.loading}><Text style={{ color: Colors.common.textLight }}>未找到设定</Text></View>;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{entry.title}</Text>
        {entry.main_category !== '人物背景故事' && entry.category ? (
          <Text style={styles.catTag}>{entry.category}</Text>
        ) : null}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>内容</Text>
          <Text style={styles.sectionValue}>{entry.content || '（无内容）'}</Text>
        </View>
      </ScrollView>
      <View style={styles.fixedFooter}>
        <Text style={styles.closeBtn} onPress={() => nav.goBack()}>关闭</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.worldview.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 20, paddingBottom: 100 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.worldview.primaryDark, marginBottom: 8 },
  catTag: {
    fontSize: 12, backgroundColor: Colors.worldview.pale, color: Colors.worldview.primary,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, fontWeight: '500',
    alignSelf: 'flex-start', marginBottom: 18,
  },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: Colors.worldview.primary, marginBottom: 4 },
  sectionValue: { fontSize: 15, color: Colors.common.text, lineHeight: 26 },
  fixedFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'flex-end',
    padding: 14, backgroundColor: Colors.worldview.card,
    borderTopWidth: 1, borderColor: '#e6efe9',
  },
  closeBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.worldview.primary,
    fontSize: 15, fontWeight: '600', color: '#fff', overflow: 'hidden',
  },
});
