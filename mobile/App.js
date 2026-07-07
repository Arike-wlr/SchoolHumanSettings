import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Colors } from './src/constants/colors';

// Screens
import CharactersScreen from './src/screens/CharactersScreen';
import CharacterDetailScreen from './src/screens/CharacterDetailScreen';
import CharacterFormScreen from './src/screens/CharacterFormScreen';
import WorldviewScreen from './src/screens/WorldviewScreen';
import WorldviewDetailScreen from './src/screens/WorldviewDetailScreen';
import WorldviewFormScreen from './src/screens/WorldviewFormScreen';
import RelationsScreen from './src/screens/RelationsScreen';
import RelationFormScreen from './src/screens/RelationFormScreen';
import DocumentsScreen from './src/screens/DocumentsScreen';
import DocumentViewScreen from './src/screens/DocumentViewScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const headerStyle = {
  backgroundColor: Colors.character.headerBg,
};
const headerTitleStyle = {
  color: Colors.character.headerText,
  fontSize: 17,
  fontWeight: '400',
  letterSpacing: 1,
};
const headerTintColor = Colors.character.headerText;

// Tab Icon
function TabIcon({ name, color, size }) {
  const icons = {
    '角色': '📖',
    '世界观': '🌍',
    '关系网': '🔗',
    '文档': '📄',
  };
  return <Text style={{ fontSize: size - 2 }}>{icons[name] || '•'}</Text>;
}

// ====== 角色 Stack ======
function CharactersStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle,
        headerTitleStyle,
        headerTintColor,
      }}
    >
      <Stack.Screen name="CharactersList" component={CharactersScreen} options={{ title: '高校拟人OC' }} />
      <Stack.Screen name="CharacterDetail" component={CharacterDetailScreen} options={{ title: '角色详情' }} />
      <Stack.Screen name="CharacterForm" component={CharacterFormScreen} options={({ route }) => ({
        title: route.params?.id ? '编辑角色' : '添加角色',
      })} />
    </Stack.Navigator>
  );
}

// ====== 世界观 Stack ======
function WorldviewStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.worldview.headerBg },
        headerTitleStyle: { color: Colors.worldview.headerText, fontSize: 17, fontWeight: '400', letterSpacing: 1 },
        headerTintColor: Colors.worldview.headerText,
      }}
    >
      <Stack.Screen name="WorldviewList" component={WorldviewScreen} options={{ title: '世界观设定' }} />
      <Stack.Screen name="WorldviewDetail" component={WorldviewDetailScreen} options={{ title: '设定详情' }} />
      <Stack.Screen name="WorldviewForm" component={WorldviewFormScreen} options={({ route }) => ({
        title: route.params?.id ? '编辑设定' : '添加设定',
      })} />
    </Stack.Navigator>
  );
}

// ====== 关系网 Stack ======
function RelationsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.relations.headerBg },
        headerTitleStyle: { color: Colors.relations.headerText, fontSize: 17, fontWeight: '400', letterSpacing: 1 },
        headerTintColor: Colors.relations.headerText,
      }}
    >
      <Stack.Screen name="RelationsList" component={RelationsScreen} options={{ title: '关系网' }} />
      <Stack.Screen name="RelationForm" component={RelationFormScreen} options={({ route }) => ({
        title: route.params?.id ? '编辑关系' : '添加关系',
      })} />
      <Stack.Screen name="CharacterDetail" component={CharacterDetailScreen} options={{ title: '角色详情' }} />
    </Stack.Navigator>
  );
}

// ====== 文档 Stack ======
function DocumentsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.documents.headerBg },
        headerTitleStyle: { color: Colors.documents.headerText, fontSize: 17, fontWeight: '400', letterSpacing: 1 },
        headerTintColor: Colors.documents.headerText,
      }}
    >
      <Stack.Screen name="DocumentsList" component={DocumentsScreen} options={{ title: '文档管理' }} />
      <Stack.Screen name="DocumentView" component={DocumentViewScreen} options={{ title: '文档预览' }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: Colors.character.primary,
            tabBarInactiveTintColor: Colors.common.textLight,
            tabBarStyle: {
              backgroundColor: Colors.character.card,
              borderTopColor: Colors.common.border,
              height: 56,
              paddingBottom: 6,
              paddingTop: 4,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
              letterSpacing: 0.3,
            },
          }}
        >
          <Tab.Screen
            name="Characters"
            component={CharactersStack}
            options={{
              tabBarLabel: '角色设定',
              tabBarIcon: ({ color, size }) => <TabIcon name="角色" color={color} size={size} />,
            }}
          />
          <Tab.Screen
            name="Worldview"
            component={WorldviewStack}
            options={{
              tabBarLabel: '世界观',
              tabBarIcon: ({ color, size }) => <TabIcon name="世界观" color={color} size={size} />,
            }}
          />
          <Tab.Screen
            name="Relations"
            component={RelationsStack}
            options={{
              tabBarLabel: '关系网',
              tabBarIcon: ({ color, size }) => <TabIcon name="关系网" color={color} size={size} />,
            }}
          />
          <Tab.Screen
            name="Documents"
            component={DocumentsStack}
            options={{
              tabBarLabel: '文档',
              tabBarIcon: ({ color, size }) => <TabIcon name="文档" color={color} size={size} />,
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
