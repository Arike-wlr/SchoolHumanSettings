import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import api from '../api';
import { Colors } from '../constants/colors';

const STATUS_OPTIONS = ['存在', '已消逝'];
const GENDER_OPTIONS = ['', '男', '女', '其他'];

export default function CharacterFormScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const editId = route.params?.id;
  const isEdit = !!editId;
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const [form, setForm] = useState({
    name: '', university: '', region: '', naming_rationale: '',
    height: '', gender: '', birthday: '', appearance: '',
    identity_period: '', birth_time: '', birthplace: '', status: '存在', setting: '',
  });

  useEffect(() => {
    if (editId) {
      setFetching(true);
      api.getCharacter(editId).then(data => {
        setForm({
          name: data.name || '',
          university: data.university || '',
          region: data.region || '',
          naming_rationale: data.naming_rationale || '',
          height: data.height || '',
          gender: data.gender || '',
          birthday: data.birthday || '',
          appearance: data.appearance || '',
          identity_period: data.identity_period || '',
          birth_time: data.birth_time || '',
          birthplace: data.birthplace || '',
          status: data.status || '存在',
          setting: data.setting || '',
        });
      }).catch(e => Alert.alert('加载失败', e.message)).finally(() => setFetching(false));
    }
  }, [editId]);

  const setField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { Alert.alert('提示', '姓名不能为空'); return; }
    setLoading(true);
    try {
      if (isEdit) {
        await api.updateCharacter(editId, form);
      } else {
        await api.createCharacter(form);
      }
      Alert.alert('成功', isEdit ? '角色已更新' : '角色已创建', [
        { text: '好', onPress: () => nav.goBack() },
      ]);
    } catch (e) {
      Alert.alert('操作失败', e.message);
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return <View style={styles.loading}><ActivityIndicator size="large" color={Colors.character.primary} /></View>;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Field label="姓名 *" value={form.name} onChangeText={v => setField('name', v)} placeholder="请输入角色姓名" />

        <Field label="代表高校" value={form.university} onChangeText={v => setField('university', v)} placeholder="如：上海交通大学" />

        <Field label="地区" value={form.region} onChangeText={v => setField('region', v)} placeholder="如：北京、江苏" />

        <Field label="取名依据" value={form.naming_rationale} onChangeText={v => setField('naming_rationale', v)} multiline numberOfLines={3} placeholder="名字的来源、含义…" />

        <View style={styles.row}>
          <View style={styles.half}>
            <Field label="身高" value={form.height} onChangeText={v => setField('height', v)} placeholder="如：178cm" />
          </View>
          <View style={styles.half}>
            <Text style={styles.label}>性别</Text>
            <View style={styles.chipRow}>
              {GENDER_OPTIONS.map(g => (
                <Text key={g || '空'} style={[styles.chip, form.gender === g && styles.chipActive]} onPress={() => setField('gender', g)}>
                  {g || '未选'}
                </Text>
              ))}
            </View>
          </View>
        </View>

        <Field label="生日" value={form.birthday} onChangeText={v => setField('birthday', v)} placeholder="如：5月20日 / 1905-05-20" />

        <Field label="外貌" value={form.appearance} onChangeText={v => setField('appearance', v)} multiline numberOfLines={3} placeholder="描述角色的外貌特征..." />

        <Field label="身份存在时间" value={form.identity_period} onChangeText={v => setField('identity_period', v)} placeholder="如：民国时期至今" />

        <Field label="诞生时间" value={form.birth_time} onChangeText={v => setField('birth_time', v)} placeholder="如：1905年建校" />

        <Field label="诞生地" value={form.birthplace} onChangeText={v => setField('birthplace', v)} placeholder="如：南京" />

        <Text style={styles.label}>存在状态</Text>
        <View style={styles.chipRow}>
          {STATUS_OPTIONS.map(s => (
            <Text key={s} style={[styles.chip, form.status === s && styles.chipActive]} onPress={() => setField('status', s)}>
              {s}
            </Text>
          ))}
        </View>

        <Field label="设定" value={form.setting} onChangeText={v => setField('setting', v)} multiline numberOfLines={5} placeholder="详细描述角色的背景设定、性格、经历等..." />
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
        style={[styles.input, multiline && { minHeight: numberOfLines ? numberOfLines * 24 : 80, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.common.textLight}
        multiline={multiline}
        numberOfLines={numberOfLines}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.character.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  label: {
    fontSize: 13, fontWeight: '700', color: Colors.character.primary,
    marginBottom: 4, letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1.5, borderColor: Colors.common.border,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: Colors.common.text, backgroundColor: Colors.character.card,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.common.border,
    fontSize: 14, color: Colors.common.textLight, backgroundColor: Colors.character.card,
    overflow: 'hidden',
  },
  chipActive: {
    backgroundColor: Colors.character.primary, borderColor: Colors.character.primary,
    color: '#fff', fontWeight: '600',
  },
  fixedFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'flex-end', gap: 10,
    padding: 14, backgroundColor: Colors.character.card,
    borderTopWidth: 1, borderColor: '#f0e8dc',
  },
  cancelBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.common.border,
    fontSize: 15, fontWeight: '600', color: Colors.common.textLight,
    overflow: 'hidden',
  },
  submitBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.character.primary,
    fontSize: 15, fontWeight: '600', color: '#fff',
    overflow: 'hidden',
  },
});
