import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import api from '../api';
import { Colors } from '../constants/colors';

const REL_TYPES = ['CP', '单箭头', '继承记忆', '参与组建', '师生'];

export default function RelationFormScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const editId = route.params?.id;
  const isEdit = !!editId;

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [form, setForm] = useState({
    from_char_id: '', to_char_id: '', relation_type: '', description: '',
  });
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  useEffect(() => {
    api.getCharacters().then(setCharacters).catch(() => {});
    if (editId) {
      setFetching(true);
      api.getRelation(editId).then(data => {
        setForm({
          from_char_id: String(data.from_char_id),
          to_char_id: String(data.to_char_id),
          relation_type: data.relation_type || '',
          description: data.description || '',
        });
      }).catch(e => Alert.alert('加载失败', e.message)).finally(() => setFetching(false));
    }
  }, [editId]);

  const getRelation = async (id) => {
    // Relations API returns all relations, find the one
    const rels = await api.getRelations();
    return rels.find(r => r.id === id);
  };

  const setField = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleSubmit = async () => {
    if (!form.from_char_id || !form.to_char_id) { Alert.alert('提示', '请选择两个角色'); return; }
    if (form.from_char_id === form.to_char_id) { Alert.alert('提示', '不能选择同一个角色'); return; }
    setLoading(true);
    try {
      const data = {
        from_char_id: parseInt(form.from_char_id),
        to_char_id: parseInt(form.to_char_id),
        relation_type: form.relation_type,
        description: form.description,
      };
      if (isEdit) await api.updateRelation(editId, data);
      else await api.createRelation(data);
      Alert.alert('成功', isEdit ? '关系已更新' : '关系已创建', [{ text: '好', onPress: () => nav.goBack() }]);
    } catch (e) { Alert.alert('操作失败', e.message); }
    finally { setLoading(false); }
  };

  if (fetching) return <View style={styles.loading}><ActivityIndicator size="large" color={Colors.relations.primary} /></View>;

  const fromChar = characters.find(c => String(c.id) === form.from_char_id);
  const toChar = characters.find(c => String(c.id) === form.to_char_id);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>角色A *</Text>
        <TouchableOpacity style={styles.selector} onPress={() => setShowFromPicker(!showFromPicker)}>
          <Text style={{ color: fromChar ? Colors.common.text : Colors.common.textLight, fontSize: 15 }}>
            {fromChar ? `${fromChar.name}${fromChar.university ? ' · ' + fromChar.university : ''}` : '请选择角色…'}
          </Text>
        </TouchableOpacity>
        {showFromPicker && (
          <View style={styles.pickerList}>
            <ScrollView style={{ maxHeight: 150 }}>
              {characters.map(c => (
                <TouchableOpacity key={c.id} style={styles.pickerItem} onPress={() => { setField('from_char_id', String(c.id)); setShowFromPicker(false); }}>
                  <Text style={styles.pickerText}>{c.name}{c.university ? ` · ${c.university}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <Text style={[styles.label, { marginTop: 14 }]}>角色B *</Text>
        <TouchableOpacity style={styles.selector} onPress={() => setShowToPicker(!showToPicker)}>
          <Text style={{ color: toChar ? Colors.common.text : Colors.common.textLight, fontSize: 15 }}>
            {toChar ? `${toChar.name}${toChar.university ? ' · ' + toChar.university : ''}` : '请选择角色…'}
          </Text>
        </TouchableOpacity>
        {showToPicker && (
          <View style={styles.pickerList}>
            <ScrollView style={{ maxHeight: 150 }}>
              {characters.map(c => (
                <TouchableOpacity key={c.id} style={styles.pickerItem} onPress={() => { setField('to_char_id', String(c.id)); setShowToPicker(false); }}>
                  <Text style={styles.pickerText}>{c.name}{c.university ? ` · ${c.university}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <Text style={[styles.label, { marginTop: 14 }]}>关系类型</Text>
        <View style={styles.chipRow}>
          {REL_TYPES.map(t => (
            <Text
              key={t}
              style={[styles.chip, form.relation_type === t && styles.chipActive]}
              onPress={() => setField('relation_type', t)}
            >
              {t}
            </Text>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 14 }]}>关系描述</Text>
        <TextInput
          style={styles.textArea}
          value={form.description}
          onChangeText={v => setField('description', v)}
          placeholder="补充说明两人关系的细节…"
          placeholderTextColor={Colors.common.textLight}
          multiline
          numberOfLines={3}
        />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.relations.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },
  label: { fontSize: 13, fontWeight: '700', color: Colors.relations.primary, marginBottom: 4, letterSpacing: 0.5 },
  selector: {
    borderWidth: 1.5, borderColor: Colors.common.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: Colors.relations.card,
  },
  pickerList: {
    borderWidth: 1, borderColor: Colors.common.border, borderRadius: 8,
    marginTop: 4, backgroundColor: Colors.relations.card, overflow: 'hidden',
  },
  pickerItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: Colors.common.border },
  pickerText: { fontSize: 14, color: Colors.common.text },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.common.border,
    fontSize: 14, color: Colors.common.textLight, backgroundColor: Colors.relations.card,
    overflow: 'hidden',
  },
  chipActive: {
    backgroundColor: Colors.relations.primary, borderColor: Colors.relations.primary,
    color: '#fff', fontWeight: '600',
  },
  textArea: {
    borderWidth: 1.5, borderColor: Colors.common.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    color: Colors.common.text, backgroundColor: Colors.relations.card,
    minHeight: 80, textAlignVertical: 'top',
  },
  fixedFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'flex-end', gap: 10,
    padding: 14, backgroundColor: Colors.relations.card,
    borderTopWidth: 1, borderColor: '#f0e8dc',
  },
  cancelBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.common.border,
    fontSize: 15, fontWeight: '600', color: Colors.common.textLight, overflow: 'hidden',
  },
  submitBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.relations.primary,
    fontSize: 15, fontWeight: '600', color: '#fff', overflow: 'hidden',
  },
});
