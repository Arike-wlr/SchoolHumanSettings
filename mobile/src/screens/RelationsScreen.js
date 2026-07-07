import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../api';
import { Colors } from '../constants/colors';

export default function RelationsScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const [relations, setRelations] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('list'); // 'graph' or 'list'

  const load = useCallback(async () => {
    try {
      const [rels, chars] = await Promise.all([
        api.getRelations(),
        api.getCharacters(),
      ]);
      setRelations(rels);
      setCharacters(chars);
    } catch (e) {
      Alert.alert('加载失败', e.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const charMap = {};
  characters.forEach(c => { charMap[c.id] = c; });

  // 构建图谱数据
  const graphNodes = characters.map(c => ({
    id: c.id, name: c.name, gender: c.gender, family: c.family || '',
  }));

  const graphEdges = relations.filter(r => charMap[r.from_char_id] && charMap[r.to_char_id]).map(r => ({
    id: r.id,
    from: r.from_char_id,
    to: r.to_char_id,
    type: r.relation_type || '关联',
    desc: r.description || '',
    fromName: charMap[r.from_char_id]?.name || `#${r.from_char_id}`,
    toName: charMap[r.to_char_id]?.name || `#${r.to_char_id}`,
  }));

  const handleDelete = (item) => {
    Alert.alert('确认删除', `确定要删除关系吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await api.deleteRelation(item.id);
        load();
      }},
    ]);
  };

  const getRelTypeStyle = (type) => {
    const colors = {
      CP: { bg: '#fce4ec', text: '#c44b7a' },
      继承记忆: { bg: '#e0f2f1', text: '#2e8b8a' },
      参与组建: { bg: '#fdf0e0', text: '#d4842a' },
      师生: { bg: '#e3edf7', text: '#4a7db0' },
    };
    return colors[type] || { bg: Colors.relations.pale, text: Colors.relations.primary };
  };

  const renderRelation = ({ item }) => {
    const typeStyle = getRelTypeStyle(item.relation_type);
    return (
      <TouchableOpacity
        style={styles.relItem}
        onPress={() => nav.navigate('RelationForm', { id: item.id })}
        activeOpacity={0.8}
      >
        <View style={styles.relInfo}>
          <Text style={styles.relNames}>
            {item.from_name || `#${item.from_char_id}`}
            <Text style={{ color: Colors.relations.primaryLight }}> → </Text>
            {item.to_name || `#${item.to_char_id}`}
          </Text>
          {item.relation_type ? (
            <Text style={[styles.relType, { backgroundColor: typeStyle.bg, color: typeStyle.text }]}>
              {item.relation_type}
            </Text>
          ) : null}
          {item.description ? (
            <Text style={styles.relDesc} numberOfLines={1}>{item.description}</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => handleDelete(item)}>
          <Text style={styles.deleteBtn}>删除</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'graph' && styles.tabActive]}
          onPress={() => setActiveTab('graph')}
        >
          <Text style={[styles.tabText, activeTab === 'graph' && styles.tabTextActive]}>关系图谱</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'list' && styles.tabActive]}
          onPress={() => setActiveTab('list')}
        >
          <Text style={[styles.tabText, activeTab === 'list' && styles.tabTextActive]}>关系列表</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'graph' ? (
        <View style={{ flex: 1 }}>
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: Colors.gender.male }]} /><Text style={styles.legendText}>男</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: Colors.gender.female }]} /><Text style={styles.legendText}>女</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: Colors.gender.other }]} /><Text style={styles.legendText}>其他</Text></View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.graphContainer}>
            {/* 简易节点图谱 */}
            {graphNodes.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>🔗</Text>
                <Text style={styles.emptyText}>暂无角色数据</Text>
              </View>
            ) : (
              <View style={styles.graphArea}>
                {/* 边 */}
                {graphEdges.length > 0 && (
                  <View style={styles.edgesSection}>
                    <Text style={styles.sectionTitle}>已有 {graphEdges.length} 条关系</Text>
                    {graphEdges.map(edge => {
                      const typeStyle = getRelTypeStyle(edge.type);
                      return (
                        <View key={edge.id} style={styles.edgeItem}>
                          <Text style={styles.edgeText}>
                            <Text style={{ fontWeight: '700' }}>{edge.fromName}</Text>
                            <Text style={{ color: Colors.relations.primaryLight }}> —— </Text>
                            <Text style={[{ color: typeStyle.text, fontWeight: '600' }]}>{edge.type}</Text>
                            <Text style={{ color: Colors.relations.primaryLight }}> —— </Text>
                            <Text style={{ fontWeight: '700' }}>{edge.toName}</Text>
                          </Text>
                          {edge.desc ? <Text style={styles.edgeDesc}>{edge.desc}</Text> : null}
                        </View>
                      );
                    })}
                  </View>
                )}
                {/* 节点 */}
                <View style={styles.nodesSection}>
                  <Text style={styles.sectionTitle}>角色节点 ({graphNodes.length})</Text>
                  <View style={styles.nodeGrid}>
                    {graphNodes.map(node => {
                      const color = node.gender === '男' ? Colors.gender.male :
                        node.gender === '女' ? Colors.gender.female : Colors.gender.other;
                      return (
                        <TouchableOpacity
                          key={node.id}
                          style={[styles.node, { backgroundColor: color + '18', borderColor: color + '55' }]}
                          onPress={() => nav.navigate('CharacterDetail', { id: node.id })}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.nodeCircle, { backgroundColor: color }]}>
                            <Text style={styles.nodeInitial}>
                              {node.name.charAt(0)}
                            </Text>
                          </View>
                          <Text style={styles.nodeName} numberOfLines={1}>{node.name}</Text>
                          {node.family ? (
                            <Text style={styles.nodeFamily} numberOfLines={1}>{node.family}</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      ) : (
        <FlatList
          data={relations}
          keyExtractor={item => String(item.id)}
          renderItem={renderRelation}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <View style={styles.toolbar}>
              <Text style={styles.count}>共 <Text style={{ color: Colors.relations.primary, fontWeight: '700' }}>{relations.length}</Text> 条关系</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔗</Text>
              <Text style={styles.emptyText}>还没有建立角色关系</Text>
            </View>
          }
          contentContainerStyle={styles.list}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => nav.navigate('RelationForm', { id: null })}
      >
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.relations.bg },
  tabBar: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12,
    borderRadius: 10, backgroundColor: Colors.relations.card,
    borderWidth: 1, borderColor: Colors.common.border, overflow: 'hidden',
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.relations.primary },
  tabText: { fontSize: 15, fontWeight: '600', color: Colors.common.textLight },
  tabTextActive: { color: '#fff' },
  legend: {
    flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderColor: Colors.common.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: Colors.common.textLight },
  graphContainer: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', padding: 60 },
  emptyIcon: { fontSize: 48, opacity: 0.5, marginBottom: 12 },
  emptyText: { fontSize: 15, color: Colors.common.textLight },
  graphArea: {},
  edgesSection: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.relations.primary, marginBottom: 10 },
  edgeItem: {
    backgroundColor: Colors.relations.card, padding: 10, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.common.border, marginBottom: 6,
  },
  edgeText: { fontSize: 14, color: Colors.common.text },
  edgeDesc: { fontSize: 12, color: Colors.common.textLight, marginTop: 4 },
  nodesSection: {},
  nodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  node: {
    width: 80, alignItems: 'center', padding: 8,
    borderRadius: 12, borderWidth: 1.5,
  },
  nodeCircle: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center', marginBottom: 4,
  },
  nodeInitial: { color: '#fff', fontSize: 16, fontWeight: '700' },
  nodeName: { fontSize: 11, fontWeight: '600', color: Colors.common.text },
  nodeFamily: { fontSize: 9, color: Colors.common.textLight, marginTop: 2 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  count: { fontSize: 14, color: Colors.common.textLight },
  list: { padding: 16, paddingBottom: 80 },
  relItem: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.relations.card, padding: 14,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.common.border,
    marginBottom: 8,
  },
  relInfo: { flex: 1 },
  relNames: { fontSize: 15, fontWeight: '600', color: Colors.common.text },
  relType: {
    fontSize: 12, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10, fontWeight: '500', alignSelf: 'flex-start', marginTop: 4,
    overflow: 'hidden',
  },
  relDesc: { fontSize: 12, color: Colors.common.textLight, marginTop: 2 },
  deleteBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.common.border,
    color: Colors.common.textLight, fontSize: 13, fontWeight: '600', overflow: 'hidden',
  },
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.relations.primary,
    justifyContent: 'center', alignItems: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6,
  },
  fabText: { color: '#fff', fontSize: 24, fontWeight: '300', marginTop: -1 },
});
