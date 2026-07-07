import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import SearchBar from '../components/SearchBar';
import FilterTabs from '../components/FilterTabs';
import api from '../api';
import { Colors } from '../constants/colors';

const MAIN_CATS = [
  { key: '意识体世界设定', label: '意识体世界设定' },
  { key: '人物背景故事', label: '人物背景故事' },
];

export default function WorldviewScreen() {
  const nav = useNavigation();
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [mainCat, setMainCat] = useState('意识体世界设定');
  const [category, setCategory] = useState('全部');
  const [categories, setCategories] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getWorldBuildings(mainCat);
      setEntries(data);
      if (mainCat !== '人物背景故事') {
        const groups = {};
        data.forEach(e => {
          const c = e.category || '未分类';
          groups[c] = (groups[c] || 0) + 1;
        });
        const tabs = [{ key: '全部', label: '全部', count: data.length }];
        Object.entries(groups)
          .sort((a, b) => b[1] - a[1])
          .forEach(([k, v]) => tabs.push({ key: k, label: k, count: v }));
        setCategories(tabs);
        setCategory('全部');
      } else {
        setCategories([{ key: '全部', label: '全部', count: data.length }]);
        setCategory('全部');
      }
    } catch (e) {
      Alert.alert('加载失败', e.message);
    }
  }, [mainCat]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleMainCat = (k) => {
    setMainCat(k);
    setCategory('全部');
    setSearch('');
  };

  let filtered = entries;
  if (mainCat !== '人物背景故事' && category !== '全部') {
    filtered = filtered.filter(e => e.category === category);
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.content || '').toLowerCase().includes(q)
    );
  }

  const handleDelete = (item) => {
    Alert.alert('确认删除', `确定要删除「${item.title}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await api.deleteWorldBuilding(item.id);
        load();
      }},
    ]);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => nav.navigate('WorldviewDetail', { id: item.id })}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        {mainCat !== '人物背景故事' && item.category ? (
          <Text style={styles.catTag}>{item.category}</Text>
        ) : null}
      </View>
      <Text style={styles.preview} numberOfLines={4}>
        {(item.content || '').length > 150 ? item.content.slice(0, 150) + '…' : (item.content || '')}
      </Text>
      <View style={styles.cardFooter}>
        <TouchableOpacity onPress={() => nav.navigate('WorldviewForm', { id: item.id })}>
          <Text style={styles.editBtn}>编辑</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item)}>
          <Text style={styles.deleteBtn}>删除</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        ListHeaderComponent={
          <View>
            <View style={styles.toolbar}>
              <Text style={styles.count}>共 <Text style={{ color: Colors.worldview.primary, fontWeight: '700' }}>{entries.length}</Text> 条设定</Text>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => nav.navigate('WorldviewForm', { id: null, mainCategory: mainCat })}
              >
                <Text style={styles.addBtnText}>＋ 添加</Text>
              </TouchableOpacity>
            </View>
            <SearchBar value={search} onChangeText={setSearch} onClear={() => setSearch('')} placeholder="搜索标题或内容…" />
            <FilterTabs
              tabs={MAIN_CATS.map(c => ({ ...c, count: undefined }))}
              activeKey={mainCat}
              onSelect={handleMainCat}
              theme="worldview"
            />
            {mainCat !== '人物背景故事' && categories.length > 1 ? (
              <FilterTabs tabs={categories} activeKey={category} onSelect={setCategory} theme="worldview" />
            ) : null}
          </View>
        }
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🌍</Text>
            <Text style={styles.emptyText}>{entries.length === 0 ? '还没有世界设定' : '未找到匹配的设定'}</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.worldview.bg },
  list: { padding: 16, paddingBottom: 80 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  count: { fontSize: 14, color: Colors.common.textLight },
  addBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.worldview.primary },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', padding: 60 },
  emptyIcon: { fontSize: 48, opacity: 0.5, marginBottom: 12 },
  emptyText: { fontSize: 15, color: Colors.common.textLight },
  card: {
    backgroundColor: Colors.worldview.card, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.common.border, padding: 16,
    marginBottom: 12, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 17, fontWeight: '700', color: Colors.worldview.primaryDark, letterSpacing: 0.5 },
  catTag: {
    fontSize: 11, backgroundColor: Colors.worldview.pale, color: Colors.worldview.primary,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontWeight: '500',
  },
  preview: { fontSize: 14, color: Colors.common.text, lineHeight: 22, marginBottom: 10, minHeight: 20 },
  cardFooter: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: '#e6efe9', paddingTop: 10 },
  editBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: Colors.worldview.primaryLight, color: Colors.worldview.primary, fontSize: 13, fontWeight: '600', overflow: 'hidden' },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: Colors.common.border, color: Colors.common.textLight, fontSize: 13, fontWeight: '600', overflow: 'hidden' },
});
