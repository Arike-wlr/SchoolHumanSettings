import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import SearchBar from '../components/SearchBar';
import FilterTabs from '../components/FilterTabs';
import Button from '../components/Button';
import api from '../api';
import { Colors } from '../constants/colors';

export default function CharactersScreen() {
  const nav = useNavigation();
  const [characters, setCharacters] = useState([]);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('全部');
  const [regions, setRegions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getCharacters();
      setCharacters(data);
      const groups = {};
      data.forEach(c => {
        const r = c.region || '未分类';
        groups[r] = (groups[r] || 0) + 1;
      });
      const tabs = [{ key: '全部', label: '全部', count: data.length }];
      Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => tabs.push({ key: k, label: k, count: v }));
      setRegions(tabs);
    } catch (e) {
      Alert.alert('加载失败', e.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  let filtered = characters;
  if (region !== '全部') filtered = filtered.filter(c => c.region === region);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.university || '').toLowerCase().includes(q)
    );
  }

  const grouped = {};
  const showDivider = region === '全部' && !search.trim();
  if (showDivider) {
    (search.trim() ? filtered : characters.filter(c => region === '全部' ? true : c.region === region)).forEach(c => {
      const r = c.region || '未分类';
      if (!grouped[r]) grouped[r] = [];
      grouped[r].push(c);
    });
  }

  const handleDelete = (item) => {
    Alert.alert('确认删除', `确定要删除角色「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await api.deleteCharacter(item.id);
        load();
      }},
    ]);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.card, item.status === '已消逝' && styles.cardPerished]}
      onPress={() => nav.navigate('CharacterDetail', { id: item.id })}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{item.name}</Text>
        {item.university ? <Text style={styles.uniTag}>{item.university}</Text> : null}
        {item.gender ? (
          <Text style={[
            styles.genderBadge,
            { backgroundColor: Colors.gender[item.gender === '男' ? 'maleBg' : item.gender === '女' ? 'femaleBg' : 'otherBg'],
              color: Colors.gender[item.gender === '男' ? 'male' : item.gender === '女' ? 'female' : 'other'] }
          ]}>{item.gender}</Text>
        ) : null}
        {item.status === '已消逝' ? <Text style={styles.statusBadge}>已消逝</Text> : null}
      </View>
      <View style={styles.cardBody}>
        {item.region ? <Field label="地区" value={item.region} /> : null}
        {item.birthplace ? <Field label="诞生地" value={item.birthplace} /> : null}
        {item.height ? <Field label="身高" value={item.height} /> : null}
        {item.birthday ? <Field label="生日" value={item.birthday} /> : null}
        {item.setting ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>设定</Text>
            <Text style={styles.fieldValue} numberOfLines={2}>
              {item.setting.length > 80 ? item.setting.slice(0, 80) + '…' : item.setting}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardFooter}>
        <TouchableOpacity onPress={() => nav.navigate('CharacterForm', { id: item.id })}>
          <Text style={styles.editBtn}>编辑</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item)}>
          <Text style={styles.deleteBtn}>删除</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderSection = () => {
    // Show sections only when no filter active
    if (region !== '全部' || search.trim()) return null;
    const ordered = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);
    const items = [];
    ordered.forEach(r => {
      items.push({ type: 'section', title: r, count: grouped[r].length });
      grouped[r].forEach(c => items.push({ type: 'item', ...c }));
    });
    return items;
  };

  const sectionData = renderSection();

  const ListHeader = (
    <View>
      <View style={styles.toolbar}>
        <Text style={styles.count}>共 <Text style={{ color: Colors.character.primary, fontWeight: '700' }}>{characters.length}</Text> 位角色</Text>
        <Button title="＋ 添加" variant="primary" size="sm" onPress={() => nav.navigate('CharacterForm', { id: null })} />
      </View>
      <SearchBar value={search} onChangeText={setSearch} onClear={() => setSearch('')} placeholder="搜索校名或角色名…" />
      {regions.length > 1 ? (
        <FilterTabs tabs={regions} activeKey={region} onSelect={(k) => { setRegion(k); }} theme="character" />
      ) : null}
    </View>
  );

  if (sectionData) {
    return (
      <View style={styles.container}>
        <FlatList
          data={sectionData}
          keyExtractor={(item, index) => item.type === 'section' ? `section-${item.title}` : `item-${item.id}`}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => {
            if (item.type === 'section') {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{item.title} · {item.count}位</Text>
                </View>
              );
            }
            return renderItem({ item });
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📖</Text>
              <Text style={styles.emptyText}>还没有角色设定，点击添加吧</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        ListHeaderComponent={ListHeader}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📖</Text>
            <Text style={styles.emptyText}>
              {characters.length === 0 ? '还没有角色设定，点击添加吧' : '未找到匹配的角色'}
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

function Field({ label, value }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.character.bg },
  listContent: { padding: 16, paddingBottom: 80 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  count: { fontSize: 14, color: Colors.common.textLight },
  empty: { alignItems: 'center', padding: 60 },
  emptyIcon: { fontSize: 48, opacity: 0.5, marginBottom: 12 },
  emptyText: { fontSize: 15, color: Colors.common.textLight },
  sectionHeader: {
    paddingVertical: 8, paddingHorizontal: 4,
    borderBottomWidth: 1, borderColor: Colors.common.border,
    marginBottom: 8, marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16, fontFamily: 'serif', color: Colors.character.primary,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: Colors.character.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.common.border,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  cardPerished: { opacity: 0.7 },
  cardHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardName: { fontSize: 18, fontWeight: '700', color: Colors.character.primaryDark, letterSpacing: 0.5 },
  uniTag: {
    fontSize: 12, backgroundColor: Colors.character.pale, color: Colors.character.primary,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontWeight: '500',
  },
  genderBadge: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontWeight: '500' },
  statusBadge: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: '#e0d5cc', color: '#5a3e2b', fontWeight: '600' },
  cardBody: { marginBottom: 10 },
  fieldRow: { flexDirection: 'row', marginBottom: 3 },
  fieldLabel: { width: 52, fontSize: 12, fontWeight: '700', color: Colors.character.primary, marginRight: 6 },
  fieldValue: { flex: 1, fontSize: 13, color: Colors.common.text, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: '#f0e8dc', paddingTop: 10 },
  editBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.character.primaryLight,
    color: Colors.character.primary, fontSize: 13, fontWeight: '600',
    overflow: 'hidden',
  },
  deleteBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.common.border,
    color: Colors.common.textLight, fontSize: 13, fontWeight: '600',
    overflow: 'hidden',
  },
});
