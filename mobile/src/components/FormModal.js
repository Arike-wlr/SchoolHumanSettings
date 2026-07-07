import React, { useState, useCallback } from 'react';
import { Modal, View, Text, StyleSheet, Dimensions } from 'react-native';
import { Colors } from '../constants/colors';

const { width: WINDOW_WIDTH } = Dimensions.get('window');

export default function FormModal({
  visible, title, onClose, onSubmit, submitLabel = '确认', children, loading,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableClose onPress={onClose} />
          </View>
          <View style={styles.body}>{children}</View>
          <View style={styles.footer}>
            <FormButton label="取消" variant="ghost" onPress={onClose} />
            <FormButton label={submitLabel} variant="primary" onPress={onSubmit} loading={loading} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TouchableClose({ onPress }) {
  return (
    <View style={{ marginLeft: 12 }}>
      <Text style={{ fontSize: 20, color: Colors.common.textLight, padding: 4 }} onPress={onPress}>
        ✕
      </Text>
    </View>
  );
}

function FormButton({ label, variant, onPress, loading }) {
  const bg = variant === 'primary' ? Colors.character.primary : 'transparent';
  const border = variant === 'ghost' ? { borderWidth: 1, borderColor: Colors.common.border } : {};
  const color = variant === 'primary' ? '#fff' : Colors.common.textLight;
  return (
    <Text
      style={[styles.btn, { backgroundColor: bg, color }, border]}
      onPress={loading ? undefined : onPress}
    >
      {loading ? '处理中...' : label}
    </Text>
  );
}

export function FormField({ label, children, style }) {
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: Colors.common.overlay,
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modal: {
    backgroundColor: Colors.character.card,
    borderRadius: 14,
    width: Math.min(WINDOW_WIDTH - 40, 500),
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 18, borderBottomWidth: 1, borderColor: Colors.common.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.character.primaryDark },
  body: { padding: 18, maxHeight: '75%' },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end',
    gap: 10, padding: 16, borderTopWidth: 1, borderColor: '#f0e8dc',
  },
  btn: {
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 8, fontSize: 15, fontWeight: '600',
    overflow: 'hidden',
  },
  field: { marginBottom: 14 },
  label: {
    fontSize: 13, fontWeight: '700', color: Colors.character.primary,
    marginBottom: 4, letterSpacing: 0.5,
  },
});
