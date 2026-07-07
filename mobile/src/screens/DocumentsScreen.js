import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import api from '../api';
import { Colors } from '../constants/colors';

const FILE_ICONS = { docx: '📝', doc: '📝', pdf: '📕', txt: '📄', md: '📋' };

export default function DocumentsScreen() {
  const nav = useNavigation();
  const [files, setFiles] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getFiles();
      setFiles(data);
    } catch (e) {
      Alert.alert('加载失败', e.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handlePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        type: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword', 'application/pdf', 'text/plain', 'text/markdown', '*/*'],
      });
      if (!result.canceled && result.assets?.length) {
        setUploading(true);
        const uris = result.assets.map(a => a.uri);
        await api.uploadFiles(uris);
        setUploading(false);
        load();
        Alert.alert('成功', `已上传 ${uris.length} 个文件`);
      }
    } catch (e) {
      setUploading(false);
      Alert.alert('上传失败', e.message);
    }
  };

  const handleDelete = (item) => {
    Alert.alert('确认删除', `确定要删除「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await api.deleteFile(item.name);
        load();
      }},
    ]);
  };

  const handleView = async (item) => {
    const ext = item.name.split('.').pop().toLowerCase();
    if (['docx', 'txt', 'md'].includes(ext)) {
      nav.navigate('DocumentView', { name: item.name });
    }
  };

  const handleDownload = (item) => {
    const url = api.getFileUrl(item.name);
    Linking.openURL(url);
  };

  const getIcon = (name) => {
    const ext = name.split('.').pop().toLowerCase();
    return FILE_ICONS[ext] || '📎';
  };

  const renderItem = ({ item }) => {
    const ext = item.name.split('.').pop().toLowerCase();
    const canView = ['docx', 'txt', 'md'].includes(ext);

    return (
      <View style={styles.fileItem}>
        <Text style={styles.fileIcon}>{getIcon(item.name)}</Text>
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.fileMeta}>{item.size_display} · {item.modified}</Text>
        </View>
        <View style={styles.fileActions}>
          {canView ? (
            <TouchableOpacity onPress={() => handleView(item)}>
              <Text style={styles.viewBtn}>查看</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => handleDownload(item)}>
            <Text style={styles.dlBtn}>下载</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item)}>
            <Text style={styles.delBtn}>删除</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {uploading && (
        <View style={styles.uploading}>
          <ActivityIndicator color={Colors.documents.primary} />
          <Text style={{ marginLeft: 8, color: Colors.documents.primary }}>上传中...</Text>
        </View>
      )}

      <FlatList
        data={files}
        keyExtractor={item => item.name}
        ListHeaderComponent={
          <View>
            <TouchableOpacity style={styles.uploadZone} onPress={handlePick} activeOpacity={0.7}>
              <Text style={styles.uploadIcon}>📄</Text>
              <Text style={styles.uploadBtn}>选择文件上传</Text>
              <Text style={styles.uploadTip}>支持 .docx .doc .pdf .txt .md</Text>
            </TouchableOpacity>
            <View style={styles.toolbar}>
              <Text style={styles.count}>
                共 <Text style={{ color: Colors.documents.primary, fontWeight: '700' }}>{files.length}</Text> 个文档
              </Text>
            </View>
          </View>
        }
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyText}>还没有上传文档</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.documents.bg },
  uploading: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 12, backgroundColor: Colors.documents.pale,
  },
  list: { padding: 16, paddingBottom: 80 },
  uploadZone: {
    borderWidth: 2, borderColor: Colors.common.border, borderStyle: 'dashed',
    borderRadius: 14, padding: 36, alignItems: 'center',
    backgroundColor: Colors.documents.card, marginBottom: 20,
  },
  uploadIcon: { fontSize: 40, marginBottom: 10, opacity: 0.6 },
  uploadBtn: {
    fontSize: 16, fontWeight: '600', color: Colors.documents.primary,
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.documents.pale, overflow: 'hidden',
  },
  uploadTip: { fontSize: 13, color: Colors.common.textLight, marginTop: 8 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  count: { fontSize: 14, color: Colors.common.textLight },
  empty: { alignItems: 'center', padding: 60 },
  emptyIcon: { fontSize: 48, opacity: 0.5, marginBottom: 12 },
  emptyText: { fontSize: 15, color: Colors.common.textLight },
  fileItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.documents.card, padding: 14,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.common.border,
    marginBottom: 8,
  },
  fileIcon: { fontSize: 24 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 15, fontWeight: '600', color: Colors.common.text },
  fileMeta: { fontSize: 12, color: Colors.common.textLight, marginTop: 2 },
  fileActions: { flexDirection: 'row', gap: 8 },
  viewBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    backgroundColor: '#4a7c59', color: '#fff', fontSize: 13, fontWeight: '600', overflow: 'hidden',
  },
  dlBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.documents.primaryLight,
    color: Colors.documents.primary, fontSize: 13, fontWeight: '600', overflow: 'hidden',
  },
  delBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.common.border,
    color: Colors.common.textLight, fontSize: 13, fontWeight: '600', overflow: 'hidden',
  },
});
