import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import api from '../api';
import { Colors } from '../constants/colors';

export default function CharacterDetailScreen() {
  const route = useRoute();
  const nav = useNavigation();
  const { id } = route.params;
  const [char, setChar] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCharacter(id).then(setChar).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={Colors.character.primary} /></View>;
  if (!char) return <View style={styles.loading}><Text style={{ color: Colors.common.textLight }}>未找到角色</Text></View>;

  const genderBg = char.gender === '男' ? Colors.gender.maleBg :
    char.gender === '女' ? Colors.gender.femaleBg :
    char.gender ? Colors.gender.otherBg : null;
  const genderColor = char.gender === '男' ? Colors.gender.male :
    char.gender === '女' ? Colors.gender.female : Colors.gender.other;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.name}>{char.name}</Text>
          <View style={styles.badges}>
            {char.university ? <Text style={styles.uniTag}>{char.university}</Text> : null}
            {char.gender ? <Text style={[styles.genderBadge, { backgroundColor: genderBg, color: genderColor }]}>{char.gender}</Text> : null}
            {char.status === '已消逝' ? <Text style={styles.statusBadge}>已消逝</Text> : null}
          </View>
        </View>

        <Section label="代表高校">{char.university}</Section>
        <Section label="地区">{char.region}</Section>
        <Section label="诞生地">{char.birthplace}</Section>
        {char.status === '已消逝' ? <Section label="存在状态">{char.status}</Section> : null}

        <View style={styles.infoRow}>
          <View style={styles.half}><Section label="身高">{char.height}</Section></View>
          <View style={styles.half}><Section label="性别">{char.gender}</Section></View>
        </View>
        <View style={styles.infoRow}>
          <View style={styles.half}><Section label="生日">{char.birthday}</Section></View>
        </View>

        <Section label="外貌">{char.appearance}</Section>
        <Section label="身份存在时间">{char.identity_period}</Section>
        <Section label="诞生时间">{char.birth_time}</Section>
        <Section label="取名依据">{char.naming_rationale}</Section>
        <Section label="设定">{char.setting}</Section>
      </ScrollView>
      <View style={styles.fixedFooter}>
        <Text style={styles.editBtn} onPress={() => {
          nav.goBack();
          setTimeout(() => nav.navigate('CharacterForm', { id: char.id }), 200);
        }}>编辑</Text>
        <Text style={styles.closeBtn} onPress={() => nav.goBack()}>关闭</Text>
      </View>
    </View>
  );
}

function Section({ label, children, muted }) {
  const val = children || '';
  const isEmpty = !val || val.trim() === '';
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={[styles.sectionValue, isEmpty && styles.sectionMuted]}>
        {isEmpty ? '（未填写）' : val}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.character.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 20, paddingBottom: 100 },
  header: { marginBottom: 18 },
  name: { fontSize: 22, fontWeight: '700', color: Colors.character.primaryDark, letterSpacing: 0.5, marginBottom: 8 },
  badges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  uniTag: {
    fontSize: 12, backgroundColor: Colors.character.pale,
    color: Colors.character.primary, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 10, fontWeight: '500',
  },
  genderBadge: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, fontWeight: '500' },
  statusBadge: { fontSize: 11, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: '#e0d5cc', color: '#5a3e2b', fontWeight: '600' },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: Colors.character.primary, marginBottom: 2, letterSpacing: 0.5 },
  sectionValue: { fontSize: 15, color: Colors.common.text, lineHeight: 24 },
  sectionMuted: { color: Colors.common.textLight, fontStyle: 'italic' },
  infoRow: { flexDirection: 'row', gap: 20 },
  half: { flex: 1 },
  fixedFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'flex-end', gap: 10,
    padding: 14, backgroundColor: Colors.character.card,
    borderTopWidth: 1, borderColor: '#f0e8dc',
  },
  editBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.character.primary,
    fontSize: 15, fontWeight: '600', color: '#fff', overflow: 'hidden',
  },
  closeBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.common.border,
    fontSize: 15, fontWeight: '600', color: Colors.common.textLight, overflow: 'hidden',
  },
});
