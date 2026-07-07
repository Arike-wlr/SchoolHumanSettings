import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>测试页</Text>
      <Text style={styles.text}>如果你看到这行字，说明 App 能正常渲染。</Text>
      <Text style={styles.text}>Expo SDK: 57</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  text: { fontSize: 16, color: '#333', marginTop: 8 },
});
