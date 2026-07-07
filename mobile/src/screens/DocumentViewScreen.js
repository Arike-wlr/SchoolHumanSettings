import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Image, Dimensions } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import api from '../api';
import { Colors } from '../constants/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function DocumentViewScreen() {
  const route = useRoute();
  const nav = useNavigation();
  const { name } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    nav.setOptions({ title: name });
    loadDoc();
  }, [name]);

  const loadDoc = async () => {
    try {
      const result = await api.viewFile(name);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.documents.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.loading}>
        <Text style={{ fontSize: 48, marginBottom: 12 }}>⚠️</Text>
        <Text style={{ color: Colors.common.danger, fontSize: 16 }}>{error}</Text>
      </View>
    );
  }

  if (data?.type === 'docx' && Array.isArray(data.content)) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.docxScroll}>
        {data.content.map((item, idx) => {
          if (item.type === 'image') {
            const imgUrl = data.cache_key
              ? api.getImageUrl(data.cache_key, item.src)
              : '';
            return (
              <View key={idx} style={styles.imageWrap}>
                <Image
                  source={{ uri: imgUrl }}
                  style={styles.image}
                  resizeMode="contain"
                />
                {item.caption ? (
                  <Text style={styles.imageCaption}>{item.caption}</Text>
                ) : null}
              </View>
            );
          }
          if (item.type === 'text') {
            if (!item.text.trim()) {
              return <View key={idx} style={{ height: 10 }} />;
            }
            if (item.is_heading) {
              return <Text key={idx} style={styles.heading}>{item.text}</Text>;
            }
            return <Text key={idx} style={styles.paragraph}>{item.text}</Text>;
          }
          return null;
        })}
      </ScrollView>
    );
  }

  // txt/md
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.textContent}>{data?.content || ''}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.documents.card },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.documents.card },
  scroll: { padding: 20 },
  docxScroll: { padding: 20, paddingBottom: 60 },
  heading: {
    fontSize: 19, fontWeight: '700', color: Colors.documents.primaryDark,
    marginTop: 20, marginBottom: 8, lineHeight: 28,
  },
  paragraph: {
    fontSize: 16, lineHeight: 28, color: Colors.common.text,
    marginBottom: 12, textAlign: 'justify',
  },
  imageWrap: {
    alignItems: 'center', marginVertical: 16,
  },
  image: {
    width: SCREEN_WIDTH - 60, height: 200, borderRadius: 10,
  },
  imageCaption: {
    fontSize: 13, color: Colors.common.textLight, marginTop: 6,
  },
  textContent: {
    fontSize: 16, lineHeight: 28, color: Colors.common.text,
  },
});
