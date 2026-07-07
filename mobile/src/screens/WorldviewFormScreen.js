import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import api from '../api';
import { Colors } from '../constants/colors';

export default function WorldviewFormScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const editId = route.params?.id;
  const defaultMainCat = route.params?.mainCategory || '意识体世界设定';
  const isEdit = !!editId;

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [form, setForm] = useState({
    title: '', category: '', content: '', main_category: defaultMainCat,
  });

  useEffect(() => {
    if (editId) {
      setFetching(true);
      api.getWorldBuilding(editId).then(data => {
        setForm({
          title: data.title || '',
          category: data.category || '',
          content: data.content || '',
          main_category: data.main_category || defaultMainCat,
        });
      }).catch(e => Alert.alert('加载失败', e.message)).finally(() => setFetching(false));
    }
  }, [editId]);

  const setField = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleSubmit = async () => {
    if (!form.title.trim()) { Alert.alert('提示', '标题不能为空'); return; }
    setLoading(true);
    try {
      if (isEdit) await api.updateWorldBuilding(editId, form);
      else await api.createWorldBuilding(form);
      Alert.alert('成功', isEdit ? '设定已更新' : '设定已创建', [{ text: '好', onPress: () => nav.goBack() }]);
    } catch (e) { Alert.alert('操作失败', e.message); }
    finally { setLoading(false); }
  };

  if (fetching) return <View style={styles.loading}><ActivityIndicator size="large" color={Colors.worldview.primary} /></View>;

  const isStory = form.main_category === '人物背景故事';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.mainCatText}>
          当前大类：<Text style={{ color: Colors.worldview.primary, fontWeight: '700' }}>{form.main_category}</Text>
        </Text>

        <Field label="标题 *" value={form.title} onChangeText={v => setField('title', v)} placeholder="如：世界观总览" />

        {!isStory ? (
          <Field label="分类" value={form.category} onChangeText={v => setField('category', v)} placeholder="如：时间线、地理、势力…" />
        ) : null}

        <Field label="内容" value={form.content} onChangeText={v => setField('content', v)} multiline numberOfLines={8} placeholder="详细描述世界观内容…" />
      </ScrollView>
      <View style={styles.fixedFooter}>
        <Text style={styles.cancelBtn} onPress={() => nav.goBack()}>取消</Text>
        <Text style={styles.submitBtn} onPress={loading ? undefined : handleSubmit}>
          {loading ? '保存中...' : isEdit ? '保存修改' : '确认添加'}
        </Text>
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, numberOfLines }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: numberOfLines ? numberOfLines * 24 : 120, textAlignVertical: 'top' }]}
        value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor={Colors.common.textLight}
        multiline={multiline} numberOfLines={numberOfLines}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.worldview.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },
  mainCatText: { fontSize: 14, color: Colors.common.textLight, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '700', color: Colors.worldview.primary, marginBottom: 4, letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: Colors.common.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    color: Colors.common.text, backgroundColor: Colors.worldview.card,
  },
  fixedFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'flex-end', gap: 10,
    padding: 14, backgroundColor: Colors.worldview.card,
    borderTopWidth: 1, borderColor: '#e6efe9',
  },
  cancelBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.common.border,
    fontSize: 15, fontWeight: '600', color: Colors.common.textLight, overflow: 'hidden',
  },
  submitBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.worldview.primary,
    fontSize: 15, fontWeight: '600', color: '#fff', overflow: 'hidden',
  },
});
